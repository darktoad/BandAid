import { describe, it, expect, vi } from 'vitest';
import { createLocalTransport, MIN_TEMPO_PCT, MAX_TEMPO_PCT, type TransportRenderer } from './localTransport';
import { createLocalSessionStore } from '../session/store';
import { projectBar, quarterNotesPerBar } from '../playhead/projectBar';

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
    fake.advanceTo(4); // cursor sat at bar 4 when the user hit play

    transport.play();

    expect(fake.calls.play).toBe(1);
    const tr = store.getState().transport!;
    expect(tr.playing).toBe(true);
    expect(tr.startBar).toBe(4);
    expect(tr.startTimestamp).toBe(5000);
    expect(tr.tempo).toBe(120);
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

    transport.setTempoPercent(2.0); // over max
    expect(fake.calls.speed.at(-1)).toBe(MAX_TEMPO_PCT);

    transport.setTempoPercent(0.1); // under min
    expect(fake.calls.speed.at(-1)).toBe(MIN_TEMPO_PCT);
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
