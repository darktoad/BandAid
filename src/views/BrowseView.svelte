<script lang="ts">
  import type { LibraryService } from '../library/libraryService';
  import type { SongSummary } from '../library/types';

  /**
   * Browse shell (M1): set-lists-first home (D1), a secondary Library, and a song
   * detail card (D3) before Open. All navigation/scroll state here is local
   * presentation (FR-9); the only session write is Open → onopen → setCurrentSong (D5).
   */
  let { service, onopen }: {
    service: LibraryService;
    onopen: (song: SongSummary) => void;
  } = $props();

  type View = 'setlists' | 'setlist' | 'library' | 'song';
  let view = $state<View>('setlists');
  let openSetListId = $state<string | null>(null);
  let selectedSongId = $state<string | null>(null);
  let cameFrom = $state<View>('setlists'); // where the song card returns to

  let setLists = $derived(service.getSetLists());

  let openSetList = $derived(setLists.find((l) => l.id === openSetListId) ?? null);
  let setListSongs = $derived(openSetListId ? service.getSetListSongs(openSetListId) : []);
  let allSongs = $derived(service.getAllSongs());
  let selectedSong = $derived(selectedSongId ? service.getSongSummary(selectedSongId) : null);

  const keyLabel = (s: SongSummary) => `${s.defaultKey.tonalCenter} ${s.defaultKey.mode}`;

  function openSetListView(id: string) {
    openSetListId = id;
    view = 'setlist';
  }
  function showSong(id: string, from: View) {
    selectedSongId = id;
    cameFrom = from;
    view = 'song';
  }
</script>

<header class="topbar">
  <span class="brand">BandAid</span>
  <span class="tag">Library</span>
</header>

{#if view === 'setlists'}
  <div class="screen">
    <div class="screen-head">
      <h2>Set lists</h2>
      <button class="link" onclick={() => (view = 'library')}>All songs →</button>
    </div>
    {#if setLists.length === 0}
      <p class="empty">No set lists yet.</p>
    {:else}
      <ul class="list">
        {#each setLists as l}
          <li>
            <button class="row" onclick={() => openSetListView(l.id)}>
              <span class="row-title">{l.name}</span>
              <span class="row-meta">{l.entries.length} song{l.entries.length === 1 ? '' : 's'}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{:else if view === 'setlist'}
  <div class="screen">
    <div class="screen-head">
      <button class="link" onclick={() => (view = 'setlists')}>← Set lists</button>
      <h2>{openSetList?.name ?? 'Set list'}</h2>
    </div>
    {#if setListSongs.length === 0}
      <p class="empty">This set list is empty.</p>
    {:else}
      <ul class="list">
        {#each setListSongs as s}
          <li>
            <button class="row" onclick={() => showSong(s.id, 'setlist')}>
              <span class="row-title">{s.title}</span>
              <span class="row-meta">{keyLabel(s)} · {s.defaultTempoBpm} bpm</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{:else if view === 'library'}
  <div class="screen">
    <div class="screen-head">
      <button class="link" onclick={() => (view = 'setlists')}>← Set lists</button>
      <h2>All songs</h2>
    </div>
    {#if allSongs.length === 0}
      <p class="empty">No songs yet.</p>
    {:else}
      <ul class="list">
        {#each allSongs as s}
          <li>
            <button class="row" onclick={() => showSong(s.id, 'library')}>
              <span class="row-title">{s.title}</span>
              <span class="row-meta">{keyLabel(s)} · {s.defaultTempoBpm} bpm</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{:else if view === 'song' && selectedSong}
  <div class="screen">
    <div class="screen-head">
      <button class="link" onclick={() => (view = cameFrom)}>← Back</button>
    </div>
    <div class="card">
      <h2 class="card-title">{selectedSong.title}</h2>
      <dl class="facts">
        <div><dt>Key</dt><dd>{keyLabel(selectedSong)}</dd></div>
        <div><dt>Tempo</dt><dd>{selectedSong.defaultTempoBpm} bpm</dd></div>
        <div><dt>Time</dt><dd>{selectedSong.timeSignature}</dd></div>
      </dl>
      <div class="views">
        <span class="views-label">Views</span>
        <div class="chips">
          {#each service.availableViews(selectedSong) as v}
            <span class="chip">{v}</span>
          {/each}
        </div>
      </div>
      <button class="open" onclick={() => onopen(selectedSong)}>Open</button>
    </div>
  </div>
{/if}

<style>
  .topbar {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    padding: 0.55rem 1rem;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  .brand { font-weight: 700; letter-spacing: 0.02em; }
  .tag { color: var(--muted); font-size: 0.8rem; }

  .screen { padding: 0.9rem 1rem; max-width: 640px; margin: 0 auto; }
  .screen-head { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.6rem; }
  .screen-head h2 { font-size: 1.05rem; margin: 0; }
  .link { background: none; border: none; color: var(--accent); padding: 0.2rem 0; font-size: 0.9rem; cursor: pointer; }

  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .row {
    width: 100%;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.8rem 0.9rem;
    min-height: 3rem; /* comfortable tap target */
    text-align: left;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    cursor: pointer;
  }
  .row:hover { border-color: var(--accent); }
  .row-title { font-weight: 600; }
  .row-meta { color: var(--muted); font-size: 0.85rem; font-variant-numeric: tabular-nums; }
  .empty { color: var(--muted); padding: 1rem 0; }

  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 1.1rem; }
  .card-title { margin: 0 0 0.8rem; }
  .facts { display: flex; flex-wrap: wrap; gap: 1.2rem; margin: 0 0 1rem; }
  .facts div { display: flex; flex-direction: column; gap: 0.15rem; }
  .facts dt { color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .facts dd { margin: 0; font-variant-numeric: tabular-nums; }
  .views { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 1.1rem; flex-wrap: wrap; }
  .views-label { color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .chip { padding: 0.25rem 0.6rem; border: 1px solid var(--line); border-radius: 999px; font-size: 0.8rem; color: var(--muted); }
  .open { padding: 0.6rem 1.4rem; font-size: 1rem; border-color: var(--accent); color: var(--accent); }
</style>
