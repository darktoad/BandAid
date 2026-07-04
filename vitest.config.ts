import { defineConfig } from 'vitest/config';

// Pure-logic tests (session store, playhead math) run in a plain node env,
// independent of the app's Vite/alphaTab/static-copy setup.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
