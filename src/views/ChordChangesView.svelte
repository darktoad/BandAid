<script lang="ts">
  import { onMount } from 'svelte';
  import Renderer from '../renderer/Renderer.svelte';
  import type { RendererController, TrackInfo } from '../renderer/createRenderer';
  import { createLocalTransport, type LocalTransport } from '../transport/localTransport';
  import type { SessionStore } from '../session/types';

  /**
   * Chord-Changes-in-Time view (M1). A presentation template over the unified music
   * model + session transport: alphaTab renders chord symbols above the staff, its cursor
   * is the playhead, and the local-transport controller drives + stamps it.
   *
   * Mobile-layout prototype:
   *  - Compact transport bar (Play + scrubber) keeps the music tall; everything else
   *    (tempo, size, audio, "my part") folds into a "More" sheet.
   *  - Notation reflows by container width (responsive bars-per-row) for legibility.
   *  - The SHARED MELODY is the default view; a player toggles "my part" to add their
   *    own instrument staff. One alphaTab player drives both, so the part's cursor stays
   *    in lockstep with the melody — no second clock. (A fully independent split surface
   *    is the richer M3 form.)
   * Local choices (part, tempo %, audio, zoom) live here; only Transport is synced.
   */
  let { song, store, onback }: {
    song: { id: string; url: string; title: string };
    store: SessionStore;
    onback?: () => void;
  } = $props();

  let controller = $state<RendererController | undefined>(undefined);
  let transport = $state<LocalTransport | undefined>(undefined);
  let tracks = $state<TrackInfo[]>([]);
  // The shared melody is the first track; everyone sees it by default.
  let melodyIndex = $state(0);
  // The player's own part stacked under the melody (null = melody only).
  let myPart = $state<number | null>(null);
  let bar = $state(1);
  let playing = $state(false);
  let canPlay = $state(false); // true once the soundfont/player is loaded
  let speedPct = $state(100);
  let scalePct = $state(100); // notation zoom (local presentation, not transport)
  let tempoBpm = $state(120); // replaced by the score's real tempo once it loads
  let measureCount = $state(1); // scrubber range; replaced from the score once loaded
  // Audio: local, never synced. Default to hearing the arrangement; click off.
  let synth = $state(true);
  let click = $state(false);
  let countIn = $state(true); // one-bar count-in before play (local pref, FR-6)
  let showMore = $state(false); // the overflow sheet
  let errorMsg = $state<string | null>(null);

  let stageEl: HTMLElement;
  let lastBarsPerRow = 0;

  // Responsive notation: fewer bars per row on narrow screens so notes aren't crowded.
  function barsForWidth(w: number): number {
    if (w <= 480) return 2;
    if (w <= 900) return 3;
    return 4;
  }
  function applyResponsiveLayout(w: number) {
    const bpr = barsForWidth(w);
    if (bpr === lastBarsPerRow || !controller) return;
    lastBarsPerRow = bpr;
    controller.setBarsPerRow(bpr);
  }

  onMount(() => {
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? stageEl.clientWidth;
      applyResponsiveLayout(w);
    });
    if (stageEl) ro.observe(stageEl);
    return () => ro.disconnect();
  });

  function onReady(c: RendererController, t: TrackInfo[]) {
    controller = c;
    tracks = t;
    if (t.length && !t.some((x) => x.index === melodyIndex)) melodyIndex = t[0].index;
    renderSelection();

    const info = c.getSongInfo();
    tempoBpm = info?.tempoBpm ?? 120;
    measureCount = info?.measureCount ?? 1;
    transport = createLocalTransport({
      songId: song.id,
      defaultTempoBpm: tempoBpm,
      measureCount,
      renderer: c,
      store,
    });
    // Apply this song's saved performance overrides (tempo); absent = canonical default.
    const saved = store.getSongSettings(song.id);
    speedPct = saved.tempoPct !== undefined ? Math.round(saved.tempoPct * 100) : 100;
    transport.setTempoPercent(speedPct / 100);
    applyAudio();
    // Apply the responsive bars-per-row for the current width on first render.
    lastBarsPerRow = 0;
    if (stageEl) applyResponsiveLayout(stageEl.clientWidth);
  }

  // Melody alone, or melody + the player's part stacked (one player → synced cursors).
  function renderSelection() {
    if (!controller) return;
    if (myPart === null || myPart === melodyIndex) controller.renderTracks([melodyIndex]);
    else controller.renderTracks([melodyIndex, myPart]);
  }

  function selectMyPart(index: number | null) {
    myPart = index;
    renderSelection();
  }

  function applyAudio() {
    controller?.setMasterVolume(synth ? 1 : 0);
    controller?.setMetronomeVolume(click ? 1 : 0);
  }
  function toggleSynth() {
    synth = !synth;
    controller?.setMasterVolume(synth ? 1 : 0);
  }
  function toggleClick() {
    click = !click;
    controller?.setMetronomeVolume(click ? 1 : 0);
  }
  function toggleCountIn() {
    countIn = !countIn;
    transport?.setCountIn(countIn);
  }

  function togglePlay() {
    if (!transport) return;
    if (playing) transport.pause();
    else transport.play();
  }

  function onSpeed(e: Event) {
    speedPct = Number((e.target as HTMLInputElement).value);
    transport?.setTempoPercent(speedPct / 100);
    // Persist as a per-song override (shared session state); 100% = default, so clear it.
    if (speedPct === 100) store.resetSongSetting(song.id, 'tempoPct');
    else store.setSongSetting(song.id, { tempoPct: speedPct / 100 });
  }
  // Reset tempo to the song's canonical default (clears the override).
  function resetTempo() {
    speedPct = 100;
    transport?.setTempoPercent(1);
    store.resetSongSetting(song.id, 'tempoPct');
  }
  // True when tempo differs from the canonical default (drives the modified dot + reset).
  let tempoModified = $derived(speedPct !== 100);
  function onScale(e: Event) {
    scalePct = Number((e.target as HTMLInputElement).value);
    controller?.setScale(scalePct / 100);
  }
  function onScrub(e: Event) {
    const target = Number((e.target as HTMLInputElement).value);
    bar = target;
    transport?.seekToBar(target);
  }

  // Spacebar toggles play/pause on laptop. Ignore when focused in a control.
  function onKeydown(e: KeyboardEvent) {
    if (e.code !== 'Space') return;
    const el = e.target as HTMLElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON')) return;
    e.preventDefault();
    if (canPlay) togglePlay();
  }

  // The parts a player can overlay as "their part" — everything but the shared melody.
  let overlayParts = $derived(tracks.filter((t) => t.index !== melodyIndex));
  let myPartName = $derived(
    myPart === null ? 'Melody only' : (tracks.find((t) => t.index === myPart)?.name ?? 'Melody only'),
  );
