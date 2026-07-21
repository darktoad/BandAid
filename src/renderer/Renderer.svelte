<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { createRenderer, type RendererController, type TrackInfo } from './createRenderer';

  let {
    musicXmlUrl,
    onready,
    onerror,
    onposition,
    onplaying,
    onplayable,
    scrollEl = $bindable(),
    surfaceEl = $bindable(),
    pageZoom = 1,
    bareScroll = false,
  }: {
    musicXmlUrl: string;
    onready?: (controller: RendererController, tracks: TrackInfo[]) => void;
    onerror?: (err: Error) => void;
    onposition?: (bar: number) => void;
    onplaying?: (playing: boolean) => void;
    onplayable?: () => void;
    /** The scrolling wrapper, bound out so the view can drive paged auto-scroll. */
    scrollEl?: HTMLDivElement;
    /** The alphaTab surface, bound out so the view can measure natural page size. */
    surfaceEl?: HTMLDivElement;
    /** Page-mode zoom: CSS-scales the rendered page (≤1 shrinks to fit, >1 pinch-zoomed in); 1 = no transform. */
    pageZoom?: number;
    /** Rehearsal view: hide scrollbars entirely (panning is wheel/swipe) and drop the gutter. */
    bareScroll?: boolean;
  } = $props();

  let controller: RendererController | undefined;
  // Natural page dims, transform-independent (CSS scale doesn't change layout size, so
  // the transform can't feed back into these). The clamp below sizes the scrollable
  // area to the VISUAL (post-scale) size from them.
  //  - viewW: the scroller's own content width — the width alphaTab lays out to. A
  //    STABLE reference (never the surface's own offsetWidth, which would collapse to
  //    0 the instant we freeze the surface width and then stick there).
  //  - surfaceH: the surface's natural content height at that width.
  let viewW = $state(0);
  let surfaceH = $state(0);
  let ro: ResizeObserver | undefined;
  const measure = () => {
    viewW = scrollEl?.clientWidth ?? viewW;
    surfaceH = surfaceEl?.offsetHeight ?? surfaceH;
  };
  // Belt to the RO's braces: re-measure synchronously whenever the zoom changes —
  // effects run after the DOM update, so this sees the settled layout even where
  // RO delivery is throttled (hidden/background documents).
  $effect(() => {
    void pageZoom;
    measure();
  });

  onMount(async () => {
    ro = new ResizeObserver(() => measure());
    if (surfaceEl) ro.observe(surfaceEl);
    if (scrollEl) ro.observe(scrollEl);
    try {
      controller = await createRenderer(surfaceEl!, musicXmlUrl);
      controller.onError((e) => onerror?.(e));
      controller.onPosition((bar) => onposition?.(bar));
      controller.onPlayingChanged((p) => onplaying?.(p));
      controller.onReadyForPlayback(() => onplayable?.());
      controller.onReady((tracks) => onready?.(controller!, tracks));
      if (controller.getTracks().length > 0) {
        onready?.(controller, controller.getTracks());
      }
    } catch (e) {
      onerror?.(e instanceof Error ? e : new Error(String(e)));
    }
  });

  onDestroy(() => {
    ro?.disconnect();
    controller?.destroy();
  });
</script>

<div class="render-scroll" class:bare={bareScroll} bind:this={scrollEl}>
  <!-- Page mode: the surface keeps its natural LAYOUT size (alphaTab lays out to it);
       the transform scales only the pixels, and the clamp resizes the scrollable area
       to match — trimming ghost scroll space when shrunk, extending it when zoomed in. -->
  <!-- No measurement yet (surfaceH 0) → no clamp: a ghost scroll area beats an
       invisible zero-height page. -->
  <div
    class="page-clamp"
    style:height={pageZoom !== 1 && surfaceH > 0 ? `${Math.ceil(surfaceH * pageZoom)}px` : undefined}
    style:width={pageZoom > 1 && viewW > 0 ? `${Math.ceil(viewW * pageZoom)}px` : undefined}
  >
    <div
      class="render-surface"
      bind:this={surfaceEl}
      style:transform={pageZoom !== 1 ? `scale(${pageZoom})` : undefined}
      style:transform-origin={pageZoom > 1 ? 'top left' : undefined}
      style:width={pageZoom > 1 && viewW > 0 ? `${Math.ceil(viewW)}px` : undefined}
    ></div>
  </div>
</div>

<style>
  /* The vertical scrollbar lives on this outer wrapper. Keeping it off the alphaTab host
     means the host's width is the content-box width (already minus the scrollbar), so
     alphaTab lays out to the visible width. A classic (non-overlay) scrollbar therefore
     can't spawn a phantom horizontal scrollbar, and nothing gets clipped. */
  .render-scroll {
    width: 100%;
    height: 100%;
    overflow-y: auto;
    overflow-x: auto;
    /* Reserve the scrollbar's space even when nothing overflows: a classic scrollbar
       appearing/disappearing changes the content width, which re-wraps rows and changes
       the content HEIGHT — a feedback loop that makes "does this scale fit?" depend on
       the previous render (Fit's repeated-toggle drift). A constant width breaks it. */
    scrollbar-gutter: stable;
    /* pan-x pan-y: panning stays native, but the browser's own pinch-zoom is
       suppressed so the rehearsal view's pinch gesture wins. */
    touch-action: pan-x pan-y;
    background: #faf7f2;
  }
  /* Rehearsal panes: every pixel belongs to the music. Scrolling still works
     (wheel, Shift+wheel, touch swipe, middle-mouse drag) — only the bars are gone.
     Zero-width scrollbars also mean overflow can never change the render width, so
     the scrollbar-feedback class of bugs cannot exist in this mode. Classic view
     keeps its visible bars + stable gutter (the walk-fit depends on them). */
  .render-scroll.bare {
    scrollbar-gutter: auto;
    scrollbar-width: none;
  }
  .render-scroll.bare::-webkit-scrollbar {
    display: none;
  }
  .page-clamp {
    overflow: hidden;
  }
  .render-surface {
    width: 100%;
    transform-origin: top center;
    color: #14110f;
  }
</style>
