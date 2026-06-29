<script lang="ts">
  import type { LibraryService } from '../library/libraryService';
  import type { SongSummary } from '../library/types';

  /**
   * Integrated song picker (M1). A tab row at the top selects which list to show — each
   * set list, plus "All songs" — and the body shows that one list; tap a song to open.
   * No separate library / set-list / detail screens. Opens to the most-recently-used
   * list (persisted). Used full-screen on first load and as the slide-over while
   * drilling. The only session write is Open → onopen → setCurrentSong (D5).
   */
  let { service, onopen, onclose }: {
    service: LibraryService;
    onopen: (song: SongSummary) => void;
    onclose?: () => void; // present when shown as the slide-over
  } = $props();

  let setLists = $derived(service.getSetLists());
  let allSongs = $derived(service.getAllSongs());

  const LAST_KEY = 'bandaid.lastList';
  function loadLast(): string | null {
    try {
      return typeof localStorage !== 'undefined' ? localStorage.getItem(LAST_KEY) : null;
    } catch {
      return null;
    }
  }
  let pickedRaw = $state<string | null>(loadLast());

  // Resolve the selection: the remembered list if it still exists, else the first set
  // list, else "all". ('all' is an explicit, valid choice.)
  let selected = $derived.by<string>(() => {
    if (pickedRaw === 'all') return 'all';
    if (pickedRaw && setLists.some((l) => l.id === pickedRaw)) return pickedRaw;
    return setLists[0]?.id ?? 'all';
  });
  let shownSongs = $derived(selected === 'all' ? allSongs : service.getSetListSongs(selected));

  function pick(id: string) {
    pickedRaw = id;
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(LAST_KEY, id);
    } catch {
      /* ignore */
    }
  }

  const keyLabel = (s: SongSummary) => `${s.defaultKey.tonalCenter} ${s.defaultKey.mode}`;
</script>

<div class="picker">
  <header class="phead">
    <span class="brand">BandAid</span>
    <span class="ptitle">Songs</span>
    {#if onclose}
      <button class="iconbtn" onclick={onclose} aria-label="Close">✕</button>
    {/if}
  </header>

  <div class="tabs">
    {#each setLists as l}
      <button class="tab" class:active={selected === l.id} onclick={() => pick(l.id)}>{l.name}</button>
    {/each}
    <button class="tab" class:active={selected === 'all'} onclick={() => pick('all')}>All songs</button>
  </div>

  <div class="pbody">
    {#if shownSongs.length === 0}
      <p class="empty">No songs here yet.</p>
    {:else}
      <ul class="list">
        {#each shownSongs as s}
          <li>
            <button class="srow" onclick={() => onopen(s)}>
              <span class="stitle">{s.title}</span>
              <span class="smeta">{keyLabel(s)} · ♩ = {s.defaultTempoBpm}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .picker { display: flex; flex-direction: column; height: 100%; background: var(--bg); }
  .phead {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    padding: 0.7rem 1rem;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  .brand { font-weight: 700; letter-spacing: 0.02em; }
  .ptitle { color: var(--muted); font-size: 0.82rem; flex: 1 1 auto; }
  .iconbtn { flex: 0 0 auto; width: 2rem; height: 2rem; display: inline-flex; align-items: center; justify-content: center; padding: 0; }

  /* List selector: set lists + "All songs", one shown at a time. */
  .tabs {
    display: flex;
    gap: 0.4rem;
    padding: 0.6rem 0.8rem;
    overflow-x: auto;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  .tab {
    flex: 0 0 auto;
    padding: 0.35rem 0.7rem;
    font-size: 0.82rem;
    white-space: nowrap;
  }
  .tab.active { border-color: var(--accent); color: var(--accent); }

  .pbody { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 0.7rem 0.8rem 1.2rem; }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
  .srow {
    width: 100%;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.7rem 0.8rem;
    min-height: 2.9rem; /* comfortable tap target */
    text-align: left;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  .srow:hover { border-color: var(--accent); }
  .stitle { font-weight: 600; }
  .smeta { color: var(--muted); font-size: 0.82rem; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .empty { color: var(--muted); padding: 0.6rem 0.2rem; }
</style>
