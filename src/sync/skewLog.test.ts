// src/sync/skewLog.test.ts
import { describe, it, expect } from 'vitest';
import { createSkewLog } from './skewLog';

describe('skew log', () => {
  it('records samples, caps the buffer, and summarizes', () => {
    const log = createSkewLog(3);
    expect(log.summary()).toBeNull();
    for (let i = 1; i <= 5; i++) {
      log.record({ kind: 'play', issuedAt: 0, receivedAt: i * 10, deltaMs: i * 10 });
    }
    expect(log.samples()).toHaveLength(3); // capped, oldest dropped
    expect(log.samples().map((s) => s.deltaMs)).toEqual([30, 40, 50]);
    expect(log.summary()).toEqual({ count: 3, minMs: 30, medianMs: 40, p90Ms: 50, maxMs: 50 });
  });
});
