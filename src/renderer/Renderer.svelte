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
  }: {
    musicXmlUrl: string;
    onready?: (controller: RendererController, tracks: TrackInfo[]) => void;
    onerror?: (err: Error) => void;
    onposition?: (bar: number) => void;
    onplaying?: (playing: boolean) => void;
    onplayable?: () => void;
    /** The scrolling wrapper, bound out so the view can drive paged auto-scroll. */
    scrollEl?: HTMLDivElement;
  } = $props();

  let host: HTMLDivElement;
  let controller: RendererController | undefined;

  onMount(async () => {
    try {
      controller = await createRenderer(host, musicXmlUrl);
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

  onDestroy(() => controller?.destroy());
</script>

<div class="render-scroll" bind:this={scrollEl}>
  <div class="render-surface" bind:this={host}></div>
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
    overflow-x: hidden;
    background: #faf7f2;
  }
  .render-surface {
    width: 100%;
    color: #14110f;
  }
</style>
