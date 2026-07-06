<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import BrowseView from './views/BrowseView.svelte';
  import ChordChangesView from './views/ChordChangesView.svelte';
  import { createSyncedSessionStore } from './sync/syncedSessionStore';
  import { attachProviders } from './sync/providers/attach';
  import { indexeddbProvider } from './sync/providers/indexeddb';
  import { webrtcProvider } from './sync/providers/webrtc';
  import { partyserverProvider } from './sync/providers/partyserver';
  import { readBandCode } from './sync/bandCode';
  import { summarizeSyncStatus } from './sync/syncStatusLabel';
  import { createLibraryService, type LibraryService } from './library/libraryService';
  import type { SongSummary, SongKey } from './library/types';
  import { songFromSearch, searchWithSong } from './library/urlState';
  import type { SharedSongIntent } from './session/types';
  import { skewLog } from './sync/skewLog';

  // Synced store over a Yjs doc. With a band code we attach transports; without one
  // the same store works fully local (IndexedDB only, no network).
  const store = createSyncedSessionStore();
  // Read once at init; switching ?band= in place will NOT re-attach providers to the new room — changing bands requires a full page reload.
  const bandCode = readBandCode(typeof location !== 'undefined' ? location.search : '');
  let sync: ReturnType<typeof attachProviders> | undefined;
  if (bandCode) {
    const host = import.meta.env.VITE_SYNC_HOST;
    const factories = [indexeddbProvider, webrtcProvider, ...(host ? [partyserverProvider(host)] : [])];
    sync = attachProviders(store.doc, bandCode, factories);
  } else {
    // Local-only durability even without a band: persist to IndexedDB.
    sync = attachProviders(store.doc, 'solo', [indexeddbProvider]);
  }
  let syncStatus = $state(sync?.getStatus() ?? { providers: {} });
  const unsubscribeSyncStatus = sync?.onStatusChange((s) => (syncStatus = s));
  let syncSummary = $derived(summarizeSyncStatus(syncStatus));
  onDestroy(() => {
    unsubscribeSyncStatus?.();
    unsubSessionSong?.();
    sync?.disconnect();
  });

  let service = $state<LibraryService | undefined>(undefined);
  let loadError = $state<string | null>(null);
  let current = $state<{ id: string; url: string; title: string; key?: SongKey; composer?: string; notes?: string; lyricsUrl?: string } | undefined>(undefined);
  // The song picker is a slide-over while drilling; full-screen before the first pick.
  let pickerOpen = $state(false);
  // Live playback position of the current song (0–1), surfaced in the picker.
  let progress = $state(0);

  // Remote song switches: a brief, named, non-blocking notice (playback-sync D7).
  let remoteNotice = $state<string | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let lastAppliedSongIssuedAt = 0;
  const myAuthorId = store.getIdentity().authorId;
  let unsubSessionSong: (() => void) | undefined;

  function followRemoteSong(intent: SharedSongIntent | null) {
    if (!intent || !service) return;
    if (intent.authorId === myAuthorId) {
      lastAppliedSongIssuedAt = Math.max(lastAppliedSongIssuedAt, intent.issuedAt);
      return;
    }
    if (intent.issuedAt <= lastAppliedSongIssuedAt) return;
    lastAppliedSongIssuedAt = intent.issuedAt;
    if (intent.songId === current?.id) return;
    const s = service.getSongSummary(intent.songId);
    if (!s) return; // unknown id (library version drift) — ignore
    // replaceState, not pushState: Back must not walk through bandmates' switches.
    history.replaceState(null, '', location.pathname + searchWithSong(location.search, s.id));
    showSong(s);
    remoteNotice = `${intent.author || 'A bandmate'} switched to ${s.title}`;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (remoteNotice = null), 4000);
  }

  // Cache-buster for the runtime-fetched files GitHub Pages caches; bumps each deploy.
  const v = `?v=${__BUILD_ID__}`;

  // Deep links + resume: the open song lives in the URL (?song=<id>) and the last open
  // song in localStorage, so a shared link lands on the tune and a mid-rehearsal reload
  // picks up where you were. Back always returns to the picker, not out of the app.
  const LAST_SONG_KEY = 'bandaid.lastSong.v1';
  function loadLastSong(): string | null {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage.getItem(LAST_SONG_KEY);
    } catch {
      return null;
    }
  }
  function saveLastSong(id: string | null) {
    try {
      if (typeof localStorage === 'undefined') return;
      if (id === null) localStorage.removeItem(LAST_SONG_KEY);
      else localStorage.setItem(LAST_SONG_KEY, id);
    } catch {
      /* ignore */
    }
  }

  onMount(() => {
    // Rehearsal dogfood readout (G3/M4 gate): __bandaidSkew() in the console.
    (window as unknown as Record<string, unknown>).__bandaidSkew = () => ({
      summary: skewLog.summary(),
      samples: skewLog.samples(),
    });

    (async () => {
      try {
        service = await createLibraryService(`${import.meta.env.BASE_URL}library.json${v}`);
      } catch (e) {
        loadError = e instanceof Error ? e.message : String(e);
        return;
      }
      // Boot pick: an explicit ?song= link wins, else resume the last open song.
      const bootId = songFromSearch(location.search) ?? loadLastSong();
      const s = bootId ? service.getSongSummary(bootId) : null;
      if (s) {
        // Seed a bare picker entry underneath, then push the song, so Back from a
        // deep link / resume goes to the picker instead of leaving the app. Render via
        // showSong (not openSong): boot resume / deep links never publish (D6/FR-8).
        history.replaceState(null, '', location.pathname + searchWithSong(location.search, null));
        history.pushState(null, '', location.pathname + searchWithSong(location.search, s.id));
        showSong(s);
      }
      // Follow the band's current song. Subscribe delivers the current doc value
      // immediately, so a device opening mid-set lands on the band's song.
      unsubSessionSong = store.subscribeSessionSong(followRemoteSong);
    })();

    // Browser Back/Forward: mirror the URL's song into the view without re-pushing.
    const onPop = () => {
      const id = songFromSearch(location.search);
      const s = id && service ? service.getSongSummary(id) : null;
      if (s) showSong(s);
      else {
        current = undefined; // back to the full-screen picker
        pickerOpen = false;
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  });

  // Render a song (no history or session side effects — used by open, Back/Forward, boot
  // resume, and remote follows alike).
  function showSong(s: SongSummary) {
    // Convention: a song's canonical file is songs/<id>.musicxml (NFR-3).
    current = {
      id: s.id,
      url: `${import.meta.env.BASE_URL}songs/${s.id}.musicxml${v}`,
      title: s.title,
      key: s.defaultKey,
      composer: s.composer,
      notes: s.notes,
      lyricsUrl: s.content.hasLyrics ? `${import.meta.env.BASE_URL}songs/${s.id}.chordpro${v}` : undefined,
    };
    pickerOpen = false; // switching a song closes the picker; we stay in the drill view
    saveLastSong(s.id);
  }

  function openSong(s: SongSummary) {
    history.pushState(null, '', location.pathname + searchWithSong(location.search, s.id));
    // The one path that publishes the switch to the band (playback-sync D6): boot
    // resume, deep links, and Back/Forward render via showSong() and stay local.
    store.setCurrentSong(s.id);
    showSong(s);
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
  <!-- Re-mount per song so the renderer reloads the new score. -->
  {#key current.id}
    <ChordChangesView song={current} {store} {syncSummary} onsongs={openPicker} onprogress={(f) => (progress = f)} />
  {/key}
  {#if service && pickerOpen}
    <button class="scrim" onclick={closePicker} aria-label="Close song picker"></button>
    <div class="picker-panel" role="dialog" aria-modal="true" aria-label="Song picker">
      <BrowseView {service} onopen={openSong} onclose={closePicker} activeId={current.id} {progress} {syncSummary} />
    </div>
  {/if}
{:else if service}
  <!-- First load: the integrated picker, full screen. -->
  <BrowseView {service} onopen={openSong} {syncSummary} />
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
