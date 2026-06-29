/// <reference types="svelte" />
/// <reference types="vite/client" />

/** Per-build id injected by vite.config (define). Appended as ?v=... to cache-bust
 *  the runtime-fetched library manifest and song files after each deploy. */
declare const __BUILD_ID__: string;
