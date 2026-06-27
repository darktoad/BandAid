import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// alphaTab ships its rendering fonts (Bravura) and a soundfont in its dist folder.
// Copy them into the served/built output so everything loads locally (no CDN) —
// see renderer-playhead spec AC-2 / NFR-1 (network-free practice loop).
const alphaTabDist = 'node_modules/@coderline/alphatab/dist';

export default defineConfig({
  plugins: [
    svelte(),
    viteStaticCopy({
      targets: [
        { src: `${alphaTabDist}/font/*`, dest: 'alphatab/font' },
        { src: `${alphaTabDist}/soundfont/sonivox.sf2`, dest: 'alphatab/soundfont' },
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
});
