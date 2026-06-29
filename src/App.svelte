<script lang="ts">
  import { onMount } from 'svelte';
  import BrowseView from './views/BrowseView.svelte';
  import ChordChangesView from './views/ChordChangesView.svelte';
  import { createLocalSessionStore } from './session/store';
  import { createLibraryService, type LibraryService } from './library/libraryService';
  import type { SongSummary, SongKey } from './library/types';

  // The app owns the session (a session of one in M1). Browsing writes currentSongId
  // (the seam to the renderer); in M2 the same store becomes a CRDT with no change here.
  const store = createLocalSessionStore();

  let service = $state<LibraryService | undefined>(undefined);
  let loadError = $state<string | null>(null);
  // 'browse' vs 'drill' is local presentation; currentSongId is the synced truth.
  let route = $state<'browse' | 'drill'>('browse');
  let current = $state<{ id: string; url: string; title: string; key?: SongKey } | undefined>(undefined);

  // Cache-buster for the runtime-fetched files GitHub Pages caches; bumps each deploy.
  const v = `?v=${__BUILD_ID__}`;

  onMount(async () => {
    try {
      service = await createLibraryService(`${import.meta.env.BASE_URL}library.json${v}`);
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
    }
  });

  function openSong(s: SongSummary) {
    store.setCurrentSong(s.id); // the only write to currentSongId (D5/FR-7)
    // Convention: a song's canonical file is songs/<id>.musicxml (NFR-3).
    current = {
      id: s.id,
      url: `${import.meta.env.BASE_URL}songs/${s.id}.musicxml${v}`,
      title: s.title,
      key: s.defaultKey,
    };
    route = 'drill';
  }
  function back() {
    route = 'browse';
  }
</script>

{#if route === 'drill' && current}
  <!-- Re-mount per song so the renderer reloads the new score. -->
  {#key current.id}
    <ChordChangesView song={current} {store} onback={back} />
  {/key}
{:else if service}
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
</style>
