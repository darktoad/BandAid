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
    pageWidth = 0,
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
    /** Virtual page width in px: engrave to THIS width rather than the viewport's, so a
     *  row holds a chart's worth of bars (4–6) on any screen; the transform then scales
     *  the page down to fit. 0/undefined = lay out to the container (classic). */
    pageWidth?: number;
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
  // The page's own layout width: the virtual page when set, else the container.
  let naturalW = $derived(pageWidth > 0 ? pageWidth : viewW);
  // True whenever the page is being laid out to its own width and/or scaled — the
  // regime where the clamp owns sizing/centring and the origin must be top-left.
  let pageScaled = $derived(pageWidth > 0 || pageZoom !== 1);
  // Belt to the RO's braces: re-measure synchronously whenever the zoom or page width
  // changes — effects run after the DOM update, so this sees the settled layout even
  // where RO delivery is throttled (hidden/background documents).
  $effect(() => {
    void pageZoom;
    void pageWidth;
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
  <!-- Page transforms scale from the TOP LEFT and the clamp carries the visual size,
       centring itself with margin:auto. (Scaling from `top center` would pivot on the
       page's own midpoint — a 1600px virtual page shrunk toward x=800 lands entirely
       outside a 375px viewport and gets clipped to blank.) -->
  <div
    class="page-clamp"
    style:height={pageZoom !== 1 && surfaceH > 0 ? `${Math.ceil(surfaceH * pageZoom)}px` : undefined}
    style:width={pageScaled && naturalW > 0 ? `${Math.ceil(naturalW * pageZoom)}px` : undefined}
  >
    <div
      class="render-surface"
      bind:this={surfaceEl}
      style:transform={pageZoom !== 1 ? `scale(${pageZoom})` : undefined}
      style:transform-origin={pageScaled ? 'top left' : undefined}
      style:width={pageScaled && naturalW > 0 ? `${Math.ceil(naturalW)}px` : undefined}
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
    margin: 0 auto; /* centres a page narrower than the viewport */
  }
  .render-surface {
    width: 100%;
    transform-origin: top center;
    color: #14110f;
  }
</style>
