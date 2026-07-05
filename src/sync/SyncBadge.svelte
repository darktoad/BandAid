<script lang="ts">
  import type { SyncTone } from './syncStatusLabel';

  /** Small inline, non-interactive badge — sits in a header's normal flex flow so it
      never overlaps other controls (unlike a fixed-position overlay). */
  let { summary }: { summary: { label: string; tone: SyncTone } } = $props();
</script>

<span class="sync-badge" data-tone={summary.tone} title="Band sync: {summary.label}">
  <span class="dot"></span>{summary.label}
</span>

<style>
  .sync-badge {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.55rem;
    border-radius: 999px;
    border: 1px solid var(--line);
    color: var(--muted);
    font-size: 0.72rem;
    white-space: nowrap;
  }
  .dot {
    flex: 0 0 auto;
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: currentColor;
  }
  .sync-badge[data-tone='synced'] { color: #8fd18a; }
  .sync-badge[data-tone='connecting'] { color: var(--accent); }
  .sync-badge[data-tone='offline'] { color: #f1b4b4; }
</style>
