import * as alphaTab from '@coderline/alphatab';
import { parseChordTimeline, type ChordOnset } from '../chords/chordTimeline';
import { prefersFlats, transposeChordLabel } from '../chords/transposeChord';

/**
 * The single integration point with alphaTab (renderer-playhead decision D3).
 * Nothing else in the app imports @coderline/alphatab. This wraps the engine in a
 * small controller the Svelte component and (later) local-transport drive.
 *
 * M1 clock model: alphaTab's player is the local time source. This controller just
 * surfaces position/seek/solo + minimal play controls so the cursor is observable;
 * local-transport will own the controls and stamp session Transport on top of this.
 */

export interface TrackInfo {
  index: number;
  name: string;
}

/**
 * Song timing read straight off the loaded alphaTab score (M1 decision: no separate
 * Song metadata layer yet — the unified-music-model `Song` arrives with library-browsing).
 * local-transport uses this for the %↔BPM mapping and scrubber range.
 */
export interface SongInfo {
  title: string;
  composer: string; // from the score's music/artist credit; '' if none
  tempoBpm: number;
  timeSignature: string; // "n/d" from the first master bar
  measureCount: number;
}

export interface RendererController {
  /** Tracks available in the loaded score (for the backing-part selector). */
  getTracks(): TrackInfo[];
  /** Timing of the loaded score (tempo/meter/length), or null before it loads. */
  getSongInfo(): SongInfo | null;
  /** Chord onsets parsed from the MusicXML harmony, for the chord overlay. */
  getChordTimeline(): ChordOnset[];
  /** Render only the given track (per-track solo / backing-part selection). */
  soloPart(trackIndex: number): void;
  /** Render a stack of tracks together (e.g. shared melody + a player's part). One
   *  player drives them, so every staff's cursor stays in lockstep — no second clock. */
  renderTracks(trackIndices: number[]): void;
  /** Bars per row — drive from container width for responsive, readable notation. */
  setBarsPerRow(bars: number): void;
  /** Bars per row + scale together in ONE re-render — for fit-to-view, whose
   *  verification pass must await exactly one render per applied change. */
  setLayout(bars: number, scale: number): void;
  /** True if the file carries engraved system/page breaks (<print new-system/new-page>). */
  hasEngravedBreaks(): boolean;
  /** Row-break authority, in ONE re-render: on = the file's engraved breaks (bars-per-row
   *  off), off = the responsive bars-per-row given. */
  setEngravedBreaks(on: boolean, barsPerRow: number): void;
  /** Transpose the whole tune by N semitones (display + playback); 0 = written key. */
  setTranspose(semitones: number): void;
  /** Current cursor bar (1-based). */
  getPositionBar(): number;
  /** Move the cursor/player to the start of a bar (1-based). */
  seekToBar(bar: number): void;
  play(): void;
  pause(): void;
  /** Playback speed as a fraction (0.7 = 70%). */
  setSpeed(fraction: number): void;
  /** Mute/unmute the arrangement audio (the score's tracks) only. Deliberately NOT
   *  alphaTab's masterVolume — that is the final output gain, which would silence the
   *  metronome click and count-in too; the three sources must toggle independently. */
  setMusicMuted(muted: boolean): void;
  /** Metronome click volume (0 = off). Native alphaTab click; no custom synth. */
  setMetronomeVolume(volume: number): void;
  /** Count-in click volume (0 = off). Native alphaTab one-bar pre-roll on play. */
  setCountInVolume(volume: number): void;
  /** Re-render at a new display scale (zoom) for legibility. 1 = 100%. */
  setScale(scale: number): void;
  /** Vertical extent of the system row containing a bar (px, relative to the render
   *  host), or null before the first layout. Drives the view's paged auto-scroll. */
  getBarBounds(bar: number): { top: number; bottom: number } | null;
  /** Fires after each completed (re-)render — bar bounds are fresh again. */
  onRender(cb: () => void): void;
  onReady(cb: (tracks: TrackInfo[]) => void): void;
  onError(cb: (err: Error) => void): void;
  onPosition(cb: (bar: number) => void): void;
  onPlayingChanged(cb: (playing: boolean) => void): void;
  /**
   * Fires when the player (soundfont + generated midi) is loaded and play()
   * will actually start. The score renders before this, so controls must wait
   * for it — and on iOS the first real tap is what resumes the audio context.
   */
  onReadyForPlayback(cb: () => void): void;
  destroy(): void;
}

// Respect Vite's base path (/ in dev, /bandaid/ on GitHub Pages) so the bundled
// fonts/soundfont resolve under the deployed subpath. BASE_URL always ends in '/'.
const ALPHATAB_ASSET_BASE = `${import.meta.env.BASE_URL}alphatab`;

