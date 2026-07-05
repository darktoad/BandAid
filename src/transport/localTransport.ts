import type { SessionStore, Transport, TransportStampMeta } from '../session/types';

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
  /** Tempo as a fraction of the song default; clamped to [MIN_TEMPO_PCT,
   *  maxTempoPercent(defaultTempoBpm)]. Restamps if playing. */
  setTempoPercent(pct: number): void;
  /** Move to a bar (from tap-a-bar or scrubber); restamps, preserves playing state. */
  seekToBar(bar: number): void;
  /** Toggle the one-bar count-in (local preference, never synced). Default on. */
  setCountIn(on: boolean): void;
  getTransport(): Transport;
  onTransportChange(cb: (t: Transport) => void): void;
}

export const MIN_TEMPO_PCT = 0.5;
// A flat percentage cap gives a fast chart (say 126bpm) and a slow one (say 86bpm)
// wildly different absolute headroom. Cap instead on absolute BPM: a fiddler pushing
// a jam tempo cares about "how fast can this actually go", not "what percent of the
// chart marking". MAX_TEMPO_PCT below is just an outer safety bound for degenerate
// cases (e.g. a very slow future chart); MAX_TEMPO_BPM is what normally binds.
export const MAX_TEMPO_PCT = 3;
export const MAX_TEMPO_BPM = 200;
const COUNT_IN_VOLUME = 1;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The highest tempo fraction allowed for a song with this written tempo: whichever
 *  is smaller, the flat percentage ceiling or what it takes to reach MAX_TEMPO_BPM.
 *  Exported so a tempo slider's `max` can match exactly what the transport allows. */
export function maxTempoPercent(defaultTempoBpm: number): number {
  if (defaultTempoBpm <= 0) return MAX_TEMPO_PCT;
  return Math.min(MAX_TEMPO_PCT, MAX_TEMPO_BPM / defaultTempoBpm);
}

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
  function stamp(over: Partial<Transport>, meta: TransportStampMeta = { origin: 'anchor' }): void {
    current = {
      songId,
      playing,
      startBar: currentBar,
      startTimestamp: now(),
      tempo: defaultTempoBpm * pct,
      ...over,
    };
    store.setTransport(current, meta);
    listeners.forEach((cb) => cb(current));
  }

  // The renderer advances the cursor; keep currentBar in step so the next stamp anchors
  // correctly. During playback a sequential tick (bar N → N+1) is just the cursor moving —
  // no stamp. But two cursor moves must restamp:
  //  - while paused, a position change is a user tap-a-bar seek through alphaTab's native
  //    click-to-seek (D2) — wire it through the store like an explicit seek;
  //  - while playing, a NON-sequential move is a repeat barline or volta jump. projectBar
  //    extrapolates linearly from the last stamp, so without a re-anchor the projection
  //    runs ahead of the cursor after every repeat (the overlay's beat-progress saturates
  //    full, and an M2 peer following the stamp would drift the same way).
  renderer.onPosition((bar) => {
    const tappedWhilePaused = !playing && bar !== currentBar;
    const jumpedWhilePlaying = playing && bar !== currentBar + 1;
    currentBar = bar;
    // A paused tap is a user seek (intent); a playing jump is a repeat/volta re-anchor
    // (local-only — every device's renderer hits the same jumps itself). ADR-002 D2.1.
    if (tappedWhilePaused) stamp({ startBar: bar }, { origin: 'intent', kind: 'seek' });
    else if (jumpedWhilePlaying) stamp({ startBar: bar });
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
      stamp({ playing: true, startTimestamp: now() + countInMs }, { origin: 'intent', kind: 'play' });
    },

    pause() {
      renderer.pause();
      playing = false;
      stamp({ playing: false }, { origin: 'intent', kind: 'pause' });
    },

    setTempoPercent(next: number) {
      pct = clamp(next, MIN_TEMPO_PCT, maxTempoPercent(defaultTempoBpm));
      renderer.setSpeed(pct);
      // Restamp from the current bar + now so position stays continuous (FR-3): the
      // elapsed-time anchor resets at the bar we're on, so projectBar sees no jump.
      // anchor: tempo *changes* sync via songSettings; this restamp is only position continuity
      stamp({});
    },

    seekToBar(bar: number) {
      const target = clamp(Math.round(bar), 1, measureCount);
      renderer.seekToBar(target);
      currentBar = target;
      stamp({ startBar: target }, { origin: 'intent', kind: 'seek' });
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
