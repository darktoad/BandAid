<script lang="ts">
  import { onMount } from 'svelte';
  import BrowseView from './views/BrowseView.svelte';
  import ChordChangesView from './views/ChordChangesView.svelte';
  import { createLocalSessionStore } from './session/store';
  import { createLibraryService, type LibraryService } from './library/libraryService';
  import type { SongSummary, SongKey } from './library/types';
  import { songFromSearch, searchWithSong } from './library/urlState';

  // The app owns the session (a session of one in M1). Browsing writes currentSongId
  // (the seam to the renderer); in M2 the same store becomes a CRDT with no change here.
  const store = createLocalSessionStore();

  let service = $state<LibraryService | undefined>(undefined);
  let loadError = $state<string | null>(null);
  let current = $state<{ id: string; url: string; title: string; key?: SongKey; composer?: string; notes?: string; lyricsUrl?: string } | undefined>(undefined);
  // The song picker is a slide-over while drilling; full-screen before the first pick.
  let pickerOpen = $state(false);
  // Live playback position of the current song (0–1), surfaced in the picker.
  let progress = $state(0);

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
        // deep link / resume goes to the picker instead of leaving the app.
        history.replaceState(null, '', location.pathname + searchWithSong(location.search, null));
        openSong(s);
      }
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

  // Render a song (no history side effects — used by open, Back, and Forward alike).
  function showSong(s: SongSummary) {
    store.setCurrentSong(s.id); // the only write to currentSongId (D5/FR-7)
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
    showSong(s);
  }
</script>

{#if current}
  <!-- Re-mount per song so the renderer reloads the new score. -->
  {#key current.id}
    <ChordChangesView song={current} {store} onsongs={() => (pickerOpen = true)} onprogress={(f) => (progress = f)} />
  {/key}
  {#if service && pickerOpen}
    <button class="scrim" onclick={() => (pickerOpen = false)} aria-label="Close song picker"></button>
    <aside class="picker-panel" role="dialog" aria-modal="true" aria-label="Song picker">
      <BrowseView {service} onopen={openSong} onclose={() => (pickerOpen = false)} activeId={current.id} {progress} />
    </aside>
  {/if}
{:else if service}
  <!-- First load: the integrated picker, full screen. -->
  <BrowseView {service} onopen={openSong} />
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
</style>
