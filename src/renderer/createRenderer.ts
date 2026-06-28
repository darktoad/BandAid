import * as alphaTab from '@coderline/alphatab';

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
  tempoBpm: number;
  timeSignature: string; // "n/d" from the first master bar
  measureCount: number;
}

export interface RendererController {
  /** Tracks available in the loaded score (for the backing-part selector). */
  getTracks(): TrackInfo[];
  /** Timing of the loaded score (tempo/meter/length), or null before it loads. */
  getSongInfo(): SongInfo | null;
  /** Render only the given track (per-track solo / backing-part selection). */
  soloPart(trackIndex: number): void;
  /** Current cursor bar (1-based). */
  getPositionBar(): number;
  /** Move the cursor/player to the start of a bar (1-based). */
  seekToBar(bar: number): void;
  play(): void;
  pause(): void;
  /** Playback speed as a fraction (0.7 = 70%). */
  setSpeed(fraction: number): void;
  /** Synth playback volume (0 = silent, 1 = full). The arrangement audio. */
  setMasterVolume(volume: number): void;
  /** Metronome click volume (0 = off). Native alphaTab click; no custom synth. */
  setMetronomeVolume(volume: number): void;
  /** Count-in click volume (0 = off). Native alphaTab one-bar pre-roll on play. */
  setCountInVolume(volume: number): void;
  /** Re-render at a new display scale (zoom) for legibility. 1 = 100%. */
  setScale(scale: number): void;
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
    },
  });

  let tracks: TrackInfo[] = [];
  let currentBar = 1;
  let currentTrackIndex = 0; // the soloed/rendered track, so we can re-render it on zoom
  let playbackReady = false;
  const readyCbs: Array<(t: TrackInfo[]) => void> = [];
  const errorCbs: Array<(e: Error) => void> = [];
  const positionCbs: Array<(bar: number) => void> = [];
  const playingCbs: Array<(playing: boolean) => void> = [];
  const playbackReadyCbs: Array<() => void> = [];

  api.playerReady.on(() => {
    playbackReady = true;
    playbackReadyCbs.forEach((cb) => cb());
  });

  api.scoreLoaded.on((score) => {
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

  // Load the MusicXML bytes (fetched locally; no CDN).
  const res = await fetch(musicXmlUrl);
  if (!res.ok) throw new Error(`Failed to fetch ${musicXmlUrl}: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const ok = api.load(bytes);
  if (!ok) throw new Error(`alphaTab could not parse ${musicXmlUrl}`);

  return {
    getTracks: () => tracks,
    getSongInfo() {
      const score = api.score;
      if (!score || score.masterBars.length === 0) return null;
      const mb0 = score.masterBars[0];
      return {
        title: score.title ?? '',
        tempoBpm: score.tempo,
        timeSignature: `${mb0.timeSignatureNumerator}/${mb0.timeSignatureDenominator}`,
        measureCount: score.masterBars.length,
      };
    },
    soloPart(trackIndex: number) {
      const score = api.score;
      if (!score || !score.tracks[trackIndex]) return;
      currentTrackIndex = trackIndex;
      api.renderTracks([score.tracks[trackIndex]]);
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
    setMasterVolume: (volume: number) => {
      api.masterVolume = volume;
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
      // Re-render the currently soloed track so the zoom takes effect without
      // dropping back to showing every track.
      const score = api.score;
      if (score && score.tracks[currentTrackIndex]) {
        api.renderTracks([score.tracks[currentTrackIndex]]);
      } else {
        api.render();
      }
    },
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
