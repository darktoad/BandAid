<script lang="ts">
  import type { ChordShape } from './chordShapes';

  /**
   * A compact, fixed-size fret diagram. Monochrome: it draws in `currentColor`, so the
   * parent tints it (accent for the current bar, muted for upcoming bars). Shows a 4-fret
   * window with the nut when the shape sits low on the neck, or a base-fret label otherwise.
   */
  let { shape, width = 42 }: { shape: ChordShape; width?: number } = $props();

  const FRETS = 4;
  const sp = 8; // string spacing
  const fp = 10; // fret spacing
  const padX = 7;
  const padTop = 9; // room for the x/o markers above the nut
  const padBottom = 3;
  const fretLines = Array.from({ length: FRETS + 1 }, (_, j) => j);

  let n = $derived(shape.frets.length);
  let pressed = $derived(shape.frets.filter((f) => f > 0));
  let startFret = $derived(pressed.length && Math.max(...pressed) > FRETS ? Math.min(...pressed) : 1);
  let gridRight = $derived(padX + (n - 1) * sp);
  let gridBottom = padTop + FRETS * fp;
  let vbW = $derived(gridRight + padX);
  let vbH = padTop + FRETS * fp + padBottom;
  let height = $derived((width * vbH) / vbW);

  function dotY(f: number): number {
    return padTop + (f - startFret + 0.5) * fp;
  }
</script>

<svg viewBox={`0 0 ${vbW} ${vbH}`} {width} {height} role="img" aria-label="chord diagram">
  {#each shape.frets as _, i}
    <line
      x1={padX + i * sp}
      y1={padTop}
      x2={padX + i * sp}
      y2={gridBottom}
      stroke="currentColor"
      stroke-opacity="0.4"
      stroke-width="0.6"
    />
  {/each}
  {#each fretLines as j}
    <line
      x1={padX}
      y1={padTop + j * fp}
      x2={gridRight}
      y2={padTop + j * fp}
      stroke="currentColor"
      stroke-opacity="0.4"
      stroke-width="0.6"
    />
  {/each}
  {#if startFret === 1}
    <rect x={padX - 0.5} y={padTop - 1.5} width={gridRight - padX + 1} height="2" fill="currentColor" />
  {:else}
    <text x={padX - 3} y={padTop + fp - 2} font-size="6" fill="currentColor" text-anchor="end">{startFret}</text>
  {/if}
  {#each shape.frets as f, i}
    {#if f === -1}
      <text x={padX + i * sp} y={padTop - 2.5} font-size="6" fill="currentColor" text-anchor="middle">×</text>
    {:else if f === 0}
      <text x={padX + i * sp} y={padTop - 2.5} font-size="5.5" fill="currentColor" text-anchor="middle">○</text>
    {:else}
      <circle cx={padX + i * sp} cy={dotY(f)} r="3" fill="currentColor" />
    {/if}
  {/each}
</svg>
