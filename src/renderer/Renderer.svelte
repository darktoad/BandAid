<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { createRenderer, type RendererController, type TrackInfo } from './createRenderer';

  let {
    musicXmlUrl,
    onready,
    onerror,
    onposition,
    onplaying,
  }: {
    musicXmlUrl: string;
    onready?: (controller: RendererController, tracks: TrackInfo[]) => void;
    onerror?: (err: Error) => void;
    onposition?: (bar: number) => void;
    onplaying?: (playing: boolean) => void;
  } = $props();

  let host: HTMLDivElement;
  let controller: RendererController | undefined;

  onMount(async () => {
    try {
      controller = await createRenderer(host, musicXmlUrl);
      controller.onError((e) => onerror?.(e));
      controller.onPosition((bar) => onposition?.(bar));
      controller.onPlayingChanged((p) => onplaying?.(p));
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

<div class="render-surface" bind:this={host}></div>

<style>
  .render-surface {
    width: 100%;
    height: 100%;
    overflow: auto;
    background: #faf7f2;
    color: #14110f;
  }
</style>
