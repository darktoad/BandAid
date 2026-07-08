/// <reference types="svelte" />
/// <reference types="vite/client" />

/** Per-build id injected by vite.config (define). Appended as ?v=... to cache-bust
 *  the runtime-fetched library manifest and song files after each deploy. */
declare const __BUILD_ID__: string;

/** Short git commit SHA injected by vite.config (define), for the settings sheet's
 *  version readout — a glance to confirm which build is actually loaded. */
declare const __COMMIT_SHA__: string;

/** Build instant (ISO UTC) injected by vite.config (define); 'dev' in dev. Rendered
 *  as the settings sheet's human-readable release stamp. */
declare const __BUILD_TIME__: string;
