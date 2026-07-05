import { describe, it, expect, vi } from 'vitest';
import { createLocalTransport, MIN_TEMPO_PCT, MAX_TEMPO_PCT, MAX_TEMPO_BPM, maxTempoPercent, type TransportRenderer, type LocalTransportDeps } from './localTransport';
import { createLocalSessionStore } from '../session/store';
import { projectBar, quarterNotesPerBar } from '../playhead/projectBar';
import type { SessionStore, Transport, TransportStampMeta } from '../session/types';

/** A fake renderer that records calls and lets the test drive the cursor/playing
 *  callbacks — the same shape alphaTab's createRenderer exposes, without alphaTab. */
function fakeRenderer(initialBar = 1) {
  let bar = initialBar;
  const positionCbs: Array<(b: number) => void> = [];
  const playingCbs: Array<(p: boolean) => void> = [];
  const calls = {
    play: 0,
    pause: 0,
    speed: [] as number[],
    seek: [] as number[],
    countInVolume: [] as number[],
  };
  const renderer: TransportRenderer = {
    play: () => void calls.play++,
    pause: () => void calls.pause++,
    setSpeed: (f) => void calls.speed.push(f),
    seekToBar: (b) => {
      calls.seek.push(b);
      bar = b;
    },
    getPositionBar: () => bar,
    setCountInVolume: (v) => void calls.countInVolume.push(v),
    onPosition: (cb) => void positionCbs.push(cb),
    onPlayingChanged: (cb) => void playingCbs.push(cb),
  };
  return {
    renderer,
    calls,
    // Drive the cursor forward the way alphaTab's playedBeatChanged would.
    advanceTo: (b: number) => {
      bar = b;
      positionCbs.forEach((cb) => cb(b));
    },
    emitPlaying: (p: boolean) => playingCbs.forEach((cb) => cb(p)),
  };
}

function setup(over: { now?: () => number; defaultTempoBpm?: number; measureCount?: number } = {}) {
  const fake = fakeRenderer();
  const store = createLocalSessionStore({ currentSongId: 'big-john-mcneil' });
  const transport = createLocalTransport({
    songId: 'big-john-mcneil',
    defaultTempoBpm: over.defaultTempoBpm ?? 120,
    measureCount: over.measureCount ?? 32,
    quarterNotesPerBar: quarterNotesPerBar('4/4'),
    renderer: fake.renderer,
    store,
    now: over.now ?? (() => 1000),
  });
  return { fake, store, transport };
}

