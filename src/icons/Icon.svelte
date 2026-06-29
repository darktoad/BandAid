<script lang="ts">
  /**
   * Inline-SVG icon, matching the header's icon convention (24×24 viewBox, currentColor).
   * Stroked outlines by default; a few glyphs (play, pause, sound) use solid fills. Keeps
   * the UI emoji-free and the typeface-independent — every icon inherits color + size.
   */
  let { name, size = 18 }: { name: string; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  class:spin={name === 'loading'}
  aria-hidden="true"
>
  {#if name === 'play'}
    <path d="M8 5v14l11-7z" fill="currentColor" stroke="none" />
  {:else if name === 'pause'}
    <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
    <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
  {:else if name === 'loading'}
    <path d="M12 3a9 9 0 1 0 9 9" />
  {:else if name === 'sound'}
    <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
    <path d="M16.5 8.5a5 5 0 0 1 0 7" />
  {:else if name === 'click'}
    <path d="M9 4h6l3 16H6z" />
    <line x1="12" y1="8" x2="15.5" y2="14" />
  {:else if name === 'countin'}
    <path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2.5H4.5z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  {:else if name === 'chords'}
    <rect x="5" y="4" width="14" height="15" rx="1" />
    <line x1="5" y1="9" x2="19" y2="9" />
    <line x1="5" y1="14" x2="19" y2="14" />
    <line x1="9.7" y1="4" x2="9.7" y2="19" />
    <line x1="14.3" y1="4" x2="14.3" y2="19" />
    <circle cx="9.7" cy="11.5" r="1.5" fill="currentColor" stroke="none" />
  {:else if name === 'reset'}
    <path d="M5 12a7 7 0 1 0 2-5" />
    <path d="M4 4v4h4" />
  {/if}
</svg>

<style>
  .spin {
    animation: icon-spin 0.9s linear infinite;
  }
  @keyframes icon-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
