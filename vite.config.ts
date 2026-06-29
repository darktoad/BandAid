import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// alphaTab ships its rendering fonts (Bravura) and a soundfont in its dist folder.
// Copy them into the served/built output so everything loads locally (no CDN) —
// see renderer-playhead spec AC-2 / NFR-1 (network-free practice loop).
const alphaTabDist = 'node_modules/@coderline/alphatab/dist';

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
  },
  plugins: [
    svelte(),
    viteStaticCopy({
      targets: [
        { src: `${alphaTabDist}/font/*`, dest: 'alphatab/font' },
        { src: `${alphaTabDist}/soundfont/sonivox.sf2`, dest: 'alphatab/soundfont' },
        // alphaTab loads its web worker + AudioWorklet at runtime via
        // `new URL('./alphaTab.worker.mjs', import.meta.url)` relative to the
        // built app chunk (in assets/). Vite doesn't bundle these, so copy them
        // (and the core they import) next to the chunk. The AudioWorklet output
        // is what makes audio work on iOS Safari.
        { src: `${alphaTabDist}/alphaTab.worker.mjs`, dest: 'assets' },
        { src: `${alphaTabDist}/alphaTab.worklet.mjs`, dest: 'assets' },
        // worker/worklet import './alphaTab.core.mjs'; serve the minified core
        // under that name to keep the worker payload smaller.
        { src: `${alphaTabDist}/alphaTab.core.min.mjs`, dest: 'assets', rename: 'alphaTab.core.mjs' },
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
