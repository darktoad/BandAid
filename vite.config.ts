import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { build as esbuild } from 'esbuild';
import { execSync } from 'node:child_process';

// The short commit SHA baked in at build time, so "am I on the latest deploy?" is a
// glance at the settings sheet instead of a private-browsing/cache-clearing exercise.
// Falls back to 'unknown' if git isn't available (e.g. a source tarball with no .git).
function commitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
}

// alphaTab ships its rendering fonts (Bravura) and a soundfont in its dist folder.
// Copy them into the served/built output so everything loads locally (no CDN) —
// see renderer-playhead spec AC-2 / NFR-1 (network-free practice loop).
const alphaTabDist = 'node_modules/@coderline/alphatab/dist';

// alphaTab's AudioWorklet entry (alphaTab.worklet.mjs) is shipped as an ES module that
// does `import * as alphaTab from "./alphaTab.core.mjs"`. That import is fatal on iOS
// Safari: AudioWorkletGlobalScope loads addModule() scripts as CLASSIC scripts, and
// Safari does not support `import` there — so `addModule()` rejects, alphaTab logs
// "Audio Worklet creation failed", and there is NO ScriptProcessor fallback at that
// point. Result: silent playback on iPad/iPhone while desktop Chrome (which tolerates
// worklet imports) works. Bundle the worklet into a single self-contained IIFE (core
// inlined, no import/export) so addModule() loads it everywhere. The web *worker* is a
// module worker (`{type:'module'}`), which iOS Safari 15+ does support, so it keeps its
// import of the shared core.mjs.
const workletEntry = `${alphaTabDist}/alphaTab.worklet.mjs`;
const WORKLET_OUT = 'assets/alphaTab.worklet.mjs';

function alphaTabWorkletBundle(): Plugin {
  let cached: Promise<string> | undefined;
  const bundle = () =>
    (cached ??= esbuild({
      entryPoints: [workletEntry],
      bundle: true,
      format: 'iife', // classic-script-safe: no top-level import/export for addModule()
      platform: 'browser',
      legalComments: 'none',
      write: false,
    }).then((r) => r.outputFiles[0].text));

  return {
    name: 'alphatab-worklet-bundle',
    // Production build: emit the bundled worklet beside the app chunk in assets/, the
    // path alphaTab resolves via `new URL('./alphaTab.worklet.mjs', import.meta.url)`.
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: WORKLET_OUT, source: await bundle() });
    },
    // Dev server: alphaTab loads the worklet straight from node_modules; serve the
    // bundled (import-free) version in its place so dev mirrors production on iOS too.
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url && req.url.includes('/@coderline/alphatab/dist/alphaTab.worklet.mjs')) {
          res.setHeader('Content-Type', 'text/javascript');
          res.end(await bundle());
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  // GitHub Pages serves this project repo under /BandAid/ — the path is
  // case-sensitive and must match the repo name exactly. The production build
  // carries that prefix (and import.meta.env.BASE_URL with it); dev stays at /.
  base: command === 'build' ? '/BandAid/' : '/',
  // A per-build id, appended as ?v=... to the runtime-fetched assets that GitHub
  // Pages caches (library.json + the song MusicXML). Content-hashed JS/CSS bust
  // themselves; these mutable files otherwise serve stale for ~10 min after a deploy.
  define: {
    __BUILD_ID__: JSON.stringify(command === 'build' ? String(Date.now()) : 'dev'),
    __COMMIT_SHA__: JSON.stringify(commitSha()),
    // The build instant (ISO UTC), shown in the settings sheet as a human-readable
    // release stamp — "when was this deployed" at a glance, not just which commit.
    __BUILD_TIME__: JSON.stringify(command === 'build' ? new Date().toISOString() : 'dev'),
  },
  plugins: [
    svelte(),
    alphaTabWorkletBundle(),
    viteStaticCopy({
      targets: [
        { src: `${alphaTabDist}/font/*`, dest: 'alphatab/font' },
        { src: `${alphaTabDist}/soundfont/sonivox.sf2`, dest: 'alphatab/soundfont' },
        // alphaTab loads its web worker at runtime via
        // `new URL('./alphaTab.worker.mjs', import.meta.url)` relative to the
        // built app chunk (in assets/). Vite doesn't bundle it, so copy it (and
        // the core it imports) next to the chunk. The worklet is emitted instead
        // by alphaTabWorkletBundle() — pre-bundled so it loads on iOS Safari.
        { src: `${alphaTabDist}/alphaTab.worker.mjs`, dest: 'assets' },
        // The worker imports './alphaTab.core.mjs'. Ship the NON-minified core: it is
        // the file patch-package patches (patches/@coderline+alphatab+*.patch — chord
        // band sharing), and the pristine .min build would silently undo the fix in
        // the production layout worker. Bigger payload, but correct engraving.
        { src: `${alphaTabDist}/alphaTab.core.mjs`, dest: 'assets' },
      ],
    }),
  ],
  // alphaTab uses a web worker + audio worklet; keep them un-inlined and served.
  optimizeDeps: {
    exclude: ['@coderline/alphatab'],
  },
  server: {
    port: 5173,
  },
}));
