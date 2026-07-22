# Performance View (PR 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spec Parts 3–4 ([2026-07-18 design](../specs/2026-07-18-band-book-and-performance-view-design.md)): page-mode Fit (the whole page always fits, via CSS transform — cannot fail, instant, crisp), notation+lyrics split view, collapsible header bars, and chord-overlay-off-by-default — all behind a per-device **View: Classic / Rehearsal** toggle so the guitarist can revert in two taps.

**Architecture:** One boolean pref (`rehearsalView`, default ON) gates every behavior fork *inline* in `ChordChangesView` — no second component, so transport/sync/lyrics logic stays single-path and the Classic view remains byte-identical behavior. Page mode: engrave at the Size slider's scale, then CSS-`scale()` the rendered SVG down to the viewport (`pageZoom` prop on `Renderer`, height-clamped wrapper so no ghost scroll space); Fit and Size stop fighting over `scalePct` — Fit is the transform, Size is the engraving. The lyrics pane reuses the same pure `pageScale` math to shrink the whole ChordPro sheet into its pane. The classic walk-fit (planFit/settle) is untouched and still runs when the toggle says Classic.

**Tech Stack:** Svelte 5, TypeScript, CSS transforms + ResizeObserver, Vitest for the pure scale math.

## Global Constraints

- **Prerequisite:** the current stack (#57 beta channel, #58 fit rework, #59 sync split, #60 session count) must be **merged to main first** — this PR builds on ChordChangesView as shaped by #58 *and* #59, which live on separate branches until then. Branch `feat/performance-view` off post-merge `main`. Do not start implementation before the stack lands.
- Escape hatch (spec Part 5): everything here except the overlay default ships gated on the **Rehearsal** view pref; **default ON** with two-tap revert (settings sheet → View → Classic). Pref key `bandaid.rehearsalView`, value `'classic'` = opted out (mirrors the `bandaid.autoFit` opt-out pattern).
- Page mode (spec Part 3): the 75% engraving floor STAYS (Size slider range untouched); the transform is what fits the page. Default Fit ON is inherited (existing `bandaid.autoFit` pref). Pinch-to-zoom out of scope.
- Collapse (spec Part 4, option a): **manual only** — never triggered by play/pause or any transport state (standing rule: never key UI off playback state). Collapsed = topbar + transport + settings sheet all hidden; one small semi-transparent corner button restores. State personal, persisted (`bandaid.barsCollapsed`).
- Split view (spec Part 4 + David's 2026-07-18 review of the mockups): landscape = side-by-side, portrait = stacked, chosen by CSS orientation media query; pane visibility personal, persisted (`bandaid.lyricsPane`); both panes follow song + key (transpose already flows into `displaySheet`). A **draggable splitter** between the panes (touch + mouse; ratio clamped 25–60%, persisted per orientation: `bandaid.paneSplit.landscape` / `bandaid.paneSplit.portrait`). **Pinch zoom per pane** over the auto-fit baseline (two-pointer pinch on touch; Ctrl+wheel on desktop — that's the dev-PC path): pinching the notation disengages the Fit pill (tap Fit to snap back); the lyrics pane refits on double-tap. Zoom is ephemeral (never persisted); the splitter ratio persists. In Classic view the lyrics button keeps opening the full-screen modal.
- Chord overlay defaults **off** (personal-practice tool) — ungated (it's a default; every existing device has a saved pref, so nobody's current setting changes).
- **Out of scope (flag to David, do not build):** personal practice-tempo-% over the Band Book tempo (deferred from PR 2 planning — its own PR later); any Session/sync changes. (Pinch zoom and pane resizing were originally deferred by the spec but are now IN scope — David's explicit review feedback on the mockups.)
- Standing rules: PR into `main`; no VERSION/CHANGELOG; `npm test` + `npm run check` green; remix:check untouched. Dev-PC verification; real-device pass via the beta channel afterwards.
- **Routine breakpoint check: open `/devices.html`** on the dev server. It shows the app in real iframes at every band device in both orientations (iPhone, iPad, Android tablet) plus the 880px chart-width crossover, so a layout change is checked everywhere in one glance. Each iframe is the device's true CSS viewport, so media queries, `innerWidth/innerHeight` orientation and ResizeObserver all behave as on hardware. Use **True size** (after calibrating Monitor CSS DPI against the on-screen ruler) whenever judging legibility — emulation at 100% shows a phone ~1.5x larger than it is in the hand, which is how too-small text gets approved.
- **No scrollbars in rehearsal panes, ever** (David): both panes hide scrollbars entirely (`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`) and drop the classic view's reserved gutter — panning works by wheel (Shift+wheel horizontal) and touch swipe. Bonus: with zero-width scrollbars the overflow state can't change the render width, killing the width-feedback class of bugs in rehearsal mode outright. Classic view keeps its visible scrollbars + `scrollbar-gutter: stable` — the walk-fit's determinism depends on that stable width.
- Known-risk checks to run explicitly in the browser (may pass, must be looked at): click-to-seek accuracy on transformed notation (alphaTab hit-testing under CSS scale); cursor/playhead visual alignment in page mode; **gesture conflicts** — pinch on the panes must not trigger browser page-zoom (`touch-action: none` on the gesture surfaces, `preventDefault()` on Ctrl+wheel) and must not fight the splitter drag or alphaTab's own pointer handling; **pan when zoomed in** — a manually zoomed pane overflows its box and must scroll/pan in both axes.

---

### Task 1: `pageScale` — one pure shrink-to-fit function for both panes

**Files:**
- Create: `src/views/pageScale.ts`
- Test: `src/views/pageScale.test.ts`

**Interfaces:**
- Produces: `pageScale(viewW, viewH, contentW, contentH): number` — the largest uniform scale ≤ 1 that fits the content box in the view box; `1` on degenerate input. Consumed by Tasks 2 (notation page mode) and 4 (lyrics pane).

- [ ] **Step 1: Create the branch** (only after the #57–#60 stack is merged)

```bash
git checkout main && git pull && git checkout -b feat/performance-view
```

- [ ] **Step 2: Write the failing tests**

Create `src/views/pageScale.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pageScale } from './pageScale';

describe('pageScale', () => {
  it('shrinks by the tighter dimension', () => {
    expect(pageScale(1000, 500, 1000, 1000)).toBe(0.5); // height-bound
    expect(pageScale(500, 2000, 1000, 1000)).toBe(0.5); // width-bound
  });

  it('never scales UP — content smaller than the view stays at 1', () => {
    expect(pageScale(1000, 1000, 400, 300)).toBe(1);
  });

  it('is 1 on degenerate boxes (nothing measured yet)', () => {
    expect(pageScale(0, 500, 1000, 1000)).toBe(1);
    expect(pageScale(1000, 500, 0, 0)).toBe(1);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/views/pageScale.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `src/views/pageScale.ts`:

```ts
/**
 * The largest uniform scale (≤ 1) that fits a content box inside a view box — the
 * "photo of the sheet" shrink shared by page-mode Fit (notation) and the lyrics
 * pane. Never upscales: content that already fits renders at natural size.
 * Degenerate boxes (nothing measured yet) → 1, i.e. no transform.
 */
export function pageScale(viewW: number, viewH: number, contentW: number, contentH: number): number {
  if (viewW <= 0 || viewH <= 0 || contentW <= 0 || contentH <= 0) return 1;
  return Math.min(1, viewW / contentW, viewH / contentH);
}
```

- [ ] **Step 5: Run to verify pass, commit**

Run: `npx vitest run src/views/pageScale.test.ts`
Expected: PASS (3).

```bash
git add src/views/pageScale.ts src/views/pageScale.test.ts
git commit -m "feat(view): pure page-scale helper"
```

### Task 2: Rehearsal toggle + page-mode Fit

**Files:**
- Modify: `src/renderer/Renderer.svelte` (pageZoom prop, surface bindable, height clamp)
- Modify: `src/views/ChordChangesView.svelte` (pref, View row, zoom computation, fit gating)

**Interfaces:**
- Consumes: `pageScale` (Task 1).
- Produces: `Renderer` props `pageZoom?: number` (default 1) and `surfaceEl?: HTMLDivElement` ($bindable). View state `rehearsalView: boolean` + `setRehearsalView(on)` — Tasks 3 and 4 gate on `rehearsalView`.

- [ ] **Step 1: Renderer — surface binding, transform, clamp**

In `src/renderer/Renderer.svelte`, add the two props and rename the internal `host`:

```ts
  let {
    musicXmlUrl,
    onready,
    onerror,
    onposition,
    onplaying,
    onplayable,
    scrollEl = $bindable(),
    surfaceEl = $bindable(),
    pageZoom = 1,
  }: {
    musicXmlUrl: string;
    onready?: (controller: RendererController, tracks: TrackInfo[]) => void;
    onerror?: (err: Error) => void;
    onposition?: (bar: number) => void;
    onplaying?: (playing: boolean) => void;
    onplayable?: () => void;
    /** The scrolling wrapper, bound out so the view can drive paged auto-scroll. */
    scrollEl?: HTMLDivElement;
    /** The alphaTab surface, bound out so the view can measure natural page size. */
    surfaceEl?: HTMLDivElement;
    /** Page-mode shrink (≤1): CSS-scales the rendered page; 1 = no transform. */
    pageZoom?: number;
  } = $props();

  let controller: RendererController | undefined;
  // The surface's LAYOUT height (transform-independent), for the clamp below.
  let surfaceH = $state(0);

  onMount(async () => {
    // Track natural height across re-renders; CSS transforms don't fire this,
    // so scaling can't feed back into itself.
    const ro = new ResizeObserver(() => (surfaceH = surfaceEl?.offsetHeight ?? 0));
    if (surfaceEl) ro.observe(surfaceEl);
    try {
      controller = await createRenderer(surfaceEl!, musicXmlUrl);
```

(rest of onMount unchanged; add `ro.disconnect()` via returning a cleanup — Svelte 5 allows returning a teardown from `onMount`'s callback only when synchronous, and this one is async, so instead disconnect in `onDestroy`: hoist `let ro: ResizeObserver | undefined;` above `onMount`, assign inside, and extend `onDestroy(() => { ro?.disconnect(); controller?.destroy(); });`.)

Markup + styles:

```svelte
<div class="render-scroll" bind:this={scrollEl}>
  <!-- Page mode: the surface keeps its natural LAYOUT size (alphaTab lays out to it);
       the transform shrinks only the pixels, and the clamp trims the ghost scroll
       space the untransformed layout box would leave behind. -->
  <div class="page-clamp" style:height={pageZoom < 1 ? `${Math.ceil(surfaceH * pageZoom)}px` : undefined}>
    <div
      class="render-surface"
      bind:this={surfaceEl}
      style:transform={pageZoom < 1 ? `scale(${pageZoom})` : undefined}
    ></div>
  </div>
</div>
```

Add to the style block:

```css
  .page-clamp {
    overflow: hidden;
  }
  .render-surface {
    transform-origin: top center;
  }
```

(`overflow: hidden` only bites when the clamp height is set; at `pageZoom = 1` the clamp has auto height and nothing is cut.)

- [ ] **Step 2: ChordChangesView — pref + View row**

Add near the other view prefs (masthead/rowBreaks pattern):

```ts
  // Rehearsal view (spec Parts 3–4): page-mode Fit, split lyrics, collapsible bars.
  // Default ON; 'classic' is the two-tap escape hatch. Personal, per device.
  let rehearsalView = $state(loadRehearsalPref());
  function loadRehearsalPref(): boolean {
    try {
      return typeof localStorage === 'undefined' || localStorage.getItem('bandaid.rehearsalView') !== 'classic';
    } catch {
      return true;
    }
  }
  function setRehearsalView(on: boolean) {
    if (on === rehearsalView) return;
    rehearsalView = on;
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('bandaid.rehearsalView', on ? 'on' : 'classic');
    } catch {
      /* ignore */
    }
    // Re-establish the mode's own fit: classic walks renders; rehearsal just zooms.
    if (fitOn) void fitToView();
  }
```

Settings sheet, new row directly under the Session/Band rows (before Title):

```svelte
    <!-- The performance-view escape hatch (spec Part 5): Classic restores the pre-PR-3
         experience in two taps. Personal, per device. -->
    <div class="row">
      <span class="label">View</span>
      <div class="chips">
        <button class:active={!rehearsalView} aria-pressed={!rehearsalView} onclick={() => setRehearsalView(false)}>Classic</button>
        <button class:active={rehearsalView} aria-pressed={rehearsalView} onclick={() => setRehearsalView(true)}>Rehearsal</button>
      </div>
    </div>
```

- [ ] **Step 3: ChordChangesView — page zoom wiring**

Imports: add `pageScale`:

```ts
  import { pageScale } from './pageScale';
```

State + computation (near the fit machinery):

```ts
  let renderSurfaceEl = $state<HTMLDivElement | undefined>(undefined);
  // Page-mode shrink: recomputed from the latest render + viewport; 1 in classic view
  // or with Fit off (normal scroll + paged auto-turn take over).
  let pageZoom = $state(1);
  function recomputePageZoom() {
    const scroller = renderScrollEl;
    const surface = renderSurfaceEl;
    if (!rehearsalView || !fitOn || !scroller || !surface) {
      pageZoom = 1;
      return;
    }
    pageZoom = pageScale(scroller.clientWidth, scroller.clientHeight, surface.offsetWidth, surface.offsetHeight);
  }
  $effect(() => {
    void renderTick; // every completed render can change the page's natural size
    void fitOn;
    void rehearsalView;
    recomputePageZoom();
  });
```

Gate the walk-fit — first line of `fitToView`:

```ts
  async function fitToView() {
    // Rehearsal view: Fit is a CSS transform over the engraved page — no render walk,
    // cannot fail to fit, and Size (engraving scale) stays independent (spec Part 3).
    if (rehearsalView) {
      recomputePageZoom();
      return;
    }
```

In the ResizeObserver handler (`onMount` block), replace the debounce body so rehearsal mode re-zooms immediately (transform is cheap; the debounce exists for the classic render walk):

```ts
      if (initialObserve || !fitOn || !didInitialFit) return;
      if (rehearsalView) {
        recomputePageZoom();
        return;
      }
      clearTimeout(fitDebounce);
```

In `onScale`, make Size independent of Fit in rehearsal view:

```ts
  function onScale(e: Event) {
    if (!rehearsalView) releaseFit(); // classic: dragging Size takes manual control
    scalePct = Number((e.target as HTMLInputElement).value);
    controller?.setScale(scalePct / 100);
  }
```

And update the Fit pill's `title` to describe both modes:

```svelte
    title={rehearsalView
      ? 'Keep the whole page in view (Size adjusts engraving legibility independently)'
      : 'Keep the whole tune sized to the view — adjusting Size takes back manual control'}
```

Pass the new props to `<Renderer>`:

```svelte
    <Renderer
      musicXmlUrl={song.url}
      bind:scrollEl={renderScrollEl}
      bind:surfaceEl={renderSurfaceEl}
      pageZoom={rehearsalView && fitOn ? pageZoom : 1}
```

- [ ] **Step 4: Suite + typecheck**

Run: `npm test && npm run check`
Expected: green. (No unit tests cover the Svelte wiring — the browser pass below is the test.)

- [ ] **Step 5: Browser verification (dev server, this branch)**

1. Wabash at desktop size, Rehearsal + Fit on → the whole tune visible, no scrollbar; Version of truth: `document.querySelector('.render-surface').style.transform` shows a `scale(…)` < 1 when the tune is long.
2. Resize to iPhone (375×812): still the whole page visible (this is the spec's "cannot fail" acceptance — classic view could not do this below the 75% floor).
3. Drag Size up: engraving gets denser/reflows, page still fits (zoom compensates), **Fit pill stays on** — independence.
4. Fit off: transform gone, normal scroll + paged auto-turn at the engraved size.
5. View → Classic: old behavior exactly (walk-fit, Size disengages Fit); View → Rehearsal restores page mode.
6. **Risk checks:** click a bar in the shrunken notation → cursor/seek lands on that bar (alphaTab hit-testing under transform); play a few bars → cursor visually tracks the notes.
7. Console clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/Renderer.svelte src/views/ChordChangesView.svelte
git commit -m "feat(view): rehearsal view toggle + page-mode fit (whole page on any screen)"
```

### Task 3: Collapsible header bars

**Files:**
- Modify: `src/views/ChordChangesView.svelte`

**Interfaces:**
- Consumes: `rehearsalView` (Task 2).
- Produces: `barsCollapsed: boolean` state; markup gates.

- [ ] **Step 1: State + persistence**

```ts
  // Collapsed bars (spec Part 4, option a): manual only — NEVER driven by playback
  // state. Personal, persisted so a gig device stays collapsed across reloads.
  let barsCollapsed = $state(loadCollapsedPref());
  function loadCollapsedPref(): boolean {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem('bandaid.barsCollapsed') === '1';
    } catch {
      return false;
    }
  }
  function setBarsCollapsed(on: boolean) {
    barsCollapsed = on;
    if (on) showMore = false; // the sheet is part of the chrome being hidden
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('bandaid.barsCollapsed', on ? '1' : '0');
    } catch {
      /* ignore */
    }
  }
```

Extend `onKeydown`'s Escape branch (restore is the first Escape priority when collapsed):

```ts
    if (e.code === 'Escape') {
      if (rehearsalView && barsCollapsed) setBarsCollapsed(false);
      else if (lyricsOpen) closeLyrics();
      else if (showMore) showMore = false;
      return;
    }
```

- [ ] **Step 2: Markup**

Wrap the topbar + transport + sheet block (from `<header class="topbar">` through the closing `{/if}` of the settings sheet) in:

```svelte
{#if !(rehearsalView && barsCollapsed)}
  …existing topbar / transport / sheet markup…
{/if}
```

Add a collapse button at the END of the transport strip (after the Tempo pill), rehearsal-only:

```svelte
  {#if rehearsalView}
    <button class="iconbtn" onclick={() => setBarsCollapsed(true)} aria-label="Hide controls" title="Hide the control bars (Esc or the corner button brings them back)">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6,14 12,8 18,14" /></svg>
    </button>
  {/if}
```

And the restore button, outside the collapsed block (top level, next to the error banner):

```svelte
{#if rehearsalView && barsCollapsed}
  <button class="restore-bars" onclick={() => setBarsCollapsed(false)} aria-label="Show controls">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6,10 12,16 18,10" /></svg>
  </button>
{/if}
```

Styles:

```css
  /* Collapsed-chrome restore: the ONLY thing on screen besides the music. Small,
     semi-transparent, corner placement per spec; above alphaTab cursors (z 1000). */
  .restore-bars {
    position: fixed;
    top: 0.5rem;
    right: 0.5rem;
    z-index: 1005;
    width: 2.2rem;
    height: 2.2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border-radius: 50%;
    opacity: 0.45;
  }
  .restore-bars:hover,
  .restore-bars:focus-visible {
    opacity: 1;
  }
  @media (pointer: coarse) {
    .restore-bars { width: 2.75rem; height: 2.75rem; }
  }
```

- [ ] **Step 3: Verify in browser**

1. Rehearsal view: chevron-up at the transport's right end; tap → topbar/transport/sheet vanish, notation re-fits to the full height (the stage ResizeObserver fires), corner ⌄ button appears semi-transparent top-right.
2. Tap the corner button (and separately, press Escape) → bars return, page re-fits back.
3. Play/pause before collapsing, collapse, play again via spacebar → nothing about playback touches the collapse state.
4. Reload while collapsed → still collapsed (persisted); View → Classic → bars always shown, no chevron.

- [ ] **Step 4: Commit**

```bash
git add src/views/ChordChangesView.svelte
git commit -m "feat(view): collapsible header bars with corner restore"
```

### Task 4: Notation + lyrics split view

**Files:**
- Modify: `src/views/ChordChangesView.svelte`

**Interfaces:**
- Consumes: `rehearsalView` (Task 2), `pageScale` (Task 1), existing `displaySheet`/`LyricsSheet`/lyrics fetch.
- Produces: `lyricsPane: boolean` state (persisted).

- [ ] **Step 1: Refactor the lyrics fetch for two consumers**

Extract from `openLyrics` (modal keeps working):

```ts
  async function ensureLyricsLoaded() {
    if (!song.lyricsUrl || lyricsSheet || lyricsLoading) return;
    lyricsLoading = true;
    lyricsError = null;
    try {
      const res = await fetch(song.lyricsUrl);
      if (!res.ok) throw new Error(`Failed to load lyrics: ${res.status}`);
      lyricsSheet = parseChordPro(await res.text());
    } catch (e) {
      lyricsError = e instanceof Error ? e.message : String(e);
    } finally {
      lyricsLoading = false;
    }
  }
  async function openLyrics() {
    lyricsReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lyricsOpen = true;
    void ensureLyricsLoaded();
  }
```

- [ ] **Step 2: Pane state + toggle routing**

```ts
  // Split view (spec Part 4): the lyrics/banter sheet beside (landscape) or under
  // (portrait) the notation. Personal + persisted. In classic view the lyrics button
  // keeps opening the full-screen modal instead.
  let lyricsPane = $state(loadLyricsPanePref());
  function loadLyricsPanePref(): boolean {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem('bandaid.lyricsPane') === '1';
    } catch {
      return false;
    }
  }
  function toggleLyricsPane() {
    lyricsPane = !lyricsPane;
    if (lyricsPane) void ensureLyricsLoaded();
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('bandaid.lyricsPane', lyricsPane ? '1' : '0');
    } catch {
      /* ignore */
    }
  }
```

Topbar lyrics button `onclick` becomes:

```svelte
    <button class="iconbtn" class:active={rehearsalView && lyricsPane} onclick={() => (rehearsalView ? toggleLyricsPane() : openLyrics())} aria-label="Notes and lyrics" title="Notes &amp; lyrics">
```

If the pane opens on a song load with the pref already on, lyrics must load too — add next to the other load-time work in `onReady`:

```ts
    if (rehearsalView && lyricsPane) void ensureLyricsLoaded();
```

- [ ] **Step 3: Pane markup + fit-to-pane**

State + effect:

```ts
  let paneEl = $state<HTMLElement | undefined>(undefined);
  let paneContentEl = $state<HTMLElement | undefined>(undefined);
  let paneZoom = $state(1);
  // Fit-to-pane: the WHOLE ChordPro sheet shrinks into the pane — no mid-song
  // scrolling (spec Part 4). Content width equals pane width (block layout), so
  // height is the binding dimension; re-runs on pane/content resize (orientation,
  // collapse, key change reflowing chords).
  $effect(() => {
    const pane = paneEl;
    const content = paneContentEl;
    if (!pane || !content) {
      paneZoom = 1;
      return;
    }
    const compute = () => (paneZoom = pageScale(pane.clientWidth, pane.clientHeight, content.offsetWidth, content.offsetHeight));
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(pane);
    ro.observe(content);
    return () => ro.disconnect();
  });
```

Splitter state (persisted per orientation; David's mockup-review request):

```ts
  // Pane split: the fraction of the panes box the LYRICS pane gets. Draggable via the
  // splitter; clamped so neither pane collapses; remembered separately per orientation
  // (a good side-by-side width is not a good stacked height).
  const orientationMq = typeof matchMedia !== 'undefined' ? matchMedia('(orientation: landscape)') : undefined;
  let isLandscape = $state(orientationMq?.matches ?? true);
  onMount(() => {
    const onOrient = () => (isLandscape = orientationMq?.matches ?? true);
    orientationMq?.addEventListener('change', onOrient);
    return () => orientationMq?.removeEventListener('change', onOrient);
  });
  function loadSplit(key: string, fallback: number): number {
    try {
      const v = Number(typeof localStorage !== 'undefined' ? localStorage.getItem(key) : NaN);
      return v >= 0.25 && v <= 0.6 ? v : fallback;
    } catch {
      return fallback;
    }
  }
  let splitLandscape = $state(loadSplit('bandaid.paneSplit.landscape', 0.36));
  let splitPortrait = $state(loadSplit('bandaid.paneSplit.portrait', 0.42));
  let splitFrac = $derived(isLandscape ? splitLandscape : splitPortrait);
  let panesEl = $state<HTMLElement | undefined>(undefined);
  function startSplitDrag(e: PointerEvent) {
    const panes = panesEl;
    if (!panes) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = panes.getBoundingClientRect();
      const frac = isLandscape ? (r.right - ev.clientX) / r.width : (r.bottom - ev.clientY) / r.height;
      const clamped = Math.min(0.6, Math.max(0.25, frac));
      if (isLandscape) splitLandscape = clamped;
      else splitPortrait = clamped;
    };
    const up = () => {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('bandaid.paneSplit.landscape', String(splitLandscape));
          localStorage.setItem('bandaid.paneSplit.portrait', String(splitPortrait));
        }
      } catch {
        /* ignore */
      }
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
```

Restructure the stage markup (masthead stays above the panes):

```svelte
<main class="stage" class:split={rehearsalView && lyricsPane} bind:this={stageEl}>
  {#if showMasthead}
    …existing masthead…
  {/if}
  <div class="panes" bind:this={panesEl}>
    <div class="render-wrap">
      <Renderer … />
    </div>
    {#if rehearsalView && lyricsPane}
      <div
        class="splitter"
        role="separator"
        aria-orientation={isLandscape ? 'vertical' : 'horizontal'}
        aria-label="Resize lyrics pane"
        onpointerdown={startSplitDrag}
      ></div>
      <aside class="lyrics-pane" bind:this={paneEl} style:flex-basis={`${splitFrac * 100}%`} aria-label="Lyrics and notes">
        <div class="pane-content" bind:this={paneContentEl} style:transform={paneZoom < 1 ? `scale(${paneZoom})` : undefined}>
          {#if lyricsError}
            <p class="lyrics-msg">{lyricsError}</p>
          {:else if lyricsLoading && !lyricsSheet}
            <p class="lyrics-msg">Loading…</p>
          {:else}
            <LyricsSheet note={song.notes} sheet={displaySheet ?? undefined} />
          {/if}
        </div>
      </aside>
    {/if}
  </div>
</main>
```

Styles (replace `.render-wrap`'s rule and add):

```css
  .panes {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column; /* portrait: notation over lyrics */
  }
  .render-wrap { flex: 1 1 auto; min-height: 0; min-width: 0; }
  .lyrics-pane {
    flex: 0 0 42%;
    min-height: 0;
    overflow: hidden; /* fit-to-pane means never scroll */
    border-top: 1px solid var(--line);
    background: var(--panel);
    padding: 0.6rem 0.8rem;
  }
  .pane-content { transform-origin: top center; }
  /* The splitter: a thin visible line with a fat touch target (padding-box trick).
     touch-action none — dragging it must never scroll the page. */
  .splitter {
    flex: 0 0 10px;
    touch-action: none;
    cursor: row-resize;
    background: linear-gradient(to bottom, transparent 4px, var(--line) 4px, var(--line) 6px, transparent 6px);
  }
  @media (orientation: landscape) {
    .stage.split .panes { flex-direction: row; }
    .stage.split .splitter {
      cursor: col-resize;
      background: linear-gradient(to right, transparent 4px, var(--line) 4px, var(--line) 6px, transparent 6px);
    }
    .stage.split .lyrics-pane {
      border-top: none;
      border-left: none;
    }
  }
```

(The `flex-basis` inline style from `splitFrac` replaces the fixed 42%/36% — remove those from the `.lyrics-pane` rules.)

- [ ] **Step 4: Notation width must track its own pane, not the stage**

The responsive bars-per-row + re-fit observer watches `stageEl`, whose width no longer shrinks when the pane opens. Retarget it to the notation's scroller — in the `onMount` ResizeObserver block, change:

```ts
    if (stageEl) ro.observe(stageEl);
```

to:

```ts
    // Observe the notation's own box: with the lyrics pane open the stage keeps its
    // width but the notation loses ~a third of it, and bars-per-row + fit must react
    // to the box the music actually renders in. (Height signals — sheet, collapse —
    // reach this box identically.)
    const observed = renderScrollEl ?? stageEl;
    if (observed) ro.observe(observed);
```

(`renderScrollEl` is bound before `onMount` runs — children mount first; the `?? stageEl` is a safety net, not an expected path.)

- [ ] **Step 5: Suite + typecheck + browser verification**

Run: `npm test && npm run check` — green.

Browser:

1. Rehearsal view, open a lyrics song (Wabash): tap the ⓘ lyrics button → pane appears (portrait window: stacked below; landscape/wide: right side). Whole sheet visible, no scrollbar in the pane (transform shrink visible on long sheets).
2. Notation re-fits to its narrower box (page mode) and bars-per-row drops if the width crossed a breakpoint.
3. **Splitter:** drag the divider — both panes re-fit live while dragging; release, reload → ratio remembered. Rotate → the *other* orientation's remembered ratio applies. Clamps: can't drag the lyrics pane under 25% or over 60%.
4. Change Key ± → chord labels update in BOTH panes (existing `displaySheet` transpose flow).
5. Rotate (DevTools emulation portrait↔landscape) → pane flips stacked↔side-by-side, both panes re-fit.
6. Tap the lyrics button again → pane closes, notation reclaims the full width and re-fits. Reload with pane open → persists.
7. View → Classic → lyrics button opens the old full-screen modal; no pane, no splitter anywhere.
8. Songs without lyrics: button hidden (existing gate `song.notes || song.lyricsUrl` — pane never renders empty).
9. Console clean.

- [ ] **Step 6: Commit**

```bash
git add src/views/ChordChangesView.svelte
git commit -m "feat(view): notation + lyrics split view with fit-to-pane"
```

### Task 5: Pinch zoom per pane (touch pinch + Ctrl+wheel)

**Files:**
- Create: `src/views/pinchZoom.ts`
- Test: `src/views/pinchZoom.test.ts`
- Modify: `src/views/ChordChangesView.svelte`, `src/renderer/Renderer.svelte` (overflow class when zoomed past fit)

**Interfaces:**
- Produces: `clampZoom(z, min?, max?): number` (pure, bounds 0.4–3) and a Svelte action `pinchZoom(node, { getZoom, onZoom, onReset?, hasOverflow?, pan? })` — a two-pointer gesture calls `onZoom(clamped)` from the distance ratio AND `pan(dx, dy)` from centroid movement (map-style combined gesture); middle-mouse drag calls `pan`; wheel per the tier rules; double-click/double-tap calls `onReset`. The caller applies `pan` to its own scroller. Consumed for BOTH panes.

- [ ] **Step 1: Failing test for the pure part**

Create `src/views/pinchZoom.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { clampZoom } from './pinchZoom';

describe('clampZoom', () => {
  it('passes through in-range zooms and clamps the extremes', () => {
    expect(clampZoom(1.2)).toBe(1.2);
    expect(clampZoom(0.05)).toBe(0.4);
    expect(clampZoom(9)).toBe(3);
  });
});
```

Run: `npx vitest run src/views/pinchZoom.test.ts` — FAIL (module not found).

- [ ] **Step 2: Implement the action**

Create `src/views/pinchZoom.ts`:

```ts
/**
 * Per-pane zoom gestures over the auto-fit baseline (David's mockup-review request):
 * two-pointer pinch on touch; Ctrl+wheel (trackpad pinch / ctrl+scroll) on desktop —
 * the dev-PC path. Double-click / double-tap resets to auto-fit. The action only
 * reports numbers; the caller owns what zoom MEANS (and e.g. disengages Fit).
 */
export function clampZoom(z: number, min = 0.4, max = 3): number {
  return Math.min(max, Math.max(min, z));
}

export function pinchZoom(
  node: HTMLElement,
  opts: {
    getZoom: () => number;
    onZoom: (z: number) => void;
    onReset?: () => void;
    /** True when the pane currently has content overflowing its box (i.e. the wheel
     *  has real scrolling to do). Absent/false → a plain wheel is a dead input and
     *  may zoom. */
    hasOverflow?: () => boolean;
    /** Pan the pane's content by a pointer delta (px). Driven by the two-finger
     *  gesture's centroid (map-style: one gesture zooms AND pans) and by
     *  middle-mouse drag — the desktop 2D pan. */
    pan?: (dx: number, dy: number) => void;
  },
) {
  const pointers = new Map<number, { x: number; y: number }>();
  let startDist = 0;
  let startZoom = 1;
  let lastCentroid: { x: number; y: number } | null = null;
  let midPan: { x: number; y: number } | null = null;
  const dist = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const centroid = () => {
    const [a, b] = [...pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  const down = (e: PointerEvent) => {
    // Middle-mouse drag = pan (button 1). preventDefault kills the browser's
    // autoscroll widget, which would otherwise fight us.
    if (e.pointerType === 'mouse' && e.button === 1) {
      e.preventDefault();
      midPan = { x: e.clientX, y: e.clientY };
      node.setPointerCapture(e.pointerId);
      return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      startDist = dist();
      startZoom = opts.getZoom();
      lastCentroid = centroid();
    }
  };
  const move = (e: PointerEvent) => {
    if (midPan) {
      opts.pan?.(midPan.x - e.clientX, midPan.y - e.clientY);
      midPan = { x: e.clientX, y: e.clientY };
      return;
    }
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && startDist > 0) {
      e.preventDefault();
      opts.onZoom(clampZoom(startZoom * (dist() / startDist)));
      const c = centroid();
      if (lastCentroid) opts.pan?.(lastCentroid.x - c.x, lastCentroid.y - c.y);
      lastCentroid = c;
    }
  };
  const up = (e: PointerEvent) => {
    midPan = null;
    pointers.delete(e.pointerId);
    startDist = 0;
    lastCentroid = null;
  };
  const wheel = (e: WheelEvent) => {
    // Ctrl+wheel (also what a trackpad pinch sends) always zooms. A PLAIN wheel zooms
    // only while the pane is fitted — nothing to scroll, so the wheel is otherwise a
    // dead input (David's request). The moment content overflows, plain wheel goes
    // back to native scrolling/panning and Ctrl+wheel remains the zoom.
    if (!e.ctrlKey && opts.hasOverflow?.()) return;
    e.preventDefault();
    opts.onZoom(clampZoom(opts.getZoom() * Math.exp(-e.deltaY / 300)));
  };
  const dbl = () => opts.onReset?.();
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
  node.addEventListener('wheel', wheel, { passive: false });
  node.addEventListener('dblclick', dbl);
  return {
    destroy() {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
      node.removeEventListener('wheel', wheel);
      node.removeEventListener('dblclick', dbl);
    },
  };
}
```

Run: `npx vitest run src/views/pinchZoom.test.ts` — PASS.

- [ ] **Step 3: Wire the notation pane**

In `ChordChangesView.svelte` — manual zoom overrides the auto page fit and disengages Fit
(the classic "manual control takes over" contract, now for gestures):

```ts
  import { pinchZoom } from './pinchZoom';

  // Manual pinch zoom (ephemeral — never persisted; a zoom is situational).
  let manualZoom = $state<number | null>(null);
  function onNotationZoom(z: number) {
    manualZoom = z;
    releaseFit(); // pill visibly switches off, same as dragging Size in classic
  }
  function resetNotationZoom() {
    manualZoom = null;
    fitOn = true;
    saveFitPref();
    void fitToView();
  }
```

`toggleFit` gains one line so tapping Fit also clears a pinch: at its top add `manualZoom = null;`.

The Renderer prop becomes:

```svelte
      pageZoom={rehearsalView ? (manualZoom ?? (fitOn ? pageZoom : 1)) : 1}
```

and the action goes on the scroller via a wrapper in the markup — attach to `.render-wrap`:

```svelte
    <div class="render-wrap" use:pinchZoom={{ getZoom: () => manualZoom ?? (fitOn ? pageZoom : 1), onZoom: onNotationZoom, onReset: resetNotationZoom, hasOverflow: () => !!renderScrollEl && (renderScrollEl.scrollHeight > renderScrollEl.clientHeight || renderScrollEl.scrollWidth > renderScrollEl.clientWidth), pan: (dx, dy) => { renderScrollEl?.scrollBy(dx, dy); } }}>
```

In `Renderer.svelte`: zooming past fit overflows — let it pan, with NO visible scrollbars in rehearsal mode (screen real estate rule). Add a `bareScroll = false` prop (ChordChangesView passes `bareScroll={rehearsalView}`), apply it as a class, and style:

```svelte
<div class="render-scroll" class:bare={bareScroll} bind:this={scrollEl}>
```

```css
  .render-scroll {
    /* pan-x pan-y: panning stays native, but the browser's own pinch-zoom is
       suppressed so the pane's pinch gesture wins. */
    touch-action: pan-x pan-y;
  }
  /* Rehearsal panes: every pixel belongs to the music. Scrolling still works
     (wheel, Shift+wheel, touch swipe) — only the bars are gone. Zero-width
     scrollbars also mean overflow can never change the render width, so the
     scrollbar-feedback class of bugs cannot exist in this mode. Classic view
     keeps its visible bars + stable gutter (the walk-fit depends on them). */
  .render-scroll.bare {
    scrollbar-gutter: auto;
    scrollbar-width: none;
  }
  .render-scroll.bare::-webkit-scrollbar { display: none; }
```

Make horizontal overflow scrollable when zoomed in: `overflow-x: hidden` becomes `overflow-x: auto` — at `pageZoom ≤ 1` content never exceeds the width, so nothing changes in fit/classic modes. When `pageZoom > 1`, also switch the transform origin so the left edge stays reachable:

```svelte
      style:transform-origin={pageZoom > 1 ? 'top left' : undefined}
```

(the static CSS `top center` remains the ≤1 default) and the clamp must widen too — extend the clamp div:

```svelte
    style:width={pageZoom > 1 ? `${Math.ceil((surfaceEl?.offsetWidth ?? 0) * pageZoom)}px` : undefined}
```

- [ ] **Step 4: Wire the lyrics pane**

```ts
  let paneManualZoom = $state<number | null>(null);
```

Pane markup: action on the pane, manual zoom overriding auto-fit, overflow released while manual:

```svelte
      <aside
        class="lyrics-pane"
        class:zoomed={paneManualZoom !== null}
        bind:this={paneEl}
        style:flex-basis={`${splitFrac * 100}%`}
        use:pinchZoom={{ getZoom: () => paneManualZoom ?? paneZoom, onZoom: (z) => (paneManualZoom = z), onReset: () => (paneManualZoom = null), hasOverflow: () => !!paneEl && (paneEl.scrollHeight > paneEl.clientHeight || paneEl.scrollWidth > paneEl.clientWidth), pan: (dx, dy) => { paneEl?.scrollBy(dx, dy); } }}
        aria-label="Lyrics and notes"
      >
        <div class="pane-content" bind:this={paneContentEl} style:transform={(paneManualZoom ?? paneZoom) < 1 || paneManualZoom !== null ? `scale(${paneManualZoom ?? paneZoom})` : undefined} style:transform-origin={paneManualZoom !== null && paneManualZoom > 1 ? 'top left' : undefined}>
```

CSS additions:

```css
  .lyrics-pane {
    touch-action: pan-x pan-y;
    scrollbar-width: none; /* no bars, ever — panning is wheel/swipe */
  }
  .lyrics-pane::-webkit-scrollbar { display: none; }
  .lyrics-pane.zoomed { overflow: auto; }
```

A song switch remounts the view (`{#key current.url}` in App), so both manual zooms naturally reset per song — no extra code.

- [ ] **Step 5: Suite + browser verification**

`npm test && npm run check` green, then:

1. Desktop: **plain mouse wheel over the fitted notation zooms in** (the pane had nothing to scroll); **Fit pill visibly disengages** on first tick. Once zoomed past fit, plain wheel pans and **Ctrl+wheel** continues zooming; tap Fit → snaps back to the fitted page.
2. Same over the lyrics pane → independent zoom (notation untouched); double-click the pane → back to auto-fit.
3. **No scrollbars anywhere in rehearsal view** — zoom deep into either pane and confirm zero scrollbars appear while panning still works; measure `renderScrollEl.clientWidth` before and after overflow — identical (no width feedback). Classic view still shows its normal scrollbars.
3b. **Pan gestures:** middle-mouse drag pans a zoomed pane in 2D (no browser autoscroll widget appears); DevTools touch emulation: a two-finger gesture zooms AND pans in one motion (move both fingers together sideways while pinching). Plain wheel and Shift+wheel still pan too.
4. Ctrl+scroll does NOT trigger the browser's own page zoom over either pane (preventDefault working); over the header bars it still browser-zooms (untouched surfaces).
5. DevTools touch emulation: two-finger pinch on each pane (Chrome DevTools device mode + Shift-drag simulates pinch) — same behaviors.
6. Splitter drag still works and doesn't fight the gestures (one-pointer drag on the splitter, two-pointer pinch on panes).
7. Classic view: no gesture handlers active anywhere (`use:pinchZoom` only mounts inside rehearsal-gated markup — the render-wrap binding must be inside the `rehearsalView` condition or guard `onZoom` on `rehearsalView`; guard in `onNotationZoom`: `if (!rehearsalView) return;`).
8. Console clean.

- [ ] **Step 6: Commit**

```bash
git add src/views/pinchZoom.ts src/views/pinchZoom.test.ts src/views/ChordChangesView.svelte src/renderer/Renderer.svelte
git commit -m "feat(view): per-pane pinch zoom (touch + ctrl+wheel) with fit snap-back"
```

### Task 6: Overlay default off + full pass + PR

**Files:**
- Modify: `src/views/ChordChangesView.svelte:92` (one default)

- [ ] **Step 1: Flip the default**

```ts
  // Chord overlay: a personal, per-device preference (localStorage) — deliberately NOT
  // per-song or session/band state. Off by default (a personal-PRACTICE tool — during
  // rehearsal the band reads the chart, spec Part 4); players who turned it on keep it
  // on via the saved pref. Charts (fretboard diagrams) also off by default.
  const savedOverlay = loadOverlayPrefs();
  let overlayOn = $state<boolean>(savedOverlay.on ?? false);
```

- [ ] **Step 2: Full suite + regression sweep in the browser**

`npm test && npm run check` green, then one classic-view sweep: fresh profile (DevTools → Application → clear site data) → overlay absent by default, Rehearsal view on by default with the page fitted; toggle overlay on → persists across reload.

- [ ] **Step 3: Commit, push, PR**

```bash
git add src/views/ChordChangesView.svelte
git commit -m "feat(view): chord overlay defaults off (personal-practice tool)"
git push -u origin feat/performance-view
gh pr create --title "feat: performance view — page-mode fit, split lyrics, collapsible bars" --body "PR 3 of the Band Book + performance view plan (spec Parts 3–4, docs/superpowers/specs/2026-07-18-band-book-and-performance-view-design.md; implementation plan in this PR).

Everything gated behind **View: Classic / Rehearsal** (settings sheet, personal, default Rehearsal — Classic restores the previous experience in two taps):

- **Page-mode Fit:** engrave at the Size slider's scale, CSS-shrink the page to the viewport. Cannot fail to fit (fixes the silent landscape failure), instant, crisp; Fit and Size are now independent; 75% engraving floor kept
- **Split view:** lyrics/banter pane beside (landscape) or under (portrait) the notation, whole sheet auto-fit to the pane, both panes follow song + key; **draggable splitter** (ratio persisted per orientation)
- **Pinch zoom + pan per pane**: two-finger gesture zooms (distance) and pans (centroid) simultaneously, map-style; desktop gets wheel-zoom tiers plus **middle-mouse drag** to pan in 2D; zoom disengages the Fit pill on the notation (tap Fit to snap back), double-tap resets the lyrics pane; ephemeral by design
- **Collapsible bars:** manual chevron hides topbar + transport + sheet; semi-transparent corner button (or Esc) restores; never driven by playback
- **Chord overlay defaults off** (ungated — saved prefs unaffected)

Deliberate simplifications (flagged for after real use): pinch zoom is per-song-ephemeral (never persisted); personal practice-tempo layer deferred to its own PR.

**Verification:** pageScale unit tests; full suite + svelte-check; browser pass incl. iPhone-size whole-page fit, Fit/Size independence, rotation, key-change in both panes, collapse persistence, classic-view regression sweep, and the two flagged risk checks (click-to-seek + cursor alignment under CSS transform).

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Self-review notes

- **Spec coverage:** Part 3 (page mode, cannot-fail, floor kept, Fit/Size independent, default on) → Task 2. Part 4 split view (orientation layouts, fit-to-pane, both follow song/key, personal) → Task 4. Part 4 collapse option a (manual, corner restore) → Task 3. Part 4 overlay default → Task 5. Part 5 escape hatch toggle → Task 2 Step 2. Spec testing bullets map to the browser steps in Tasks 2/3/4.
- **Deviations, deliberate:** pane manual zoom deferred (auto-fit covers the gig need; spec's "independently scalable" partially met by notation Size — noted in PR body); collapse trigger placed in the transport strip (spec doesn't place it); Escape as secondary restore (not specced, cheap, keyboard-consistent).
- **Risk register:** alphaTab hit-testing and cursor alignment under CSS transform (explicit browser checks); stage-RO retarget to `renderScrollEl` changes the width source for classic view too — verify classic bars-per-row still responds to window resizes in the Task 4 browser pass (`renderScrollEl` width == old stage width when no pane exists, so behavior should be identical).
- **Type consistency:** `pageScale(viewW, viewH, contentW, contentH)` used identically in Tasks 2 & 4; `rehearsalView`/`setRehearsalView`, `barsCollapsed`/`setBarsCollapsed`, `lyricsPane`/`toggleLyricsPane` names consistent across tasks; Renderer props `pageZoom`/`surfaceEl` match Task 2 Steps 1 & 3.
