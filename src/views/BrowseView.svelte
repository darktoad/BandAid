<script lang="ts">
  import type { LibraryService } from '../library/libraryService';
  import type { SongSummary } from '../library/types';
  import SyncBadge from '../sync/SyncBadge.svelte';
  import type { SyncTone } from '../sync/syncStatusLabel';

  /**
   * Integrated song picker (M1). A tab row at the top selects which list to show — each
   * set list, plus "All songs" — and the body shows that one list; tap a song to open.
   * No separate library / set-list / detail screens. Opens to the most-recently-used
   * list (persisted). Used full-screen on first load and as the slide-over while
   * drilling. The only session write is Open → onopen → setCurrentSong (D5).
   */
  let { service, onopen, onclose, activeId, progress = 0, syncSummary }: {
    service: LibraryService;
    onopen: (song: SongSummary, variantId?: string) => void;
    onclose?: () => void; // present when shown as the slide-over
    activeId?: string; // the currently-open song (highlighted)
    progress?: number; // 0–1 playback position of the active song
    syncSummary: { label: string; tone: SyncTone };
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
  type Item = { song: SongSummary; variantId?: string; variantName?: string };
  let shownItems = $derived<Item[]>(
    selected === 'all' ? allSongs.map((song) => ({ song })) : service.getSetListItems(selected),
  );

  function pick(id: string) {
    pickedRaw = id;
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(LAST_KEY, id);
    } catch {
      /* ignore */
    }
  }

  // As a slide-over, receive keyboard focus on open (the close button is first).
  const focusOnMount = (el: HTMLElement) => el.focus();

  const keyLabel = (s: SongSummary) => `${s.defaultKey.tonalCenter} ${s.defaultKey.mode}`;
  const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

  // Expected running time of the shown list (sum of single-pass times). '~' because
  // it's one pass per tune at the chart tempo; bands often play more.
  let totalSec = $derived(shownItems.reduce((a, i) => a + (i.song.durationSec ?? 0), 0));
  let allTimed = $derived(shownItems.length > 0 && shownItems.every((i) => i.song.durationSec !== undefined));
</script>

<div class="picker">
  <header class="phead">
    <h1 class="brand">BandAid</h1>
    <span class="ptitle">Songs</span>
    <SyncBadge summary={syncSummary} />
    {#if onclose}
      <button class="iconbtn" use:focusOnMount onclick={onclose} aria-label="Close">✕</button>
    {/if}
  </header>

  <nav class="tabs" aria-label="Song lists">
    {#each setLists as l}
      <button class="tab" class:active={selected === l.id} aria-current={selected === l.id} onclick={() => pick(l.id)}>{l.name}</button>
    {/each}
    <button class="tab" class:active={selected === 'all'} aria-current={selected === 'all'} onclick={() => pick('all')}>All songs</button>
  </nav>

  <!-- <main> when full-screen; a plain region inside the slide-over (the drill view
       underneath already owns the page's <main>). -->
  <svelte:element this={onclose ? 'div' : 'main'} class="pbody">
    {#if shownItems.length === 0}
      <p class="empty">No songs here yet.</p>
    {:else}
      <div class="listmeta">
        {shownItems.length} song{shownItems.length === 1 ? '' : 's'}{#if totalSec > 0}{' · '}{allTimed
            ? ''
            : '≥'}~{fmt(totalSec)}{/if}
      </div>
      <ul class="list">
        {#each shownItems as it}
          <li>
            <button class="srow" class:active={it.song.id === activeId} aria-current={it.song.id === activeId} onclick={() => onopen(it.song, it.variantId)}>
              <span class="stitle">
                {it.song.title}
                {#if it.variantName}<span class="arr">{it.variantName}</span>{/if}
                {#if it.song.id === activeId}<span class="now">▶ now</span>{/if}
              </span>
              <span class="smeta"
                >{keyLabel(it.song)} · ♩ = {it.song.defaultTempoBpm}{#if it.song.durationSec}{' · '}{fmt(it.song.durationSec)}{/if}</span
              >
              {#if it.song.id === activeId}
                <span class="prog" style="width: {(Math.min(1, Math.max(0, progress)) * 100).toFixed(1)}%"></span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </svelte:element>
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
  .brand { margin: 0; font-family: var(--font-display); font-size: 1.05rem; font-weight: 700; letter-spacing: 0.02em; }
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

  .pbody { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 0.5rem 0.8rem 1.2rem; }
  .listmeta {
    color: var(--muted);
    font-size: 0.74rem;
    font-variant-numeric: tabular-nums;
    padding: 0.3rem 0.2rem 0.5rem;
  }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
  .srow {
    position: relative;
    overflow: hidden;
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
  /* The currently-open song. */
  .srow.active { border-color: var(--accent); background: rgba(217, 138, 61, 0.1); }
  .stitle { font-family: var(--font-display); font-weight: 600; }
  .now { color: var(--accent); font-size: 0.7rem; font-weight: 600; margin-left: 0.4rem; white-space: nowrap; }
  .arr { color: var(--muted); font-size: 0.7rem; font-weight: 600; margin-left: 0.4rem; white-space: nowrap; border: 1px solid var(--line); border-radius: 999px; padding: 0.05rem 0.4rem; }
  .smeta { color: var(--muted); font-size: 0.82rem; font-variant-numeric: tabular-nums; white-space: nowrap; }
  /* Live playback progress along the bottom of the active row. */
  .prog {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 3px;
    background: var(--accent);
    transition: width 0.2s linear;
  }
  .empty { color: var(--muted); padding: 0.6rem 0.2rem; }
</style>
