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

## Multi-user sync (corrections)

Bands can pin song "corrections" (a bar/beat flagging a wrong note, tie, or repeat)
that sync durably across every device in the band. It's backed by a Yjs CRDT document
per band code, layered over local IndexedDB, an optional Cloudflare PartyServer worker
(durable, cross-device), and optional WebRTC (peer-to-peer). See
[ADR-002](docs/project/architecture-decisions/002-sync-stack.md) for the stack decision
and the [implementation plan](docs/superpowers/plans/2026-06-29-corrections-sync-substrate.md)
for the full design. (The in-app UI for capturing/reviewing corrections is a separate,
not-yet-built sub-project — this substrate is the data layer underneath it.)

**Joining a band:** open the app with `?band=<any-code>` once; the app remembers the
name (`bandaid.band.v1` in localStorage) but never connects on its own — band sync is
an explicit toggle in the settings sheet. Once turned on, the choice persists across
reloads (`bandaid.syncOn.v1`), so an iOS tab reload mid-rehearsal rejoins the band
automatically; toggling it off persists too. Without sync on, the app works fully
locally (a `solo` IndexedDB room).

### Running the sync worker locally

The only server-side piece is a small Cloudflare Worker (`party/index.ts`) that relays
and durably persists each band's Yjs doc via a Durable Object. Develop against it
locally with no Cloudflare account needed:

```bash
npx wrangler dev      # boots the worker locally and prints its host
```

Copy `.env.example` to `.env` and set `VITE_SYNC_HOST` to that printed local host, then
run `npm run dev` so the app's PartyServer provider connects to it.

### Deploying the worker

**First deploy (one-time, manual — needs your Cloudflare login):**

```bash
npx wrangler login    # one-time
npx wrangler deploy
```

This step is account-bound and can't be automated by an agent — a human has to log in
once. `wrangler deploy` prints a `*.workers.dev` host.

**Every deploy after that is automatic.**
[`deploy-worker.yml`](.github/workflows/deploy-worker.yml) runs `wrangler deploy` on
every push to `main` that touches `party/**` or `wrangler.jsonc` (unrelated app-only
pushes don't trigger it), type-checking the worker first via `npm run check:worker`.
It authenticates with a **Cloudflare API token stored as a GitHub Actions secret**
(`CLOUDFLARE_API_TOKEN`) — never committed to the repo:

1. Create a token at <https://dash.cloudflare.com/profile/api-tokens> — the
   **"Edit Cloudflare Workers"** template is enough; scope it to the account you
   deployed to.
2. Add it as a repository secret named `CLOUDFLARE_API_TOKEN` in
   **Settings → Secrets and variables → Actions**.
3. If your Cloudflare login has access to more than one account, wrangler can't infer
   which one to use from the token alone — add `"account_id": "<id>"` to
   `wrangler.jsonc` (the account ID itself isn't sensitive, safe to commit).

`VITE_SYNC_HOST` is read via
`import.meta.env`, so it's **baked into the bundle at build time** — setting it as a
plain runtime env var does nothing; it must be present when `npm run build` runs.

- **Local dev:** put it in `.env` (copy `.env.example`), picked up automatically by
  `npm run dev`/`npm run build`.
- **Production (GitHub Pages):** add a repository secret named `VITE_SYNC_HOST` in
  **Settings → Secrets and variables → Actions** — [`deploy.yml`](.github/workflows/deploy.yml)
  already wires it into the build step, so no other CI change is needed once the
  secret is set.

If `VITE_SYNC_HOST` is unset or empty, the app still builds and runs fine — it just
silently falls back to local + WebRTC-only sync (no PartyServer transport, no error).
That's intentional, not a bug: don't mistake a missing secret for something broken.

### Headless corrections tooling

A Claude session editing a song's MusicXML reads and resolves corrections via two
scripts. Both need `VITE_SYNC_HOST` exported in the shell (not just in `.env` — these
are plain Node scripts run via `tsx`, not a Vite build, so `import.meta.env` isn't in
play; export the same value directly):

```bash
export VITE_SYNC_HOST=bandaid-sync.<your-account>.workers.dev

npm run corrections:pull -- <bandCode>                       # writes corrections/inbox.json
BAND_CODE=<bandCode> npm run corrections:resolve -- <id...>  # marks pins applied
```

`corrections:pull` also reads `BUILD_ID` (falls back to `'unknown'`) to stamp each
pin's staleness against the song version it was made against.

`corrections/` is a working directory — gitignored, not committed.

### Type-checking the worker

`party/` sits outside the app's Vite/Svelte build, so `npm run check` doesn't cover it.
Check it separately:

```bash
npm run check:worker
```

## Remixes (arrangements)

A **remix** is a named gig arrangement of a song — same notes, different form
(pass order, repeats, endings, later lyric verses). It's authored as a small
recipe JSON in `public/songs/remixes/<songId>.<variantId>.remix.json` and
compiled offline into an ordinary chart the app loads like any song:

```bash
npm run remix:build    # recipe + canonical MusicXML → songs/<songId>.<variantId>.musicxml
npm run remix:check    # CI drift gate: committed charts must match a fresh compile
```

Both the recipe and the compiled chart are committed; regenerate (and re-verify
by ear) whenever the canonical changes. Arrangements appear in the library
manifest (`variants` on a song), can be pinned in a set list (`variantId` on an
entry), and are switched in-app from the arrangement chip in the song header —
a session-level change that syncs to the whole band. Design:
[docs/superpowers/specs/2026-07-08-song-remix-pipeline-design.md](docs/superpowers/specs/2026-07-08-song-remix-pipeline-design.md).

## Stack

- **Svelte 5 + TypeScript + Vite 6** — the app shell (decision: capture as ADR-003).
- **alphaTab (@coderline/alphatab)** — music rendering (notation + tab), the player,
  the cursor, and the synth. The renderer decision is [ADR-001](docs/project/architecture-decisions/001-renderer.md).
- alphaTab's fonts (Bravura) and a soundfont (sonivox) are **bundled locally** via
  `vite-plugin-static-copy` so the practice loop needs no network. `useWorkers=false`
  keeps layout on the main thread and audio on a ScriptProcessor, avoiding worker
  plumbing on Vite 6.
- **Yjs + Cloudflare PartyServer + y-webrtc** — the multi-user sync stack (decision:
  [ADR-002](docs/project/architecture-decisions/002-sync-stack.md)). See
  [Multi-user sync](#multi-user-sync-corrections) above.

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
