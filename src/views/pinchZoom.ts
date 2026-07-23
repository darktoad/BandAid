/**
 * Per-pane zoom + pan gestures over the auto-fit baseline (David's mockup-review
 * requests):
 *  - two-pointer gesture: distance change ZOOMS, centroid movement PANS — one
 *    map-style motion does both;
 *  - Ctrl+wheel (also what a trackpad pinch sends) always zooms; a PLAIN wheel zooms
 *    only while the pane is fitted (nothing to scroll — the wheel is otherwise a dead
 *    input) and returns to native scrolling once content overflows;
 *  - middle-mouse drag pans in 2D (the desktop pan);
 *  - double-click / double-tap resets to auto-fit.
 * The action only reports numbers; the caller owns what zoom MEANS (and e.g.
 * disengages Fit).
 */
export function clampZoom(z: number, min = 0.4, max = 3): number {
  return Math.min(max, Math.max(min, z));
}

export function pinchZoom(
  node: HTMLElement,
  opts: {
    getZoom: () => number;
    onZoom: (z: number) => void;
    onReset?: () => void;
    /** True when the pane currently has content overflowing its box (i.e. the wheel
     *  has real scrolling to do). Absent/false → a plain wheel may zoom. */
    hasOverflow?: () => boolean;
    /** Pan the pane's content by a pointer delta (px). */
    pan?: (dx: number, dy: number) => void;
  },
) {
  const pointers = new Map<number, { x: number; y: number }>();
  let startDist = 0;
  let startZoom = 1;
  let lastCentroid: { x: number; y: number } | null = null;
  let midPan: { x: number; y: number } | null = null;
  const dist = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const centroid = () => {
    const [a, b] = [...pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  const down = (e: PointerEvent) => {
    // Middle-mouse drag = pan. preventDefault kills the browser's autoscroll
    // widget, which would otherwise fight us.
    if (e.pointerType === 'mouse' && e.button === 1) {
      e.preventDefault();
      midPan = { x: e.clientX, y: e.clientY };
      try {
        node.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic/stale pointer */
      }
      return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      startDist = dist();
      startZoom = opts.getZoom();
      lastCentroid = centroid();
    }
  };
  const move = (e: PointerEvent) => {
    if (midPan) {
      opts.pan?.(midPan.x - e.clientX, midPan.y - e.clientY);
      midPan = { x: e.clientX, y: e.clientY };
      return;
    }
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && startDist > 0) {
      e.preventDefault();
      opts.onZoom(clampZoom(startZoom * (dist() / startDist)));
      const c = centroid();
      if (lastCentroid) opts.pan?.(lastCentroid.x - c.x, lastCentroid.y - c.y);
      lastCentroid = c;
    }
  };
  const up = (e: PointerEvent) => {
    midPan = null;
    pointers.delete(e.pointerId);
    startDist = 0;
    lastCentroid = null;
  };
  const wheel = (e: WheelEvent) => {
    // Ctrl+wheel always zooms; a plain wheel only while there's nothing to scroll.
    if (!e.ctrlKey && opts.hasOverflow?.()) return;
    e.preventDefault();
    opts.onZoom(clampZoom(opts.getZoom() * Math.exp(-e.deltaY / 300)));
  };
  const dbl = () => opts.onReset?.();
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
  node.addEventListener('wheel', wheel, { passive: false });
  node.addEventListener('dblclick', dbl);
  return {
    destroy() {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
      node.removeEventListener('wheel', wheel);
      node.removeEventListener('dblclick', dbl);
    },
  };
}
