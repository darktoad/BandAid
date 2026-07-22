# Beta Channel (PR 0) + Fit Rework (PR 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first two PRs of the [Band Book + performance view spec](../specs/2026-07-18-band-book-and-performance-view-design.md): a `/beta/` Pages channel (PR 0) and the full Fit rework — deterministic fit, Fit button out of the settings sheet, visible fit-release feedback (PR 1).

**Architecture:** PR 0 teaches the existing Pages workflow to additionally build a designated `beta` branch under `/BandAid/beta/` on the same origin (shared IndexedDB/localStorage), via a `BASE_PATH` env override of the Vite base. PR 1 extracts the fit math from `ChordChangesView.svelte` into a pure, unit-testable planner (`src/views/fitPlan.ts`) whose inputs deliberately exclude the current scale/bars-per-row (that's what makes it deterministic), and relocates the Fit toggle from the settings sheet's Size row to the always-visible transport strip.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vite 6, Vitest 2, GitHub Actions + Pages.

## Global Constraints

- **Main is frozen until after the 2026-07-19 gig.** Open PRs, never merge them. Every push to `main` auto-deploys to the live app the band uses.
- Land changes via PR into `main`; never push to `main` directly (standing project rule).
- Do not create VERSION/CHANGELOG/TODOS files (standing project rule).
- Branch names: PR 0 → `ci/beta-pages-channel`, PR 1 → `feat/fit-rework`. Both branch off current `origin/main` (`53969ea`).
- The beta channel branch is named exactly `beta`; its Pages base is exactly `/BandAid/beta/` (case-sensitive; Pages serves the repo under `/BandAid/`).
- The workflow must behave identically to today when the `beta` branch does not exist (stable-only deploy).
- Test/typecheck commands: `npm test` (vitest, 263 tests green at baseline), `npm run check` (svelte-check). CI also runs `npm run remix:check` — neither PR touches remix inputs, so it must stay green untouched.
- Fit scale bounds are 75–225 in steps of 5 (the existing Size slider grid); the 75% legibility floor is kept (spec Part 3 keeps it too).
- PR #56 already shipped the interim fixes for spec Part 2 items 1-partial and 2 (Fit no longer closes the sheet; rotation/resize re-fits with the sheet open). PR 1's scope is the rest: deterministic fit (#3), Fit's home outside the sheet (#1), visible disengage feedback (#4). Do not regress the #56 behaviors.

---

## PR 0 — Beta-channel Pages workflow

### Task 1: `BASE_PATH` override for the Vite base

**Files:**
- Modify: `vite.config.ts:70-74`

**Interfaces:**
- Produces: `npm run build` honors env var `BASE_PATH` (must end in `/`) as the Pages base; unset → `/BandAid/` exactly as today. Task 2's workflow sets `BASE_PATH=/BandAid/beta/` for the beta build.

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull && git checkout -b ci/beta-pages-channel
```

- [ ] **Step 2: Apply the config change**

In `vite.config.ts`, replace:

```ts
export default defineConfig(({ command }) => ({
  // GitHub Pages serves this project repo under /BandAid/ — the path is
  // case-sensitive and must match the repo name exactly. The production build
  // carries that prefix (and import.meta.env.BASE_URL with it); dev stays at /.
  base: command === 'build' ? '/BandAid/' : '/',
```

with:

```ts
export default defineConfig(({ command }) => ({
  // GitHub Pages serves this project repo under /BandAid/ — the path is
  // case-sensitive and must match the repo name exactly. The production build
  // carries that prefix (and import.meta.env.BASE_URL with it); dev stays at /.
  // BASE_PATH (must end in '/') overrides it for channel builds — the deploy
  // workflow builds the `beta` branch with BASE_PATH=/BandAid/beta/ so both
  // channels share one origin (and thus IndexedDB/localStorage).
  base: command === 'build' ? (process.env.BASE_PATH ?? '/BandAid/') : '/',
```

- [ ] **Step 3: Verify the default build is unchanged**

Run (Bash tool):

```bash
npm run build && grep -o '/BandAid/assets/[^"]*\.js' dist/index.html | head -3
```

Expected: paths under `/BandAid/assets/`, no `/beta/` anywhere. (Byte-identical output isn't checkable — `__BUILD_ID__`/`__BUILD_TIME__` embed the build instant — so the check is the asset prefix.)

- [ ] **Step 4: Verify the override**

```bash
BASE_PATH=/BandAid/beta/ npm run build && grep -o '/BandAid/beta/assets/[^"]*\.js' dist/index.html | head -3 && grep -c '"/BandAid/assets' dist/index.html || true
```

Expected: paths under `/BandAid/beta/assets/`; the second grep finds 0 plain `/BandAid/assets` references. Runtime fetches (library.json, songs, alphaTab fonts/soundfont) all go through `import.meta.env.BASE_URL` (`src/App.svelte:120,166,171`, `src/renderer/createRenderer.ts:95`), so the base override covers them — nothing else to patch.

- [ ] **Step 5: Rebuild clean and commit**

```bash
npm run build   # leave dist/ built from the default base, not the beta base
git add vite.config.ts
git commit -m "ci: allow BASE_PATH to override the Pages base for channel builds"
```

### Task 2: Build the `beta` branch into `dist/beta/` in the deploy workflow

**Files:**
- Modify: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: Task 1's `BASE_PATH` env override.
- Produces: pushes to `main` **or** `beta` deploy Pages with stable (built from `main`) at `/BandAid/` and, when a `beta` branch exists, the beta build at `/BandAid/beta/`. No `beta` branch → today's behavior byte-for-byte.

- [ ] **Step 1: Replace the `build` job's steps**

Replace the full contents of `.github/workflows/deploy.yml` with:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main, beta]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

# Allow one in-flight deploy at a time; newer pushes supersede older ones.
concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          # Stable always builds from main — even when a beta push triggered this run.
          ref: main
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
        env:
          # Baked into the built bundle at compile time (import.meta.env) — set once
          # in Settings → Secrets and variables → Actions after `wrangler deploy`
          # prints the worker's *.workers.dev host. Omitted/empty: the app still
          # builds and runs local+P2P only (no error), it just skips PartyServer sync.
          VITE_SYNC_HOST: ${{ secrets.VITE_SYNC_HOST }}
      # Beta channel: when a `beta` branch exists it deploys under /BandAid/beta/ on
      # the same origin — same IndexedDB/localStorage/Yjs data as stable, so schema
      # changes on beta must stay additive. No beta branch → stable-only, as before.
      - name: Check for beta branch
        id: beta
        run: |
          if git ls-remote --exit-code --heads origin beta > /dev/null 2>&1; then
            echo "exists=true" >> "$GITHUB_OUTPUT"
          else
            echo "exists=false" >> "$GITHUB_OUTPUT"
          fi
      - uses: actions/checkout@v4
        if: steps.beta.outputs.exists == 'true'
        with:
          ref: beta
          path: beta-src
      - name: Build beta channel
        if: steps.beta.outputs.exists == 'true'
        working-directory: beta-src
        env:
          BASE_PATH: /BandAid/beta/
          VITE_SYNC_HOST: ${{ secrets.VITE_SYNC_HOST }}
        run: |
          npm ci
          npm run build
          mkdir -p "$GITHUB_WORKSPACE/dist/beta"
          cp -r dist/. "$GITHUB_WORKSPACE/dist/beta/"
      - uses: actions/configure-pages@v5
        with:
          # Auto-enable Pages with the "GitHub Actions" source on first run,
          # so no manual Settings -> Pages toggle is needed.
          enablement: true
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Sanity-check the YAML**

```bash
node -e "const y=require('js-yaml')" 2>/dev/null || npx --yes yaml-lint .github/workflows/deploy.yml
```

Expected: `yaml-lint` reports the file is valid YAML. (Full workflow behavior can't run locally; it's exercised on the first post-merge push — see PR body note in Step 4.)

- [ ] **Step 3: Run the suite (guard against accidental damage)**

```bash
npm test && npm run check
```

Expected: all tests pass (263 at baseline), no svelte-check errors.

- [ ] **Step 4: Commit, push, open the PR (do NOT merge)**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: build a beta branch under /beta/ on the same Pages origin"
git push -u origin ci/beta-pages-channel
gh pr create --title "ci: beta Pages channel under /beta/" --body "PR 0 of the Band Book + performance view plan (docs/superpowers/specs/2026-07-18-band-book-and-performance-view-design.md).

- \`BASE_PATH\` env override for the Vite base (unset = /BandAid/, unchanged)
- Deploy workflow builds \`main\` as stable and, when a \`beta\` branch exists, builds it under \`/BandAid/beta/\` on the same origin (shared local data)
- No \`beta\` branch → identical stable-only behavior

**Verification:** local builds checked for correct asset prefixes with and without BASE_PATH. The workflow itself can only run on push to main/beta — verify on the first post-merge deploy that stable still serves, then create the \`beta\` branch and confirm /BandAid/beta/ appears.

**Do not merge until after the 2026-07-19 gig (main freeze).**

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Expected: PR created against `main`; CI (tests + svelte-check + remix:check) goes green.

---

## PR 1 — Fit rework (deterministic fit, Fit out of the sheet, disengage feedback)

### Task 3: Pure fit planner (`fitPlan.ts`) — TDD

**Files:**
- Create: `src/views/fitPlan.ts`
- Test: `src/views/fitPlan.test.ts`

**Interfaces:**
- Produces (consumed by Task 4):

```ts
export const MIN_FIT_SCALE = 75;
export const MAX_FIT_SCALE = 225;
export interface FitContext {
  measureCount: number;   // bars in the tune (> 0)
  viewH: number;          // scroller clientHeight, px (> 0)
  rowH100: number;        // height of one notation row at 100% scale, px (> 0)
  baseBarsPerRow: number; // responsive orphan-free pick for the stage width
}
export interface FitPlan { barsPerRow: number; scalePct: number }
export function planFit(ctx: FitContext): FitPlan;
export function planWrittenFit(viewH: number, contentH100: number): number;
```

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git checkout -b feat/fit-rework
```

- [ ] **Step 2: Write the failing tests**

Create `src/views/fitPlan.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MAX_FIT_SCALE, MIN_FIT_SCALE, planFit, planWrittenFit } from './fitPlan';

// The planner is the deterministic core of Fit (spec Part 2 #3): its inputs are the
// song, the viewport, and a scale-normalized row height — never the CURRENT
// scale/bars-per-row — so the same song + viewport always yields the same layout.

describe('planFit', () => {
  it('trades wider rows for a larger scale when that fits more', () => {
    // 32 bars, rows of 4/5/6 → 8/7/6 rows. viewH 800 at rowH100 100:
    // n=4 → 100%, n=5 → 110%, n=6 → 130%. Widest rows win.
    const plan = planFit({ measureCount: 32, viewH: 800, rowH100: 100, baseBarsPerRow: 4 });
    expect(plan).toEqual({ barsPerRow: 6, scalePct: 130 });
  });

  it('skips row widths that orphan a lone final bar', () => {
    // 33 bars: 4/row leaves 1 orphan (33 % 4 === 1) so the responsive pick is 3;
    // candidates are 3 (11 rows), 5 (7 rows), 6 (6 rows) — 4 is skipped.
    const plan = planFit({ measureCount: 33, viewH: 600, rowH100: 100, baseBarsPerRow: 3 });
    expect(plan).toEqual({ barsPerRow: 6, scalePct: 100 });
  });

  it('quantizes to the 5% grid, rounding down (never overflow the view)', () => {
    // 8 bars at 4/row = 2 rows; viewH 430 → raw 215% → 215 exactly on grid;
    // viewH 428 → raw 214% → floor to 210.
    expect(planFit({ measureCount: 8, viewH: 430, rowH100: 100, baseBarsPerRow: 4 }).scalePct).toBe(215);
    expect(planFit({ measureCount: 8, viewH: 428, rowH100: 100, baseBarsPerRow: 4 }).scalePct).toBe(210);
  });

  it('clamps to the 225% ceiling and prefers fewer bars per row on ties', () => {
    // Huge viewport: every candidate hits 225 — keep the widest bars (base n).
    const plan = planFit({ measureCount: 8, viewH: 3000, rowH100: 100, baseBarsPerRow: 4 });
    expect(plan).toEqual({ barsPerRow: 4, scalePct: MAX_FIT_SCALE });
  });

  it('falls back to the base layout at the 75% floor when nothing fits', () => {
    // Tiny viewport: no candidate fits even at 75 — stay at the responsive base;
    // the paged auto-turn covers multi-page tunes below the legibility floor.
    const plan = planFit({ measureCount: 32, viewH: 100, rowH100: 100, baseBarsPerRow: 4 });
    expect(plan).toEqual({ barsPerRow: 4, scalePct: MIN_FIT_SCALE });
  });

  it('is independent of any current scale or layout (same inputs, same plan)', () => {
    const ctx = { measureCount: 16, viewH: 700, rowH100: 90, baseBarsPerRow: 4 };
    expect(planFit({ ...ctx })).toEqual(planFit({ ...ctx }));
  });
});

describe('planWrittenFit', () => {
  it('sizes the engraved layout to the view on the 5% grid', () => {
    expect(planWrittenFit(800, 1000)).toBe(80); // raw 80%
    expect(planWrittenFit(850, 1000)).toBe(85); // raw 85%
    expect(planWrittenFit(849, 1000)).toBe(80); // rounds down
  });

  it('clamps to the floor and ceiling', () => {
    expect(planWrittenFit(50, 1000)).toBe(MIN_FIT_SCALE);
    expect(planWrittenFit(9999, 100)).toBe(MAX_FIT_SCALE);
  });
});
```

- [ ] **Step 3: Run the tests, watch them fail**

```bash
npx vitest run src/views/fitPlan.test.ts
```

Expected: FAIL — `Cannot find module './fitPlan'` (or equivalent resolve error).

- [ ] **Step 4: Implement the planner**

Create `src/views/fitPlan.ts`:

```ts
/**
 * Pure fit planning: pick the bars-per-row + scale that shows the whole tune in the
 * viewport. Deliberately deterministic (spec Part 2 #3): the inputs are the song, the
 * viewport, and a scale-NORMALIZED row height — the current scale/bars-per-row are not
 * inputs, so Fit converges to the same layout for a given song + viewport no matter
 * what the player dragged or fitted beforehand. The component measures the live render,
 * normalizes to 100% scale, plans here, then verifies/trims against the real render
 * (row heights shift slightly with density — the plan is an estimate, not a promise).
 */

// Legibility floor / zoom ceiling — the Size slider's own range. Below 75% the tune
// stays multi-page and the paged auto-turn covers it.
export const MIN_FIT_SCALE = 75;
export const MAX_FIT_SCALE = 225;

export interface FitContext {
  measureCount: number;   // bars in the tune (> 0)
  viewH: number;          // scroller clientHeight, px (> 0)
  rowH100: number;        // height of one notation row at 100% scale, px (> 0)
  baseBarsPerRow: number; // responsive orphan-free pick for the stage width
}

export interface FitPlan {
  barsPerRow: number;
  scalePct: number;
}

// Down to the 5% grid (never overflow), inside the slider's bounds.
function quantize(rawPct: number): number {
  return Math.max(MIN_FIT_SCALE, Math.min(MAX_FIT_SCALE, Math.floor(rawPct / 5) * 5));
}

/**
 * Free-layout fit: try each row width from the responsive baseline up to 6 (the widest
 * the band's paper charts use) — wider rows mean fewer rows, letting a short tune trade
 * bar width for a single-page fit. Widths that orphan a lone final bar are skipped
 * (count % n === 1), matching pickBarsPerRow. Largest fitting scale wins; ties keep
 * the fewest bars per row (widest bars). Nothing fits even at the floor → the base
 * layout at MIN_FIT_SCALE.
 */
export function planFit(ctx: FitContext): FitPlan {
  const { measureCount, viewH, rowH100, baseBarsPerRow } = ctx;
  let best: FitPlan = { barsPerRow: baseBarsPerRow, scalePct: MIN_FIT_SCALE };
  for (let n = baseBarsPerRow; n <= 6; n++) {
    if (measureCount > n && measureCount % n === 1) continue; // no orphan rows
    const rows = Math.ceil(measureCount / n);
    const scalePct = quantize((viewH / (rows * rowH100)) * 100);
    if (scalePct > best.scalePct) best = { barsPerRow: n, scalePct };
  }
  return best;
}

/**
 * "As written" fit: the file's engraved breaks own the row structure, so scale is the
 * single lever. contentH100 is the full notation height at 100% scale.
 */
export function planWrittenFit(viewH: number, contentH100: number): number {
  return quantize((viewH / contentH100) * 100);
}
```

- [ ] **Step 5: Run the tests, watch them pass**

```bash
npx vitest run src/views/fitPlan.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add src/views/fitPlan.ts src/views/fitPlan.test.ts
git commit -m "feat(fit): pure deterministic fit planner"
```

### Task 4: Wire the planner in, move Fit to the transport strip

**Files:**
- Modify: `src/views/ChordChangesView.svelte` (fit function ~lines 609-668; transport strip ~lines 740-764; sheet Size row ~lines 837-849; styles ~lines 1120-1131)

**Interfaces:**
- Consumes: `planFit`, `planWrittenFit`, `MIN_FIT_SCALE` from `src/views/fitPlan.ts` (Task 3).
- Produces: user-visible behavior only. The `fitOn` state, `toggleFit()`, `releaseFit()`, localStorage key `bandaid.autoFit`, and the ResizeObserver re-fit (all pre-existing) are unchanged.

- [ ] **Step 1: Import the planner**

In the `<script>` block of `src/views/ChordChangesView.svelte`, after the existing imports (below line 19's `import type { SyncTone } ...`), add:

```ts
import { MIN_FIT_SCALE, planFit, planWrittenFit } from './fitPlan';
```

- [ ] **Step 2: Replace `fitToView` with the planner-backed version**

Replace the entire `fitToView` function (the block starting `async function fitToView() {` through its closing brace, currently lines 620-668) and the comment block above it (lines 609-619) with:

```ts
  // Fit the whole tune in the viewport. The layout choice (bars-per-row up to 6 +
  // scale) is computed by the pure planner in fitPlan.ts from scale-NORMALIZED
  // measurements, so Fit is deterministic: same song + viewport → same layout, no
  // matter what the player dragged or fitted beforehand (spec Part 2 #3). In
  // "as written" mode bars-per-row belongs to the file, so Fit drops to scale only.
  // The plan is verified against the real render and trimmed if the row-height
  // estimate ran long. Fits to the stage as it currently is: with the inline
  // (wide-screen) sheet open that means the reduced viewport, and the
  // ResizeObserver re-fits when the sheet closes.
  async function fitToView() {
    const scroller = renderScrollEl;
    if (!scroller || !controller || measureCount <= 0) return;
    // Measure the notation surface itself: the scroller's scrollHeight is floored at its
    // own clientHeight, so a tune SHORTER than the view would read "exactly fits" and
    // Fit could only ever shrink, never grow into the free space.
    const contentH = scroller.firstElementChild?.getBoundingClientRect().height ?? 0;
    const viewH = scroller.clientHeight;
    if (contentH <= 0 || viewH <= 0) return;
    if (rowsAsWritten) {
      // Engraved breaks own the rows; scale is the single lever. Height tracks scale
      // near-linearly (fixed row count), so plan once, then verify and trim.
      let s = planWrittenFit(viewH, contentH * (100 / scalePct));
      while (s !== scalePct) {
        scalePct = s;
        const rendered = nextRender();
        controller.setScale(s / 100);
        await rendered;
        if (scroller.scrollHeight <= scroller.clientHeight || s <= MIN_FIT_SCALE) break;
        s = Math.max(MIN_FIT_SCALE, s - 5);
      }
      return;
    }
    // Normalize the measured row height to 100% scale — the planner must not see the
    // current scale, or the result would depend on how the player got here.
    const rowH100 = (contentH / Math.ceil(measureCount / barsPerRow)) * (100 / scalePct);
    const base = pickBarsPerRow(lastStageWidth || stageEl?.clientWidth || 0, measureCount);
    let { barsPerRow: bestN, scalePct: bestS } = planFit({
      measureCount,
      viewH,
      rowH100,
      baseBarsPerRow: base,
    });
    while (bestN !== barsPerRow || bestS !== scalePct) {
      barsPerRow = bestN; // the overlay mirrors the notation 1:1
      lastBarsPerRow = bestN;
      scalePct = bestS;
      const rendered = nextRender();
      controller.setLayout(bestN, bestS / 100);
      await rendered;
      // Estimate ran long (row heights shift with density): trim a step and re-verify.
      if (scroller.scrollHeight <= scroller.clientHeight || bestS <= MIN_FIT_SCALE) break;
      bestS = Math.max(MIN_FIT_SCALE, bestS - 5);
    }
  }
```

- [ ] **Step 3: Move the Fit button into the transport strip**

In the transport strip markup, replace:

```svelte
  <span class="spacer"></span>

  <button class="pill" class:on={transposeModified} onclick={openSettings} disabled={!controller} title="Key">
```

with:

```svelte
  <span class="spacer"></span>

  <!-- Fit is a LOCAL viewing pref (the exception in this band-synced strip): it needs
       a permanent home outside the settings sheet so its state stays visible — when
       dragging Size disengages it, the player sees it switch off (spec Part 2 #1, #4). -->
  <button
    class="pill fit"
    class:on={fitOn}
    aria-pressed={fitOn}
    onclick={toggleFit}
    disabled={!controller}
    title="Keep the whole tune sized to the view — adjusting Size takes back manual control"
  >Fit</button>

  <button class="pill" class:on={transposeModified} onclick={openSettings} disabled={!controller} title="Key">
```

- [ ] **Step 4: Remove the Fit button from the sheet's Size row**

In the settings sheet, replace:

```svelte
    <div class="row">
      <span class="label">Size</span>
      <input type="range" min="75" max="225" step="25" value={scalePct} oninput={onScale} disabled={!controller} aria-label="Notation size" aria-valuetext={`${scalePct}%`} />
      <span class="readout">{scalePct}%</span>
      <button
        class="fitbtn"
        class:active={fitOn}
        aria-pressed={fitOn}
        onclick={toggleFit}
        disabled={!controller}
        title="Keep the whole tune sized to the view — adjusting Size takes back manual control"
      >Fit</button>
    </div>
```

with:

```svelte
    <!-- Size is manual control: dragging it disengages Fit (the Fit pill in the
         transport strip visibly switches off). -->
    <div class="row">
      <span class="label">Size</span>
      <input type="range" min="75" max="225" step="25" value={scalePct} oninput={onScale} disabled={!controller} aria-label="Notation size" aria-valuetext={`${scalePct}%`} />
      <span class="readout">{scalePct}%</span>
    </div>
```

- [ ] **Step 5: Update the styles**

Replace:

```css
  .fitbtn { flex: 0 0 auto; padding: 0.4rem 0.7rem; font-size: 0.85rem; min-height: 2.2rem; }
  .fitbtn.active { border-color: var(--accent); color: var(--accent); }
```

with:

```css
  /* The Fit pill signals its state with color too — its whole job in the transport
     strip is that disengaging (Size drag) is VISIBLE (spec Part 2 #4). */
  .pill.fit.on { color: var(--accent); }
```

And in the coarse-pointer block, replace:

```css
    .stepper button,
    .chips button,
    .fitbtn,
    .reset { min-width: 2.75rem; min-height: 2.75rem; }
```

with:

```css
    .stepper button,
    .chips button,
    .reset { min-width: 2.75rem; min-height: 2.75rem; }
```

- [ ] **Step 6: Full suite + typecheck**

```bash
npm test && npm run check
```

Expected: all tests pass (263 baseline + 8 new), svelte-check clean (no unused-selector warnings — `.fitbtn` rules were removed with the button).

- [ ] **Step 7: Verify live in the browser**

Start the dev server via the preview tool (launch config `dev`, port 5173; note: preview serves the MAIN checkout — run it from this branch's working tree) and check, at desktop width (1280x800):

1. Open a song → Fit pill visible in the transport strip, active (accent) by default.
2. Drag Size in the settings sheet → Fit pill visibly switches off while the sheet is still open.
3. Tap Fit → pill re-activates, layout fits the view; the sheet stays open.
4. **Determinism:** note the resulting Size % after Fit. Drag Size to 225%, tap Fit; drag Size to 75%, tap Fit → both times the readout lands on the same %.
5. Resize to mobile (375x812) and repeat 4 → same-again (a different, mobile-specific value).
6. Rotate/resize with the sheet open → still re-fits (PR #56 behavior intact).
7. Console: no errors.

Screenshot the fitted view for the PR.

- [ ] **Step 8: Commit, push, open the PR (do NOT merge)**

```bash
git add src/views/ChordChangesView.svelte
git commit -m "feat(fit): deterministic fit via the planner; Fit pill moves to the transport strip"
git push -u origin feat/fit-rework
gh pr create --title "feat: Fit rework — deterministic fit, Fit out of the sheet" --body "PR 1 of the Band Book + performance view plan (docs/superpowers/specs/2026-07-18-band-book-and-performance-view-design.md), completing spec Part 2:

- Fit math extracted to a pure planner (\`src/views/fitPlan.ts\`) whose inputs exclude the current scale/layout — same song + viewport now always converges to the same fit (#3)
- Fit button moved from the settings sheet's Size row to the always-visible transport strip (#1), so dragging Size visibly disengages it (#4)
- PR #56's interim fixes (sheet stays open, rotation re-fit) preserved

**Verification:** 8 new planner unit tests; full suite + svelte-check green; live browser check of determinism (Size 225→Fit and Size 75→Fit land on the same %), disengage feedback, and rotation re-fit.

**Do not merge until after the 2026-07-19 gig (main freeze).**

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Expected: PR created against `main`; CI green.

---

## Self-review notes

- **Spec coverage (PR 0 + PR 1 scope):** Part 5 beta channel → Tasks 1-2. Part 2 #3 deterministic fit → Tasks 3-4. Part 2 #1 Fit's home outside the sheet → Task 4 Steps 3-4. Part 2 #4 visible disengage → Task 4 Steps 3+5 (always-visible pill + color change). Part 2 #2 and the sheet-close half of #1 shipped in PR #56 (guarded by Task 4 Step 7 checks 3+6). Parts 1, 3, 4 are PRs 2-3 — out of this plan by design.
- **Known limits:** planner determinism is exact; end-to-end fit determinism is "practical" — `rowH100` is measured from the live render and engraving isn't perfectly scale-linear, so the verify/trim loop can settle one 5% step apart in rare cases. The browser determinism check (Task 4 Step 7.4) is the acceptance test the spec asks for.
- **Beta-channel runtime verification** (Pages serving `/beta/`, shared local data, stable byte-identical) can only happen post-merge, after the gig: merge PR 0, watch the stable deploy, then `git branch beta && git push origin beta` and check `/BandAid/beta/`.
