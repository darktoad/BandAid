// src/sync/skewLog.ts
/**
 * Skew/latency evidence for the M4 gate (multi-user review G3): each applied remote
 * intent records (receivedAt − issuedAt) — one-way delivery latency plus clock skew,
 * conflated on purpose: the *total* observed offset is the playhead-error budget.
 * Read during rehearsal via window.__bandaidSkew (wired in App.svelte).
 */
export interface SkewSample {
  kind: string;
  issuedAt: number;
  receivedAt: number;
  deltaMs: number;
}
export interface SkewSummary {
  count: number;
  minMs: number;
  medianMs: number;
  p90Ms: number;
  maxMs: number;
}
export interface SkewLog {
  record(s: SkewSample): void;
  samples(): SkewSample[];
  summary(): SkewSummary | null;
}

export function createSkewLog(cap = 200): SkewLog {
  const buf: SkewSample[] = [];
  return {
    record(s) {
      buf.push(s);
      if (buf.length > cap) buf.shift();
    },
    samples: () => [...buf],
    summary() {
      if (buf.length === 0) return null;
      const sorted = buf.map((s) => s.deltaMs).sort((a, b) => a - b);
      const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
      return {
        count: sorted.length,
        minMs: sorted[0],
        medianMs: at(0.5),
        p90Ms: at(0.9),
        maxMs: sorted[sorted.length - 1],
      };
    },
  };
}

/** App-wide singleton — the follower records into it, App exposes it on window. */
export const skewLog = createSkewLog();
