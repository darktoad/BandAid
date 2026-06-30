import type { SessionStore, Transport } from '../session/types';

/**
 * Local Transport — the controls that drive the playhead (M1 feature: local-transport).
 *
 * This is the *sole writer* of the session `Transport` object (FR-7 / decision D4):
 * play/pause/tempo/seek turn into alphaTab calls AND a single stamped
 * `{ playing, startBar, startTimestamp, tempo }`. In M1 there is one writer (a session
 * of one); in M2 the same object becomes multi-writer (last-write-wins by timestamp)
 * with no change to this controller — peers stamp through the same SessionStore.
 *
 * The cursor itself is never written here: alphaTab's player is the live clock and the
 * stamp is only the reference point `projectBar` reconciles against.
 */

/**
 * The slice of the renderer the transport needs. Depending on this narrow interface
 * (not the concrete RendererController) keeps alphaTab behind createRenderer and lets
 * the restamp logic be unit-tested against a fake renderer.
 */
export interface TransportRenderer {
  play(): void;
  pause(): void;
  setSpeed(fraction: number): void;
  seekToBar(bar: number): void;
  getPositionBar(): number;
  setCountInVolume(volume: number): void;
  onPosition(cb: (bar: number) => void): void;
  onPlayingChanged(cb: (playing: boolean) => void): void;
}

export interface LocalTransportDeps {
  songId: string;
  /** Song default tempo (BPM) — basis for the "% of original" ↔ BPM mapping. */
  defaultTempoBpm: number;
  /** Highest seekable bar (1-based); seeks clamp to this. */
  measureCount: number;
  /** Quarter-notes per bar of the active meter — sizes the one-bar count-in pre-roll. */
  quarterNotesPerBar: number;
  renderer: TransportRenderer;
  store: SessionStore;
  /** Clock for stamps. Injectable for tests; defaults to wall-clock epoch ms. */
  now?: () => number;
}

export interface LocalTransport {
  play(): void;
  pause(): void;
  /** Tempo as a fraction of the song default (~0.5–1.1); restamps if playing. */
  setTempoPercent(pct: number): void;
  /** Move to a bar (from tap-a-bar or scrubber); restamps, preserves playing state. */
  seekToBar(bar: number): void;
  /** Toggle the one-bar count-in (local preference, never synced). Default on. */
  setCountIn(on: boolean): void;
  getTransport(): Transport;
  onTransportChange(cb: (t: Transport) => void): void;
}

export const MIN_TEMPO_PCT = 0.5;
export const MAX_TEMPO_PCT = 1.1;
const COUNT_IN_VOLUME = 1;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function createLocalTransport(deps: LocalTransportDeps): LocalTransport {
  const { songId, defaultTempoBpm, measureCount, quarterNotesPerBar, renderer, store } = deps;
  const now = deps.now ?? (() => Date.now());

  // Local presentation state (never synced).
  let pct = 1;
  let countIn = true;

  // Truth tracked from the renderer so each new stamp anchors on the real cursor bar.
  let currentBar = Math.max(1, renderer.getPositionBar());
  let playing = false;

  const listeners: Array<(t: Transport) => void> = [];
  let current: Transport = {
    songId,
    playing: false,
    startBar: currentBar,
    startTimestamp: now(),
    tempo: defaultTempoBpm,
  };

  /** Stamp once: write the session Transport and notify view subscribers. The only
   *  place that mutates Transport — callers pass the *target* state so we never stamp
   *  a stale value the way an after-the-fact read would. */
  function stamp(over: Partial<Transport>): void {
    current = {
      songId,
      playing,
      startBar: currentBar,
      startTimestamp: now(),
      tempo: defaultTempoBpm * pct,
      ...over,
    };
    store.setTransport(current);
    listeners.forEach((cb) => cb(current));
  }

  // The renderer advances the cursor; keep currentBar in step so the next stamp anchors
  // correctly. During playback a position tick is just the cursor moving — no stamp. But
  // a position change while paused is a user tap-a-bar seek through alphaTab's native
  // click-to-seek (D2), so wire it through the store like an explicit seek.
  renderer.onPosition((bar) => {
    const tappedWhilePaused = !playing && bar !== currentBar;
    currentBar = bar;
    if (tappedWhilePaused) stamp({ startBar: bar });
  });
  // Reflect the renderer's actual playing state, but don't re-stamp from it: our action
  // methods already stamped the intended state immediately (NFR-1).
  renderer.onPlayingChanged((p) => {
    playing = p;
  });

  return {
    play() {
      renderer.setCountInVolume(countIn ? COUNT_IN_VOLUME : 0);
      renderer.play();
      playing = true;
      // With count-in on, alphaTab plays a one-bar pre-roll before the cursor moves. Anchor
      // the stamp one bar in the *future* so projectBar holds at startBar through the count-in
      // (it floors elapsed at 0) instead of racing the playhead ahead of the silent cursor.
      const tempoQpm = defaultTempoBpm * pct;
      const countInMs = countIn && tempoQpm > 0 ? (quarterNotesPerBar / tempoQpm) * 60_000 : 0;
      stamp({ playing: true, startTimestamp: now() + countInMs });
    },

    pause() {
      renderer.pause();
      playing = false;
      stamp({ playing: false });
    },

    setTempoPercent(next: number) {
      pct = clamp(next, MIN_TEMPO_PCT, MAX_TEMPO_PCT);
      renderer.setSpeed(pct);
      // Restamp from the current bar + now so position stays continuous (FR-3): the
      // elapsed-time anchor resets at the bar we're on, so projectBar sees no jump.
      stamp({});
    },

    seekToBar(bar: number) {
      const target = clamp(Math.round(bar), 1, measureCount);
      renderer.seekToBar(target);
      currentBar = target;
      stamp({ startBar: target });
    },

    setCountIn(on: boolean) {
      countIn = on; // local pref; applied on next play(), never written to session state
    },

    getTransport: () => current,
    onTransportChange(cb) {
      listeners.push(cb);
    },
  };
}
