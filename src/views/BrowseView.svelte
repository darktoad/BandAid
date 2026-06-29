<script lang="ts">
  import type { LibraryService } from '../library/libraryService';
  import type { SongSummary } from '../library/types';

  /**
   * Integrated song picker (M1). One panel — set lists *and* the full library in a
   * single scroll; tap a song to open it. No separate library / set-list / detail
   * screens. Used full-screen on first load and as the slide-over picker in the drill
   * view. The only session write is Open → onopen → setCurrentSong (D5).
   */
  let { service, onopen, onclose }: {
    service: LibraryService;
    onopen: (song: SongSummary) => void;
    onclose?: () => void; // present when shown as the slide-over
  } = $props();

  let setLists = $derived(service.getSetLists());
  let allSongs = $derived(service.getAllSongs());

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

  <div class="pbody">
    {#each setLists as l}
      <section class="group">
        <h3 class="ghead">{l.name}</h3>
        <ul class="list">
          {#each service.getSetListSongs(l.id) as s}
            <li>
              <button class="srow" onclick={() => onopen(s)}>
                <span class="stitle">{s.title}</span>
                <span class="smeta">{keyLabel(s)} · ♩ = {s.defaultTempoBpm}</span>
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/each}

    <section class="group">
      <h3 class="ghead">All songs</h3>
      {#if allSongs.length === 0}
        <p class="empty">No songs yet.</p>
      {:else}
        <ul class="list">
          {#each allSongs as s}
            <li>
              <button class="srow" onclick={() => onopen(s)}>
                <span class="stitle">{s.title}</span>
                <span class="smeta">{keyLabel(s)} · ♩ = {s.defaultTempoBpm}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
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

  .pbody { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 0.6rem 0.8rem 1.2rem; }
  .group { margin-top: 0.6rem; }
  .ghead {
    margin: 0.4rem 0.2rem 0.4rem;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
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
