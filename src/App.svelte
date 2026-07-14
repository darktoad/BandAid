<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import BrowseView from './views/BrowseView.svelte';
  import ChordChangesView from './views/ChordChangesView.svelte';
  import { createSyncedSessionStore } from './sync/syncedSessionStore';
  import { createBandDoc } from './sync/doc';
  import { attachProviders } from './sync/providers/attach';
  import { indexeddbProvider } from './sync/providers/indexeddb';
  import { webrtcProvider } from './sync/providers/webrtc';
  import { partyserverProvider } from './sync/providers/partyserver';
  import { createBandSession } from './sync/bandSession';
  import { createIntentFollower } from './sync/follower';
  import { readBandName, saveBandName, bandRoomCode } from './sync/bandCode';
  import { readItem, writeItem, safeStorage } from './sync/storage';
  import { summarizeSyncStatus } from './sync/syncStatusLabel';
  import { createLibraryService, type LibraryService } from './library/libraryService';
  import { createSetListStore, type SetListStore } from './library/setListStore';
  import type { SongSummary, SongKey, SongVariant } from './library/types';
  import { parseSongRef, formatSongRef, songFilePath } from './library/songRef';
  import { songFromSearch, searchWithSong } from './library/urlState';
  import type { SharedSongIntent } from './session/types';
  import { skewLog } from './sync/skewLog';

  // One Yjs doc, three attachments: the synced store (app-facing API), always-on
  // IndexedDB persistence, and the band session (opt-in network providers). Joining
  // the band is an intentional step (the Sync toggle in the settings sheet) — but the
  // choice persists across reloads, because iOS Safari silently reloads backgrounded
  // tabs and a mid-rehearsal app switch must not drop the device out of the band.
  const ydoc = createBandDoc();
  // A `?band=` link or a previous session only prefills the band NAME — never connects.
  const initialBandName = readBandName(typeof location !== 'undefined' ? location.search : '');
  let bandName = $state(initialBandName);
  const host = import.meta.env.VITE_SYNC_HOST;
  const band = createBandSession({
    doc: ydoc,
    room: bandRoomCode(initialBandName), // later edits go through setBandName → band.setRoom
    factories: [webrtcProvider, ...(host ? [partyserverProvider(host)] : [])],
  });
  // Live session stamps (transport/song) publish only while the band is joined —
  // solo practice must never accumulate stamps that yank the band on a later rejoin.
  const store = createSyncedSessionStore({ doc: ydoc, publishSession: band.isOn });
  const localPersistence = attachProviders(ydoc, 'solo', [indexeddbProvider]);

  let bandState = $state(band.getState());
  const unsubBand = band.subscribe((s) => (bandState = s));
  let syncSummary = $derived(summarizeSyncStatus(bandState.status));

  function toggleSync() {
    band.setOn(!band.isOn());
  }
  function setBandName(name: string) {
    bandName = saveBandName(name);
    // Changing bands while synced moves to the new room right away.
    band.setRoom(bandRoomCode(bandName));
  }

  onDestroy(() => {
    unsubSessionSong?.();
    clearTimeout(noticeTimer);
    unsubBand();
    band.destroy();
    localPersistence.disconnect();
    setListStore?.destroy();
  });

  let service = $state<LibraryService | undefined>(undefined);
  // Set lists = bundled manifest defaults + the band's shared edits, in the same doc
  // as everything else (built once the manifest loads).
  let setListStore = $state<SetListStore | undefined>(undefined);
  let loadError = $state<string | null>(null);
  let current = $state<{ id: string; url: string; title: string; key?: SongKey; composer?: string; notes?: string; lyricsUrl?: string; variantId?: string; variantName?: string; variants?: SongVariant[] } | undefined>(undefined);
  // The song picker is a slide-over while drilling; full-screen before the first pick.
  let pickerOpen = $state(false);
  // Live playback position of the current song (0–1), surfaced in the picker.
  let progress = $state(0);

  // Remote song switches: a brief, named, non-blocking notice (playback-sync D7).
  let remoteNotice = $state<string | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let unsubSessionSong: (() => void) | undefined;

  // Same follower rules as transport (echo guard, issuedAt LWW, gated on band sync —
  // a stale stamp loaded from IndexedDB must never switch songs on a local-only boot).
  const songFollower = createIntentFollower<SharedSongIntent>({
    authorId: store.getIdentity().authorId,
    enabled: band.isOn,
    apply(intent) {
      const ref = parseSongRef(intent.songId);
      if (!service || intent.songId === formatSongRef(current?.id ?? '', current?.variantId)) return;
      const s = service.getSongSummary(ref.songId);
      if (!s) return; // unknown id (library version drift) — ignore
      // replaceState, not pushState: Back must not walk through bandmates' switches.
      history.replaceState(null, '', location.pathname + searchWithSong(location.search, intent.songId));
      showSong(s, ref.variantId);
      remoteNotice = `${intent.author || 'A bandmate'} switched to ${s.title}`;
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => (remoteNotice = null), 4000);
    },
  });

  // Cache-buster for the runtime-fetched files GitHub Pages caches; bumps each deploy.
  const v = `?v=${__BUILD_ID__}`;

  // Deep links + resume: the open song lives in the URL (?song=<id>) and the last open
  // song in localStorage, so a shared link lands on the tune and a mid-rehearsal reload
  // picks up where you were. Back always returns to the picker, not out of the app.
  const LAST_SONG_KEY = 'bandaid.lastSong.v1';
  const loadLastSong = () => readItem(safeStorage(), LAST_SONG_KEY);
  const saveLastSong = (id: string | null) => writeItem(safeStorage(), LAST_SONG_KEY, id);

  onMount(() => {
    // Rehearsal dogfood readout (G3/M4 gate): __bandaidSkew() in the console.
    (window as unknown as Record<string, unknown>).__bandaidSkew = () => ({
      summary: skewLog.summary(),
      samples: skewLog.samples(),
    });

    (async () => {
      try {
        service = await createLibraryService(`${import.meta.env.BASE_URL}library.json${v}`);
        setListStore = createSetListStore(ydoc, service.getSetLists());
      } catch (e) {
        loadError = e instanceof Error ? e.message : String(e);
        return;
      }
      // Boot pick: an explicit ?song= link wins, else resume the last open song.
      const bootRef = songFromSearch(location.search) ?? loadLastSong();
      const parsed = bootRef ? parseSongRef(bootRef) : null;
      const s = parsed ? service.getSongSummary(parsed.songId) : null;
      if (s) {
        // Seed a bare picker entry underneath, then push the song, so Back from a
        // deep link / resume goes to the picker instead of leaving the app. Render via
        // showSong (not openSong): boot resume / deep links never publish (D6/FR-8).
        history.replaceState(null, '', location.pathname + searchWithSong(location.search, null));
        history.pushState(null, '', location.pathname + searchWithSong(location.search, bootRef));
        showSong(s, parsed!.variantId);
      }
      // Follow the band's current song. Subscribe delivers the current doc value
      // immediately, so a device opening mid-set lands on the band's song.
      unsubSessionSong = store.subscribeSessionSong((s) => songFollower.receive(s));
    })();

    // Browser Back/Forward: mirror the URL's song into the view without re-pushing.
    const onPop = () => {
      const ref = songFromSearch(location.search);
      const parsed = ref ? parseSongRef(ref) : null;
      const s = parsed && service ? service.getSongSummary(parsed.songId) : null;
      if (s) showSong(s, parsed!.variantId);
      else {
        current = undefined; // back to the full-screen picker
        pickerOpen = false;
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  });

  // Render a song, optionally as a named arrangement (no history or session side
  // effects — used by open, Back/Forward, boot resume, and remote follows alike).
  function showSong(s: SongSummary, variantId?: string) {
    // Unknown variant (library version drift): fall back to canonical, loudly.
    const variant = variantId ? (service?.getVariant(s.id, variantId) ?? null) : null;
    if (variantId && !variant) console.warn(`Unknown arrangement ${s.id}@${variantId}; showing canonical`);
    current = {
      id: s.id,
      url: `${import.meta.env.BASE_URL}${songFilePath(s.id, variant?.id)}${v}`,
      title: s.title,
      key: s.defaultKey,
      composer: s.composer,
      notes: s.notes,
      lyricsUrl: s.content.hasLyrics ? `${import.meta.env.BASE_URL}songs/${s.id}.chordpro${v}` : undefined,
      variantId: variant?.id,
      variantName: variant?.name,
      variants: s.variants,
    };
    pickerOpen = false; // switching a song closes the picker; we stay in the drill view
    saveLastSong(formatSongRef(s.id, variant?.id));
  }

  function openSong(s: SongSummary, variantId?: string) {
    const ref = formatSongRef(s.id, variantId);
    history.pushState(null, '', location.pathname + searchWithSong(location.search, ref));
    // The one path that publishes the switch to the band (playback-sync D6): boot
    // resume, deep links, and Back/Forward render via showSong() and stay local.
    store.setCurrentSong(ref);
    showSong(s, variantId);
  }

  // Keyboard flow for the picker slide-over: remember the opener, restore focus on
  // close, and let Escape close it (its scrim is mouse-only).
  let pickerReturnFocus: HTMLElement | null = null;
  function openPicker() {
    pickerReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pickerOpen = true;
  }
  function closePicker() {
    pickerOpen = false;
    pickerReturnFocus?.focus();
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.code === 'Escape' && pickerOpen) closePicker();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if remoteNotice}
  <div class="remote-notice" role="status">{remoteNotice}</div>
{/if}

{#if current}
  <!-- Re-mount per song/arrangement so the renderer reloads the new score (the url
       changes with song, variant, and nothing else at runtime). -->
  {#key current.url}
    <ChordChangesView
      song={current}
      {store}
      sync={{ on: bandState.on, bandName, summary: syncSummary, toggle: toggleSync, setBandName }}
      onsongs={openPicker}
      onprogress={(f) => (progress = f)}
      onvariant={(variantId) => {
        const s = service?.getSongSummary(current!.id);
        if (s) openSong(s, variantId ?? undefined);
      }}
    />
  {/key}
  {#if service && setListStore && pickerOpen}
    <button class="scrim" onclick={closePicker} aria-label="Close song picker"></button>
    <div class="picker-panel" role="dialog" aria-modal="true" aria-label="Song picker">
      <BrowseView {service} {setListStore} onopen={openSong} onclose={closePicker} activeId={current.id} activeVariantId={current.variantId} {progress} {syncSummary} />
    </div>
  {/if}
{:else if service && setListStore}
  <!-- First load: the integrated picker, full screen. -->
  <BrowseView {service} {setListStore} onopen={openSong} {syncSummary} />
{:else if loadError}
  <div class="boot-error">Couldn’t load the library: {loadError}</div>
{:else}
  <div class="boot">Loading library…</div>
{/if}

<style>
  .boot,
  .boot-error {
    padding: 1.2rem 1rem;
    color: var(--muted);
  }
  .boot-error { color: #f1b4b4; }

  /* Slide-over song picker over the drill view. alphaTab's playhead wrapper
     (.at-cursors) is z-index 1000, so the overlay must sit above that. */
  .scrim {
    position: fixed;
    inset: 0;
    border: none;
    padding: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 1001;
  }
  .picker-panel {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: min(88%, 26rem);
    z-index: 1002;
    box-shadow: 2px 0 16px rgba(0, 0, 0, 0.4);
    animation: slidein 0.16s ease-out;
  }
  @keyframes slidein {
    from { transform: translateX(-100%); }
    to { transform: translateX(0); }
  }

  /* Above the picker slide-over (z 1002) and alphaTab cursors (z 1000). */
  .remote-notice {
    position: fixed;
    top: 0.6rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1003;
    background: rgba(20, 22, 26, 0.92);
    color: #fff;
    padding: 0.45rem 0.9rem;
    border-radius: 999px;
    font-size: 0.85rem;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
    animation: notice-in 0.15s ease-out;
    pointer-events: none;
  }
  @keyframes notice-in {
    from { opacity: 0; transform: translate(-50%, -0.4rem); }
    to { opacity: 1; transform: translate(-50%, 0); }
  }
</style>
