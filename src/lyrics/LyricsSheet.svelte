<script lang="ts">
  import { lineChunks, type SongSheet } from './chordpro';

  /**
   * Presentational lyrics sheet: an optional performance note (from the manifest) on top,
   * then ChordPro sections rendered chord-over-word. Each line is split into chunks
   * (chord + the text under it) so chords reflow with the lyrics on a narrow screen.
   * Pure: no fetch, no transport — the view owns those and the slide-over chrome.
   */
  let { note, sheet }: { note?: string; sheet?: SongSheet } = $props();
</script>

{#if note}
  <p class="note">{note}</p>
{/if}

{#if sheet}
  {#each sheet.sections as section}
    <section class="sec">
      {#if section.label}<h4 class="label">{section.label}</h4>{/if}
      {#each section.lines as line}
        <div class="line">
          {#each lineChunks(line) as chunk}
            <span class="chunk">
              <span class="chord">{chunk.sym}</span>
              <span class="word">{chunk.text}</span>
            </span>
          {/each}
        </div>
      {/each}
    </section>
  {/each}
{/if}

<style>
  .note {
    margin: 0 0 1rem;
    padding-bottom: 0.9rem;
    border-bottom: 1px solid var(--line);
    color: var(--muted);
    font-size: 0.95rem;
    line-height: 1.5;
    white-space: pre-line; /* keep authored line breaks in the note */
  }
  .sec {
    margin-bottom: 1.1rem;
  }
  .label {
    margin: 0 0 0.4rem;
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--accent);
  }
  /* Each line is a row of inline chunks that wrap; a chunk stacks its chord over its text. */
  .line {
    display: flex;
    flex-wrap: wrap;
    margin-bottom: 0.55rem;
    line-height: 1.1;
  }
  .chunk {
    display: inline-flex;
    flex-direction: column;
  }
  .chord {
    height: 1.1em;
    font-weight: 600;
    font-size: 0.82rem;
    color: var(--accent);
  }
  .word {
    white-space: pre; /* preserve the spaces inside a chunk */
    font-size: 1rem;
    color: var(--ink);
  }
</style>
