/**
 * Interpret a free-text entry from the tempo (BPM) field.
 *
 * The field commits on `change` — which fires whenever the player blurs it by tapping
 * another control in the settings sheet (e.g. Count-in). On a touch keyboard an edit
 * tends to *append* rather than replace (the field isn't select-all on focus), so an
 * intended tweak can become a large number; committing that would silently snap the
 * band's tempo to the ceiling. A blank, non-numeric, or out-of-range entry must NOT
 * change the tempo — it is rejected so the current tempo stands.
 *
 * Returns the whole-BPM value to apply, or `null` to reject the entry.
 */
export function parseBpmEntry(raw: string, minBpm: number, maxBpm: number): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  const bpm = Math.round(value);
  if (bpm < minBpm || bpm > maxBpm) return null;
  return bpm;
}