export async function createRenderer(
  element: HTMLElement,
  musicXmlUrl: string,
): Promise<RendererController> {
  const api = new alphaTab.AlphaTabApi(element, {
    core: {
      // Use alphaTab's web worker + AudioWorklet (Vite bundles them from
      // alphaTab.mjs via import.meta.url). The AudioWorklet output is required
      // for audio on iOS Safari — the legacy ScriptProcessor fallback (what
      // useWorkers:false forced) is silent there. Fonts/soundfont stay local.
      useWorkers: true,
      fontDirectory: `${ALPHATAB_ASSET_BASE}/font/`,
      // Render the WHOLE score, not just what alphaTab thinks is on screen. The
      // rehearsal view engraves to a virtual page wider than the viewport and
      // CSS-scales it down; with lazy loading on, alphaTab's visibility test sees
      // nothing inside the clipped box and renders a blank page. Our charts are
      // 16–64 bars, so eager rendering costs nothing.
      enableLazyLoading: false,
    },
    player: {
      enablePlayer: true,
      enableCursor: true,
      enableUserInteraction: true, // click a note to seek — interactive seek for free
      soundFont: `${ALPHATAB_ASSET_BASE}/soundfont/sonivox.sf2`,
      scrollMode: 'off',
      // Prefer the AudioWorklet output (default); falls back to ScriptProcessor
      // only if the worklet can't load.
      outputMode: alphaTab.PlayerOutputMode.WebAudioAudioWorklets,
    },
    display: {
      layoutMode: 'page',
      barsPerRow: 4, // 4 bars per row by default for readability
      // Keep alphaTab's default (off) pinned: a short final row must render its bars at
      // natural width. Justifying would stretch a lone leftover bar across the whole row,
      // and the cursor — constant in musical time — would visibly sprint through it.
      justifyLastSystem: false,
    },
  });

  // Warmer solo strings: sonivox (above) stays the GM base — it supplies the metronome
  // click and every non-string program — and the 3.2MB Florestan String Quartet
  // (public domain, presets 40–43: violin/viola/cello/contrabass) is APPENDED on top.
  // alphaTab's preset lookup scans backwards (last loaded wins), so the appended
  // Florestan violin replaces sonivox's thin, fatiguing one for the fiddle parts.
  // Order matters: the settings soundFont loads on player.ready with append=false,
  // which discards anything loaded earlier — so append on the FIRST soundFontLoaded
  // (base in place), guarded because the append itself fires the same event.
  let stringsAppended = false;
  api.soundFontLoaded.on(() => {
    if (stringsAppended) return;
    stringsAppended = true;
    api.loadSoundFont(`${ALPHATAB_ASSET_BASE}/soundfont/florestan-strings.sf2`, true);
  });

  // The app renders its own deduped masthead (title + composer), so suppress alphaTab's
  // built-in score-info block — the MusicXML often sets title AND subtitle to the same
  // text, which would otherwise print the name twice.
  for (const el of [
    alphaTab.NotationElement.ScoreTitle,
    alphaTab.NotationElement.ScoreSubTitle,
    alphaTab.NotationElement.ScoreArtist,
    alphaTab.NotationElement.ScoreAlbum,
    alphaTab.NotationElement.ScoreWords,
    alphaTab.NotationElement.ScoreMusic,
    alphaTab.NotationElement.ScoreWordsAndMusic,
    alphaTab.NotationElement.ScoreCopyright,
    // Tempo lives in the app header (♩ = N pill), so drop alphaTab's in-score tempo
    // marking — it otherwise prints flush against the first chord symbol.
    alphaTab.NotationElement.EffectTempo,
  ]) {
    api.settings.notation.elements.set(el, false);
  }

  // Chord symbols above the staff: bold and a touch larger than alphaTab's default
  // (serif 12 italic), for at-a-glance reading while playing.
  const chordFont = new alphaTab.model.Font(
    'Georgia',
    14,
    alphaTab.model.FontStyle.Plain,
    alphaTab.model.FontWeight.Bold,
  );
  chordFont.families = ['Georgia', 'Times New Roman', 'serif'];
  api.settings.display.resources.elementFonts.set(alphaTab.NotationElement.EffectChordNames, chordFont);
  api.updateSettings();

  let tracks: TrackInfo[] = [];
  let currentBar = 1;
  // The file's engraved system/page breaks (bar indices), captured at load and then
  // CLEARED from the model: the source engraving's breaks encode the width of the PAPER
  // it was set for (rows of 4–6 bars). alphaTab honors them as hard breaks on top of
  // barsPerRow, stranding orphan bars mid-score — so on screen the responsive
  // bars-per-row stays the default layout authority, and "as written" mode re-applies
  // this set on demand. Kept as the union across parts because alphaTab only honors a
  // break when EVERY rendered track carries it (stacked melody + part must agree).
  const engravedBreaks = new Set<number>();
  // As-written chord names, snapshotted before the first transpose so repeated
  // transposes always derive from the original spelling (never re-transpose).
  let writtenChordNames: Map<alphaTab.model.Chord, string> | null = null;
  // The rendered track set (1+ stacked staves), kept so zoom/bars-per-row re-render
  // the same selection instead of dropping back to every track.
  let currentTrackIndices: number[] = [0];
  let playbackReady = false;
  const readyCbs: Array<(t: TrackInfo[]) => void> = [];
  const errorCbs: Array<(e: Error) => void> = [];
  const positionCbs: Array<(bar: number) => void> = [];
  const playingCbs: Array<(playing: boolean) => void> = [];
  const playbackReadyCbs: Array<() => void> = [];
  const renderCbs: Array<() => void> = [];

  api.postRenderFinished.on(() => renderCbs.forEach((cb) => cb()));

  api.playerReady.on(() => {
    playbackReady = true;
    playbackReadyCbs.forEach((cb) => cb());
  });

  api.scoreLoaded.on((score) => {
    // Capture the engraved breaks, then clear them before the first layout runs —
    // dynamic bars-per-row is the default (see engravedBreaks above).
    for (const t of score.tracks) {
      for (const i of t.lineBreaks ?? []) engravedBreaks.add(i);
      t.lineBreaks = undefined;
    }
    tracks = score.tracks.map((t) => ({
      index: t.index,
      name: t.name && t.name.length > 0 ? t.name : `Track ${t.index + 1}`,
    }));
    readyCbs.forEach((cb) => cb(tracks));
  });

  api.error.on((err) => {
    errorCbs.forEach((cb) => cb(err instanceof Error ? err : new Error(String(err))));
  });

  api.playedBeatChanged.on((beat) => {
    const bar = beat.voice.bar.index + 1; // alphaTab is 0-based; app bars are 1-based
    if (bar !== currentBar) {
      currentBar = bar;
      positionCbs.forEach((cb) => cb(bar));
    }
  });

  api.playerStateChanged.on((e) => {
    const playing = e.state === alphaTab.synth.PlayerState.Playing;
    playingCbs.forEach((cb) => cb(playing));
  });

  // Load the MusicXML bytes (fetched locally; no CDN). Decode the same buffer once to
  // parse the chord timeline for the overlay — alphaTab stays the only thing that fetches.
  const res = await fetch(musicXmlUrl);
  if (!res.ok) throw new Error(`Failed to fetch ${musicXmlUrl}: ${res.status}`);
  const buf = await res.arrayBuffer();
  const xmlText = new TextDecoder().decode(buf);
  const chordTimeline = parseChordTimeline(xmlText);
  // Load the file's breaks intact: scoreLoaded captures them into engravedBreaks and
  // clears them from the model, so the default layout is still purely bars-per-row.
  const ok = api.load(new Uint8Array(buf));
  if (!ok) throw new Error(`alphaTab could not parse ${musicXmlUrl}`);

  // Re-render the currently selected track set (after a zoom/bars-per-row change) so
  // settings take effect without dropping back to showing every track.
  function rerenderCurrent() {
    const score = api.score;
    const picked = score ? currentTrackIndices.map((i) => score.tracks[i]).filter(Boolean) : [];
    if (picked.length > 0) api.renderTracks(picked);
    else api.render();
  }

  return {
    getTracks: () => tracks,
    getSongInfo() {
      const score = api.score;
      if (!score || score.masterBars.length === 0) return null;
      const mb0 = score.masterBars[0];
      return {
        title: score.title ?? '',
        composer: score.music || score.artist || '',
        tempoBpm: score.tempo,
        timeSignature: `${mb0.timeSignatureNumerator}/${mb0.timeSignatureDenominator}`,
        measureCount: score.masterBars.length,
      };
    },
    getChordTimeline: () => chordTimeline,
    soloPart(trackIndex: number) {
      const score = api.score;
      if (!score || !score.tracks[trackIndex]) return;
      currentTrackIndices = [trackIndex];
      api.renderTracks([score.tracks[trackIndex]]);
    },
    renderTracks(trackIndices: number[]) {
      const score = api.score;
      if (!score) return;
      const picked = trackIndices.map((i) => score.tracks[i]).filter(Boolean);
      if (picked.length === 0) return;
      currentTrackIndices = picked.map((t) => t.index);
      api.renderTracks(picked);
    },
    setBarsPerRow(bars: number) {
      api.settings.display.barsPerRow = bars;
      api.updateSettings();
      rerenderCurrent();
    },
    setLayout(bars: number, scale: number) {
      api.settings.display.barsPerRow = bars;
      api.settings.display.scale = scale;
      api.updateSettings();
      rerenderCurrent();
    },
    hasEngravedBreaks: () => engravedBreaks.size > 0,
    setEngravedBreaks(on: boolean, barsPerRow: number) {
      const score = api.score;
      if (!score) return;
      // Every render serializes the main-thread score to the layout worker, so writing
      // lineBreaks here is picked up by rerenderCurrent(). Fresh Set per track — alphaTab
      // owns the model objects, so no sharing one Set across tracks.
      for (const t of score.tracks) t.lineBreaks = on ? new Set(engravedBreaks) : undefined;
      // -1 is alphaTab's "off": the engraved breaks must be the ONLY row authority, or
      // bars-per-row chops the engraved rows and strands orphan bars mid-score.
      api.settings.display.barsPerRow = on ? -1 : barsPerRow;
      api.updateSettings();
      rerenderCurrent();
    },
    setTranspose(semitones: number) {
      const score = api.score;
      if (!score) return;
      // One offset per track → the whole arrangement moves together. transpositionPitches
      // (not displayTranspositionPitches) shifts notation AND playback.
      api.settings.notation.transpositionPitches = new Array(score.tracks.length).fill(semitones);
      // The setting alone only reaches the SYNTH inside loadMidiForScore() (score load /
      // player setup) — alphaTab keeps transposition out of the generated MIDI and pitch-
      // shifts live per channel instead. Without re-applying that channel map here, a key
      // change after load would transpose the notation but keep playback in the written
      // key. Mirrors loadMidiForScore's own map; the percussion/metronome channels stay
      // untouched. Safe pre-player: the eventual midi load rebuilds from these settings.
      const pitchMap = new Map<number, number>();
      for (const track of score.tracks) {
        pitchMap.set(track.playbackInfo.primaryChannel, semitones);
        pitchMap.set(track.playbackInfo.secondaryChannel, semitones);
      }
      api.player?.applyTranspositionPitches(pitchMap);
      // transpositionPitches moves pitches only — the chord symbols above the staff are
      // plain text on the score model, so rewrite them from their as-written originals.
      // Spell for the *target* key (flat keys read in flats). Every render serializes the
      // main-thread score to the layout worker, so rerenderCurrent() picks the names up.
      if (!writtenChordNames) {
        writtenChordNames = new Map();
        for (const track of score.tracks)
          for (const staff of track.staves)
            for (const chord of staff.chords?.values() ?? []) writtenChordNames.set(chord, chord.name);
      }
      const writtenFifths = (score.masterBars[0]?.keySignature as unknown as number) ?? 0;
      const flats = prefersFlats(writtenFifths, semitones);
      for (const [chord, written] of writtenChordNames)
        chord.name = transposeChordLabel(written, semitones, flats);
      api.updateSettings();
      rerenderCurrent();
    },
    getPositionBar: () => currentBar,
    seekToBar(bar: number) {
      const score = api.score;
      const cache = api.tickCache;
      if (!score || !cache) return;
      const mb = score.masterBars[bar - 1];
      if (!mb) return;
      api.tickPosition = cache.getMasterBarStart(mb);
    },
    play: () => api.play(),
    pause: () => api.pause(),
    setSpeed: (fraction: number) => {
      api.playbackSpeed = fraction;
    },
    setMusicMuted: (muted: boolean) => {
      const score = api.score;
      if (score) api.changeTrackMute(score.tracks, muted);
    },
    setMetronomeVolume: (volume: number) => {
      api.metronomeVolume = volume;
    },
    setCountInVolume: (volume: number) => {
      api.countInVolume = volume;
    },
    setScale(scale: number) {
      api.settings.display.scale = scale;
      api.updateSettings();
      rerenderCurrent();
    },
    getBarBounds(bar: number) {
      const mb = api.renderer.boundsLookup?.findMasterBarByIndex(bar - 1) ?? null;
      if (!mb) return null;
      // The parent staff system is the whole rendered row — the master bar's own bounds
      // would miss the chord symbols and effects band above the staff.
      const r = mb.staffSystemBounds?.realBounds ?? mb.realBounds;
      return { top: r.y, bottom: r.y + r.h };
    },
    onRender: (cb) => renderCbs.push(cb),
    onReady: (cb) => readyCbs.push(cb),
    onError: (cb) => errorCbs.push(cb),
    onPosition: (cb) => positionCbs.push(cb),
    onPlayingChanged: (cb) => playingCbs.push(cb),
    onReadyForPlayback: (cb) => {
      playbackReadyCbs.push(cb);
      if (playbackReady) cb(); // already ready: fire immediately for late subscribers
    },
    destroy: () => api.destroy(),
  };
}
