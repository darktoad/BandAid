<script lang="ts">
  import Renderer from './renderer/Renderer.svelte';
  import type { RendererController, TrackInfo } from './renderer/createRenderer';
  import { createLocalSessionStore } from './session/store';
  import { projectBar, quarterNotesPerBar } from './playhead/projectBar';

  // Hardcoded for the first observable cut; library-browsing will set this later.
  const SONG = {
    id: 'big-john-mcneil',
    url: '/songs/big-john-mcneil.musicxml',
    title: 'Big John McNeil',
    timeSignature: '4/4',
    defaultTempoBpm: 120,
  };

  const store = createLocalSessionStore({ currentSongId: SONG.id });

  let controller = $state<RendererController | undefined>(undefined);
  let tracks = $state<TrackInfo[]>([]);
  let backingPart = $state(1); // default: guitar tab (track index 1)
  let bar = $state(1);
  let playing = $state(false);
  let speedPct = $state(100);
  let errorMsg = $state<string | null>(null);

  function onReady(c: RendererController, t: TrackInfo[]) {
    controller = c;
    tracks = t;
    if (t.length && !t.some((x) => x.index === backingPart)) backingPart = t[0].index;
    c.soloPart(backingPart);
  }

  function selectPart(index: number) {
    backingPart = index;
    controller?.soloPart(index);
  }

  function togglePlay() {
    if (!controller) return;
    if (playing) controller.pause();
    else controller.play();
    stampTransport();
  }

  function onSpeed(e: Event) {
    speedPct = Number((e.target as HTMLInputElement).value);
    controller?.setSpeed(speedPct / 100);
    stampTransport();
  }

  // Demonstrates the session-shaped flow: every transport change stamps the store
  // (local-transport will own this properly; here it proves the wiring).
  function stampTransport() {
    store.setTransport({
      songId: SONG.id,
      playing,
      startBar: bar,
      startTimestamp: performance.now(),
      tempo: (SONG.defaultTempoBpm * speedPct) / 100,
    });
  }

  // projectBar sanity readout — where the logical clock thinks we'd be 1s from the
  // last stamp (proves the M2 reconciliation math is wired to real song meter).
  let projected = $derived.by(() => {
    const t = $store.transport;
    if (!t) return null;
    return projectBar(t, t.startTimestamp + 1000, quarterNotesPerBar(SONG.timeSignature));
  });
</script>

<header class="topbar">
  <span class="brand">BandAid</span>
  <span class="tag">{SONG.title} · chord-changes (renderer-playhead)</span>
</header>

<div class="controls">
  <button onclick={togglePlay} disabled={!controller}>{playing ? '⏸ Pause' : '▶ Play'}</button>

  <label class="speed">
    Tempo
    <input type="range" min="50" max="110" step="5" value={speedPct} oninput={onSpeed} disabled={!controller} />
    <span class="readout">{speedPct}% · {Math.round((SONG.defaultTempoBpm * speedPct) / 100)} bpm</span>
  </label>

  <div class="parts">
    {#each tracks as t}
      <button class:active={t.index === backingPart} onclick={() => selectPart(t.index)}>{t.name}</button>
    {/each}
  </div>

  <span class="readout">bar {bar}{projected !== null ? ` · proj +1s → ${projected.toFixed(2)}` : ''}</span>
</div>

{#if errorMsg}
  <div class="error">Renderer error: {errorMsg}</div>
{/if}

<main class="stage">
  <Renderer
    musicXmlUrl={SONG.url}
    onready={onReady}
    onposition={(b) => (bar = b)}
    onplaying={(p) => (playing = p)}
    onerror={(e) => (errorMsg = e.message)}
  />
</main>

<style>
  .topbar {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    padding: 0.7rem 1rem;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  .brand { font-weight: 700; letter-spacing: 0.02em; }
  .tag { color: var(--muted); font-size: 0.85rem; }

  .controls {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.75rem 1.25rem;
    padding: 0.6rem 1rem;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  .speed { display: inline-flex; align-items: center; gap: 0.5rem; color: var(--muted); }
  .parts { display: inline-flex; gap: 0.4rem; }
  .parts button { padding: 0.35rem 0.6rem; font-size: 0.85rem; }
  .parts button.active { border-color: var(--accent); color: var(--accent); }
  .readout { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 0.85rem; }

  .error {
    padding: 0.5rem 1rem;
    background: #3a1d1d;
    color: #f1b4b4;
    font-size: 0.85rem;
  }

  .stage { flex: 1; min-height: 0; }
</style>