describe('local transport (sole writer of Transport)', () => {
  it('play stamps playing:true with the current bar and time, and starts the player', () => {
    let t = 5000;
    const { fake, store, transport } = setup({ now: () => t });
    transport.setCountIn(false); // isolate the base stamp from the count-in offset
    fake.advanceTo(4); // cursor sat at bar 4 when the user hit play

    transport.play();

    expect(fake.calls.play).toBe(1);
    const tr = store.getState().transport!;
    expect(tr.playing).toBe(true);
    expect(tr.startBar).toBe(4);
    expect(tr.startTimestamp).toBe(5000);
    expect(tr.tempo).toBe(120);
  });

  it('count-in offsets the stamp one bar into the future so progress holds until playback', () => {
    let t = 5000;
    const { store, transport } = setup({ now: () => t, defaultTempoBpm: 120 });
    const qpb = quarterNotesPerBar('4/4');

    transport.play(); // count-in on by default; one 4/4 bar at 120bpm = 2000ms

    const tr = store.getState().transport!;
    expect(tr.startTimestamp).toBe(7000); // 5000 + 2000ms of count-in
    // During the count-in the projected bar stays put — no progress sweeps the first bar.
    expect(projectBar(tr, 5000, qpb)).toBe(tr.startBar);
    expect(projectBar(tr, 6000, qpb)).toBe(tr.startBar);
    // Once the count-in elapses, playback advances normally.
    expect(projectBar(tr, 9000, qpb)).toBeCloseTo(tr.startBar + 1);
  });

  it('stamps the intended state immediately, not a stale read (the old App bug)', () => {
    const { transport } = setup();
    // No renderer onPlayingChanged callback has fired yet; play() must still stamp true.
    transport.play();
    expect(transport.getTransport().playing).toBe(true);
  });

  it('pause stamps playing:false at the bar the cursor actually reached', () => {
    const { fake, store, transport } = setup();
    transport.play();
    fake.advanceTo(9); // played through to the B part

    transport.pause();

    expect(fake.calls.pause).toBe(1);
    const tr = store.getState().transport!;
    expect(tr.playing).toBe(false);
    expect(tr.startBar).toBe(9);
  });

  it('tempo maps % to BPM, clamps to range, and preserves pitch via playback rate', () => {
    const { fake, store, transport } = setup({ defaultTempoBpm: 120 });

    transport.setTempoPercent(0.7);
    expect(fake.calls.speed.at(-1)).toBe(0.7);
    expect(store.getState().transport!.tempo).toBeCloseTo(84);

    transport.setTempoPercent(2.0); // over the per-song ceiling (200bpm / 120bpm)
    expect(fake.calls.speed.at(-1)).toBeCloseTo(MAX_TEMPO_BPM / 120);

    transport.setTempoPercent(0.1); // under min
    expect(fake.calls.speed.at(-1)).toBe(MIN_TEMPO_PCT);
  });

  it('the ceiling is an absolute BPM cap, not a flat percentage: slow tunes get more headroom than fast ones', () => {
    // Slow tune (86bpm, like Old Blue): the 200bpm ceiling allows well over 200%.
    const slow = setup({ defaultTempoBpm: 86 });
    slow.transport.setTempoPercent(10); // absurdly high input, well past any real ceiling
    expect(slow.fake.calls.speed.at(-1)).toBeCloseTo(MAX_TEMPO_BPM / 86);

    // Fast tune (126bpm, like East Tennessee Blues): same 200bpm ceiling caps lower.
    const fast = setup({ defaultTempoBpm: 126 });
    fast.transport.setTempoPercent(10);
    expect(fast.fake.calls.speed.at(-1)).toBeCloseTo(MAX_TEMPO_BPM / 126);
  });

  it('maxTempoPercent exposes exactly the ceiling the transport enforces, for the slider to match', () => {
    expect(maxTempoPercent(86)).toBeCloseTo(MAX_TEMPO_BPM / 86);
    expect(maxTempoPercent(126)).toBeCloseTo(MAX_TEMPO_BPM / 126);
    // A hypothetical very slow chart: the flat percentage ceiling wins instead.
    expect(maxTempoPercent(40)).toBe(MAX_TEMPO_PCT);
  });

  it('changing tempo mid-playback keeps the position continuous (no jump)', () => {
    let t = 1000;
    const { fake, transport } = setup({ now: () => t, defaultTempoBpm: 120 });
    const qpb = quarterNotesPerBar('4/4');

    transport.play();          // stamp at bar 1, t=1000
    t = 2000;                  // one second later...
    fake.advanceTo(3);         // cursor reached bar 3
    transport.setTempoPercent(0.5); // user slows down

    // Right after the restamp, projected position == the bar we were on (no jump).
    const tr = transport.getTransport();
    expect(projectBar(tr, t, qpb)).toBeCloseTo(3);
    expect(tr.playing).toBe(true); // tempo change doesn't stop playback
  });

  it('seek clamps to [1, measureCount], restamps the bar, and preserves playing', () => {
    const { fake, store, transport } = setup({ measureCount: 32 });
    transport.play();

    transport.seekToBar(9);
    expect(fake.calls.seek.at(-1)).toBe(9);
    expect(store.getState().transport!.startBar).toBe(9);
    expect(store.getState().transport!.playing).toBe(true);

    transport.seekToBar(999); // past the end
    expect(store.getState().transport!.startBar).toBe(32);

    transport.seekToBar(0); // before the start
    expect(store.getState().transport!.startBar).toBe(1);
  });

  it('count-in is a local preference: applied to the player, never written to session state', () => {
    const { fake, store, transport } = setup();

    transport.play(); // default on
    expect(fake.calls.countInVolume.at(-1)).toBeGreaterThan(0);

    transport.setCountIn(false);
    transport.play();
    expect(fake.calls.countInVolume.at(-1)).toBe(0);

    // The session Transport never carries the count-in flag.
    expect(store.getState().transport).not.toHaveProperty('countIn');
  });

  it('tap-a-bar seek while paused (native alphaTab click) is wired through the store', () => {
    const { fake, store, transport } = setup();
    // Paused; user clicks bar 13 in the score → alphaTab moves the cursor and emits position.
    fake.advanceTo(13);
    const tr = store.getState().transport!;
    expect(tr.startBar).toBe(13);
    expect(tr.playing).toBe(false);
  });

  it('position ticks during playback track the cursor but do not stamp', () => {
    const { fake, store, transport } = setup();
    transport.play();
    const stampsBefore = store.getState().transport;
    fake.advanceTo(2);
    fake.advanceTo(3);
    // Same Transport reference — no restamp happened on plain playback ticks.
    expect(store.getState().transport).toBe(stampsBefore);
  });

  it('a repeat jump while playing restamps so projection re-anchors (regression: stuck overlay fill)', () => {
    let t = 1000;
    const { fake, store, transport } = setup({ now: () => t });
    transport.setCountIn(false);
    transport.play();
    fake.advanceTo(2);
    fake.advanceTo(3);
    fake.advanceTo(4);
    const before = store.getState().transport!;

    // Repeat barline: alphaTab's cursor jumps 4 -> 1. Without a restamp, projectBar
    // keeps projecting linearly (~bar 4+) and the overlay's progress saturates full.
    t = 9000;
    fake.advanceTo(1);

    const after = store.getState().transport!;
    expect(after).not.toBe(before);
    expect(after.playing).toBe(true);
    expect(after.startBar).toBe(1);
    expect(after.startTimestamp).toBe(9000);
    // The projection now agrees with the cursor again.
    expect(projectBar(after, 9000, 4)).toBe(1);
  });

  it('a volta skip forward while playing also restamps', () => {
    const { fake, store, transport } = setup();
    transport.play();
    fake.advanceTo(2);
    const before = store.getState().transport!;
    fake.advanceTo(9); // second ending: cursor skips ahead non-sequentially
    const after = store.getState().transport!;
    expect(after).not.toBe(before);
    expect(after.startBar).toBe(9);
  });

  it('notifies onTransportChange subscribers and reflects the latest snapshot', () => {
    const { transport } = setup();
    const seen = vi.fn();
    transport.onTransportChange(seen);

    transport.play();
    transport.setTempoPercent(0.8);

    expect(seen).toHaveBeenCalledTimes(2);
    expect(transport.getTransport().tempo).toBeCloseTo(96);
  });

  it('stamps land in the SessionStore — the same seam M2 multi-writer transport uses', () => {
    const { store, transport } = setup();
    const onState = vi.fn();
    store.subscribe(onState);
    onState.mockClear();

    transport.play();

    // A consumer subscribed to the store reacts to a transport stamp identically
    // whether it came from these local controls or (in M2) a remote peer.
    expect(onState).toHaveBeenCalledTimes(1);
    expect(store.getState().transport!.songId).toBe('big-john-mcneil');
  });
});

