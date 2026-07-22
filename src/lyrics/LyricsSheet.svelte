<script lang="ts">
  import { lineChunks, type SongSheet } from './chordpro';
  import { loadCollapsed, saveCollapsed, sectionKey, NOTE_KEY } from './collapseState';

  /**
   * Presentational lyrics sheet: an optional performance note (from the manifest) on top,
   * then ChordPro sections rendered chord-over-word. Each line is split into chunks
   * (chord + the text under it) so chords reflow with the lyrics on a narrow screen.
   * Pure: no fetch, no transport — the view owns those and the slide-over chrome.
   *
   * Sections and the note fold away on tap. That's how a long sheet is made to fit —
   * collapse what you don't need and the rest stays at a readable size, instead of
   * shrinking the whole thing until nobody can read it. Purely personal and per song
   * (see collapseState): never synced, everything open by default.
   */
  let { note, sheet, songId }: { note?: string; sheet?: SongSheet; songId?: string } = $props();

  // Re-read when the song changes; without a songId the sheet is simply not collapsible
  // (keeps this usable as a pure presentational component).
  let collapsed = $state<Set<string>>(new Set());
  let loadedFor = $state<string | undefined>(undefined);
  $effect(() => {
    if (songId === loadedFor) return;
    loadedFor = songId;
    collapsed = songId ? loadCollapsed(songId) : new Set();
  });

  function toggle(key: string) {
    if (!songId) return;
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    collapsed = next; // new Set so $state sees the change
    saveCollapsed(songId, next);
  }

  const isCollapsed = (key: string) => collapsed.has(key);
</script>

{#if note}
  {#if songId}
    <button
      class="fold note-head"
      aria-expanded={!isCollapsed(NOTE_KEY)}
      onclick={() => toggle(NOTE_KEY)}
      title={isCollapsed(NOTE_KEY) ? 'Show the note' : 'Hide the note'}
    >
      <span class="chev" class:closed={isCollapsed(NOTE_KEY)} aria-hidden="true">▾</span>
      <span class="note-label">Note</span>
    </button>
    {#if !isCollapsed(NOTE_KEY)}<p class="note">{note}</p>{/if}
  {:else}
    <p class="note">{note}</p>
  {/if}
{/if}

{#if sheet}
  {#each sheet.sections as section, i}
    {#if section.kind === 'comment'}
      <p class="cue">{section.label}</p>
    {:else}
      {@const key = sectionKey(section, i, sheet.sections)}
      {@const shut = isCollapsed(key)}
      <section class="sec" class:shut>
        {#if section.label}
          {#if songId}
            <button class="fold label" aria-expanded={!shut} onclick={() => toggle(key)}>
              <span class="chev" class:closed={shut} aria-hidden="true">▾</span>
              <span>{section.label}</span>
              {#if shut}<span class="count">{section.lines.length} lines</span>{/if}
            </button>
          {:else}
            <h3 class="label static">{section.label}</h3>
          {/if}
        {/if}
        {#if !shut}
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
        {/if}
      </section>
    {/if}
  {/each}
{/if}

<style>
  /* Section content sits indented under its title, so the fold headings form a clean
     left edge and each block reads as belonging to the heading above it. This is what
     carries the grouping now that the panel's own side padding is minimal. */
  .note {
    margin: 0 0 1rem;
    padding-left: 1rem;
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
  /* A folded section is a single line — that compactness is the whole point. */
  .sec.shut {
    margin-bottom: 0.3rem;
  }
  /* Arrangement cue ({comment}): an aside between sections, not part of any one section. */
  .cue {
    margin: 0 0 1.1rem;
    color: var(--muted);
    font-size: 0.92rem;
    font-style: italic;
    line-height: 1.45;
  }
  .label,
  .fold.label {
    margin: 0 0 0.4rem;
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--accent);
  }
  /* The fold control reads as the heading it replaces: no button chrome, just the
     label with a disclosure caret that rotates. */
  .fold {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    width: 100%;
    padding: 0.15rem 0;
    background: none;
    border: none;
    border-radius: 4px;
    text-align: left;
    cursor: pointer;
    font-family: inherit;
  }
  .fold:hover .chev,
  .fold:focus-visible .chev {
    color: var(--ink);
  }
  .note-head {
    margin-bottom: 0.3rem;
    color: var(--muted);
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .chev {
    display: inline-block;
    color: var(--muted);
    font-size: 0.7rem;
    line-height: 1;
    transition: transform 0.12s ease;
  }
  .chev.closed {
    transform: rotate(-90deg);
  }
  .count {
    margin-left: auto;
    color: var(--muted);
    font-size: 0.7rem;
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
  }
  @media (prefers-reduced-motion: reduce) {
    .chev { transition: none; }
  }
  /* Each line is a row of inline chunks that wrap; a chunk stacks its chord over its text. */
  .line {
    display: flex;
    flex-wrap: wrap;
    padding-left: 1rem;
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