</script>

<svelte:window onkeydown={onKeydown} />

<header class="topbar">
  {#if onback}
    <button class="back" onclick={onback} aria-label="Back to library">←</button>
  {/if}
  <span class="brand">BandAid</span>
  <span class="tag">{song.title} · chord changes</span>
</header>

<!-- Compact, always-visible transport: Play + scrubber keep the music tall. -->
<div class="transport">
  <button class="play" onclick={togglePlay} disabled={!transport || !canPlay}>
    {!canPlay ? '⏳' : playing ? '⏸' : '▶'}
  </button>

  <input
    class="scrub"
    type="range"
    min="1"
    max={measureCount}
    step="1"
    value={bar}
    oninput={onScrub}
    disabled={!transport}
    aria-label="Seek to bar"
  />
  <span class="readout">{bar}/{measureCount}</span>

  <button class="more" class:active={showMore} onclick={() => (showMore = !showMore)} aria-expanded={showMore}>
    ⋯
  </button>
</div>

<!-- Overflow sheet: tempo, size, audio, and the player's own part live here. -->
{#if showMore}
  <div class="sheet">
    <label class="row">
      <span class="label">Tempo{#if tempoModified}<span class="dot" title="Changed from default">●</span>{/if}</span>
      <input type="range" min="50" max="110" step="5" value={speedPct} oninput={onSpeed} disabled={!transport} />
      <span class="readout">{speedPct}% · {Math.round((tempoBpm * speedPct) / 100)} bpm</span>
      <button class="reset" onclick={resetTempo} disabled={!transport || !tempoModified} title="Reset to original tempo">↺</button>
    </label>

    <label class="row">
      <span class="label">Size</span>
      <input type="range" min="75" max="225" step="25" value={scalePct} oninput={onScale} disabled={!controller} />
      <span class="readout">{scalePct}%</span>
    </label>

    <div class="row">
      <span class="label">Audio</span>
      <div class="chips">
        <button class:active={synth} onclick={toggleSynth} disabled={!controller}>🔊 Sound</button>
        <button class:active={click} onclick={toggleClick} disabled={!controller}>🥁 Click</button>
        <button class:active={countIn} onclick={toggleCountIn} disabled={!transport}>🔔 Count-in</button>
      </div>
    </div>

    <div class="row">
      <span class="label">My part</span>
      <div class="chips">
        <button class:active={myPart === null} onclick={() => selectMyPart(null)}>Melody only</button>
        {#each overlayParts as t}
          <button class:active={t.index === myPart} onclick={() => selectMyPart(t.index)}>{t.name}</button>
        {/each}
      </div>
    </div>
  </div>
{/if}

{#if errorMsg}
  <div class="error">Renderer error: {errorMsg}</div>
{/if}

<main class="stage" bind:this={stageEl}>
  <Renderer
    musicXmlUrl={song.url}
    onready={onReady}
    onposition={(b) => (bar = b)}
    onplaying={(p) => (playing = p)}
    onplayable={() => (canPlay = true)}
    onerror={(e) => (errorMsg = e.message)}
  />
</main>

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
  .back { flex: 0 0 auto; min-width: 2.2rem; min-height: 2.2rem; font-size: 1rem; align-self: center; }

  /* One short row, always visible — does not grow with the number of controls. */
  .transport {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.45rem 1rem;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  .transport .play,
  .transport .more {
    flex: 0 0 auto;
    min-width: 2.6rem;
    min-height: 2.4rem; /* comfortable tap target on mobile */
    font-size: 1rem;
  }
  .transport .more.active { border-color: var(--accent); color: var(--accent); }
  .scrub { flex: 1 1 auto; min-width: 0; }
  .readout { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 0.85rem; flex: 0 0 auto; }

  /* The overflow sheet stacks its rows vertically so each control gets full width. */
  .sheet {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.7rem 1rem;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  .sheet .row { display: flex; align-items: center; gap: 0.6rem; }
  .sheet .row .label { flex: 0 0 4.5rem; color: var(--muted); font-size: 0.85rem; }
  .dot { color: var(--accent); font-size: 0.6rem; vertical-align: middle; margin-left: 0.25rem; }
  .reset {
    flex: 0 0 auto;
    min-width: 2rem;
    min-height: 2rem;
    font-size: 0.95rem;
    line-height: 1;
  }
  .reset:disabled { opacity: 0.3; }
  .sheet .row input[type='range'] { flex: 1 1 auto; min-width: 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .chips button { padding: 0.4rem 0.7rem; font-size: 0.85rem; min-height: 2.2rem; }
  .chips button.active { border-color: var(--accent); color: var(--accent); }

  .error {
    padding: 0.5rem 1rem;
    background: #3a1d1d;
    color: #f1b4b4;
    font-size: 0.85rem;
  }

  .stage { flex: 1; min-height: 0; }
</style>
