# BandAid

A band sync and jam companion for small acoustic ensembles (old-time / bluegrass,
3 to 5 players). It keeps everyone locked to the same musical position: leaderless,
with per-player local views, and any player able to push global changes (key, tempo,
section). Solo practice ships first so a player can drill chord timings alone; band
sync follows.

**Guiding principle: sync the musical position, not the screen.** Shared state is tiny
and logical (which song, transport, key, section). Everything visual (scroll, zoom,
instrument, which view) is local per device. There are no modes, only a session
(1..N players) plus locally-chosen presentation templates over one shared playhead.

> Status: **M1 (MVP) in progress.** All five M1 feature specs are written; the
> `renderer-playhead` foundation is built and runs. See [Current State](#current-state).
>
> **▶ Live app: <https://darktoad.github.io/BandAid/>** — auto-deployed from `main` on
> every push via GitHub Pages. Open it on any device (iPhone / Android / iPad / laptop);
> no install needed.

## Quick start

Prereqs: Node 20+ (built on Node 24), npm.

```bash
npm install      # installs Svelte, Vite, alphaTab, Vitest
npm run dev      # http://localhost:5173 — loads a sample tune in guitar tab
npm test         # unit suite (session store, playhead, chords, lyrics, library)
npm run build    # production build (also catches bundling issues)
npm run check    # svelte-check / TypeScript typecheck
```

Open http://localhost:5173 and you should see "Big John McNeil" rendered as guitar
tab with a control bar (Play, tempo, part selector). Click a part button to switch
the staff; click Play to start the cursor and audio.

To try the deployed build instead of running locally, just open the
[live app](https://darktoad.github.io/BandAid/).

## Development workflow

Changes land through a pull request into `main` — not direct pushes. Since every push
to `main` auto-deploys to the [live app](https://darktoad.github.io/BandAid/), the PR
branch *is* the staging step: **verify locally before you merge.**

```bash
git switch -c <topic>     # branch off main
npm test                  # unit suite
npm run check             # typecheck
npm run dev               # http://localhost:5173 — check it in a real browser
gh pr create              # open the PR; merge when it looks and sounds right
```

For song changes, open the dev server and **play the tune through** — pitch and rhythm
can only be confirmed by ear, and the audio needs a real browser (a headless one won't
start the AudioContext). To rehearse the exact production bundle instead of the dev
server, run `npm run build && npm run preview`. Merging the PR deploys to the live site
automatically; there is no separate staging host.

## Deployment

The app is a static SPA hosted on **GitHub Pages**. The
[`deploy` workflow](.github/workflows/deploy.yml) builds (`npm ci && npm run build`)
and publishes `dist/` on every push to `main`, so the
[live URL](https://darktoad.github.io/BandAid/) always tracks `main`. Pages is a
*project* site, so it is served under the case-sensitive `/BandAid/` path — Vite's
`base` is set to match in `vite.config.ts`. No manual setup is required; the workflow
enables Pages on first run.

## Stack

- **Svelte 5 + TypeScript + Vite 6** — the app shell (decision: capture as ADR-003).
- **alphaTab (@coderline/alphatab)** — music rendering (notation + tab), the player,
  the cursor, and the synth. The renderer decision is [ADR-001](docs/project/architecture-decisions/001-renderer.md).
- alphaTab's fonts (Bravura) and a soundfont (sonivox) are **bundled locally** via
  `vite-plugin-static-copy` so the practice loop needs no network. `useWorkers=false`
  keeps layout on the main thread and audio on a ScriptProcessor, avoiding worker
  plumbing on Vite 6.

## Project structure

```
src/
  main.ts                  app entry (mounts App.svelte)
  App.svelte               shell: loads a hardcoded sample, wires controls + store
  session/
    types.ts               Transport, SessionState, SessionStore interface
    store.ts               createLocalSessionStore — M1 in-memory impl (swaps for
                           a Yjs/CRDT impl at M2 behind the same interface)
    store.test.ts          store + fake-remote-writer test (M2-additive proof)
  playhead/
    projectBar.ts          pure playhead reconciliation: bar = f(transport, now, meter)
    projectBar.test.ts     meter-aware unit tests
  renderer/
    createRenderer.ts      THE single alphaTab integration point (nothing else
                           imports @coderline/alphatab): load, render, solo,
                           position, seek, play
    Renderer.svelte        provides the DOM host + controller lifecycle
public/
  songs/                   sample canonical MusicXML served as static assets
docs/
  project/                 vision, roadmap, CONTEXT.md, feature specs, ADRs
  reference/               build brief, sample tunes, the Python tune-arranger toolkit
```

## How the pieces fit

```
library-browsing ──sets currentSongId──► renderer-playhead ──renders over──► chord-changes-view
   (M1, spec'd)                          (Svelte + alphaTab,                  (alphaTab cursor)
                                          session store)                            ▲
unified-music-model ──canonical Song──────────┘                                     │
                                                                    local-transport ┘
                                                          (play/pause/tempo/seek → Transport)
```

- The **session store** holds only `{ currentSongId, transport }`. That is the entire
  synced surface. In M1 it is a local Svelte store; in M2 it becomes a multi-writer
  CRDT behind the same `SessionStore` interface, so no consumer changes. This is the
  roadmap's hard rule: no M1 code is thrown away to add join.
- **`projectBar(transport, now, quarterNotesPerBar)`** is the pure reconciliation
  function. In M1 alphaTab's player is the live clock; `projectBar` is used to place
  the cursor when a song loads against an existing transport, and in M2 to seek the
  local player to a peer's projected position.
- **`createRenderer.ts`** is the only file touching the alphaTab API, so the engine
  stays contained.

## Current state

**Built and verified (headless browser + screenshot, 2026-06-26):**
- Renders a real sample tune in notation/tab with bar numbers, title, tuning (AC-1).
- Part switching re-renders per track: Fiddle / Guitar tab / Uke tab / Bass tab (AC-7).
- All assets load locally, no CDN (page, tune, font, soundfont all 200) (AC-2).
- Session store + `projectBar`: 17 unit tests pass, including a fake-remote-writer
  that drives the store the way M2's CRDT will (AC-4 / AC-5 / AC-6).
- Clean `vite build` and `svelte-check`; zero console errors.

**Open / needs a real browser:**
- Playback cursor advancement and audio (AC-3). Headless Chromium will not resume the
  AudioContext without a real user gesture, and alphaTab pins the cursor to the running
  synth, so it could not be confirmed headless. Verify by clicking Play in a real browser.
- Mobile/tablet device check (AC-8) — web layout works; on-device not yet tested.
- `seekToBar` is wired but not yet bound to tap-a-bar; cursor-init-from-`projectBar`
  on load is not yet wired (both are the rest of Task 4).

Progress and per-task notes live in
[docs/project/features/renderer-playhead-tasks.md](docs/project/features/renderer-playhead-tasks.md).

## Roadmap

| Milestone | Goal |
|-----------|------|
| **M1 Session of One (MVP)** | Solo player drills chord timings against a moving playhead. Built session-shaped. |
| M2 Join | Turn a session of one into a session of N: leaderless, loose follow-along, shared set list. |
| M3 Presentation Templates | Per-instrument notation/tab, chord diagrams, scale maps, song card. |
| M4 Tighten When Needed | NTP-style clock sync (only if measured drift needs it), live detection. |

Full detail: [docs/project/roadmap.md](docs/project/roadmap.md).

## Documentation map

| Doc | What it is |
|-----|-----------|
| [docs/project/CONTEXT.md](docs/project/CONTEXT.md) | Recontextualization entry point: phase, decisions, status |
| [docs/project/vision.md](docs/project/vision.md) | Full product vision |
| [docs/project/roadmap.md](docs/project/roadmap.md) | Milestones, MVP, dependencies, open decisions |
| [docs/project/features/](docs/project/features/) | Feature specs (5 for M1) + the renderer-playhead tasks file |
| [docs/project/architecture-decisions/](docs/project/architecture-decisions/) | ADRs (001 renderer; 002 sync-stack and 003 stack pending) |
| [docs/reference/band-sync-app-brief.md](docs/reference/band-sync-app-brief.md) | Technical build brief (sync model, renderer paths, gotchas) |
| [docs/reference/samples/](docs/reference/samples/) | Sample tunes + the Python tune-arranger toolkit |

## Continuing work

1. Confirm playback in a real browser (the one open item above).
2. Finish `renderer-playhead` Task 4: tap-a-bar seek, cursor-init from `projectBar`.
3. `/impl-feature chord-changes-view` then `local-transport`, then `library-browsing`.
4. ✅ **ADR-002 captured** ([sync stack](docs/project/architecture-decisions/002-sync-stack.md):
   Yjs + Cloudflare PartyServer + y-webrtc, 2026-07-03). Still pending via `/decide`:
   **003** (Svelte/TS/Vite stack, already chosen — low urgency).

Resume a session with `/context-restore` (the latest checkpoint summarizes everything).

## Explicitly out of scope

No recording, no audio streaming between players, no accounts, no remote/different-house
jamming, no in-app song authoring. Same-room and offline-capable is the target. All music
processing (transcription, reduction, chord voicing, section labeling) lives in a separate
offline tool; this app only consumes canonical MusicXML.