// --- Origin routing (ADR-002 D2.1): intents sync, anchors stay local ---

function stubRenderer() {
  const pos: Array<(bar: number) => void> = [];
  const playChanged: Array<(p: boolean) => void> = [];
  const calls: string[] = [];
  let posBar = 1;
  return {
    renderer: {
      play: () => calls.push('play'),
      pause: () => calls.push('pause'),
      setSpeed: (f: number) => calls.push(`speed:${f}`),
      seekToBar: (b: number) => { posBar = b; calls.push(`seek:${b}`); },
      getPositionBar: () => posBar,
      setCountInVolume: (v: number) => calls.push(`countin:${v}`),
      onPosition: (cb: (b: number) => void) => pos.push(cb),
      onPlayingChanged: (cb: (p: boolean) => void) => playChanged.push(cb),
    },
    calls,
    emitPosition: (b: number) => pos.forEach((cb) => cb(b)),
    emitPlaying: (p: boolean) => playChanged.forEach((cb) => cb(p)),
  };
}

function spyStore() {
  const stamps: Array<{ t: Transport; meta: TransportStampMeta | undefined }> = [];
  const store: SessionStore = {
    subscribe: () => () => {},
    getState: () => ({ currentSongId: null, transport: null, songSettings: {} }),
    setCurrentSong: () => {},
    setTransport: (t, meta) => stamps.push({ t, meta }),
    getSongSettings: () => ({}),
    setSongSetting: () => {},
    resetSongSetting: () => {},
  };
  return { store, stamps };
}

function makeTransport(over: Partial<LocalTransportDeps> = {}) {
  const r = stubRenderer();
  const s = spyStore();
  const transport = createLocalTransport({
    songId: 'tune',
    defaultTempoBpm: 120,
    measureCount: 32,
    quarterNotesPerBar: 4,
    renderer: r.renderer,
    store: s.store,
    now: () => 50_000,
    ...over,
  });
  return { transport, ...r, ...s };
}

describe('stamp origin routing', () => {
  it('play, pause, and seekToBar stamp as intents with their kind', () => {
    const { transport, stamps, emitPlaying } = makeTransport();
    transport.play();
    emitPlaying(true);
    transport.pause();
    emitPlaying(false);
    transport.seekToBar(5);
    expect(stamps.map((s) => s.meta)).toEqual([
      { origin: 'intent', kind: 'play' },
      { origin: 'intent', kind: 'pause' },
      { origin: 'intent', kind: 'seek' },
    ]);
  });

  it('a paused tap-a-bar is an intent seek', () => {
    const { stamps, emitPosition } = makeTransport();
    emitPosition(7); // position moved while paused = alphaTab click-to-seek
    expect(stamps).toHaveLength(1);
    expect(stamps[0].meta).toEqual({ origin: 'intent', kind: 'seek' });
    expect(stamps[0].t.startBar).toBe(7);
  });

  it('a repeat/volta jump while playing is a local anchor', () => {
    const { transport, stamps, emitPlaying, emitPosition } = makeTransport();
    transport.play();
    emitPlaying(true);
    emitPosition(2); // sequential: no stamp
    emitPosition(1); // repeat barline: non-sequential → anchor re-stamp
    expect(stamps).toHaveLength(2);
    expect(stamps[1].meta).toEqual({ origin: 'anchor' });
  });

  it('a tempo-continuity restamp is a local anchor (tempo syncs via songSettings)', () => {
    const { transport, stamps } = makeTransport();
    transport.setTempoPercent(0.8);
    expect(stamps).toHaveLength(1);
    expect(stamps[0].meta).toEqual({ origin: 'anchor' });
  });
});
