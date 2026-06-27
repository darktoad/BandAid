import type { Transport } from '../session/types';

/**
 * The pure playhead reconciliation function.
 *
 * In M1, alphaTab's own player is the live clock — this function is NOT the live
 * ticker. It is used to (a) place the cursor when a song loads against an existing
 * transport, and (b) in M2, project a peer's transport to "now" so the local player
 * can be seeked to where the group actually is.
 *
 * Tempo is expressed in quarter-notes per minute (the MusicXML/alphaTab convention),
 * so the bars/beats conversion goes through quarter-notes-per-bar:
 *   quarterNotesPerBar = numerator * 4 / denominator   (4/4 → 4, 6/8 → 3, 2/4 → 2)
 *
 * Returns a 1-based, possibly fractional bar. Callers floor it for a bar index or
 * use the fraction for sub-bar cursor placement.
 */
export function projectBar(
  t: Transport,
  now: number,
  quarterNotesPerBar: number,
): number {
  if (quarterNotesPerBar <= 0) {
    throw new Error(`quarterNotesPerBar must be > 0, got ${quarterNotesPerBar}`);
  }
  if (!t.playing) return t.startBar;

  const elapsedMs = Math.max(0, now - t.startTimestamp);
  const elapsedMinutes = elapsedMs / 60_000;
  const quarterBeats = t.tempo * elapsedMinutes;
  const bars = quarterBeats / quarterNotesPerBar;
  return t.startBar + bars;
}

/** Derive quarter-notes-per-bar from a "n/d" time signature string. */
export function quarterNotesPerBar(timeSignature: string): number {
  const [numStr, denStr] = timeSignature.split('/');
  const numerator = Number(numStr);
  const denominator = Number(denStr);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    throw new Error(`Invalid time signature: "${timeSignature}"`);
  }
  return (numerator * 4) / denominator;
}
