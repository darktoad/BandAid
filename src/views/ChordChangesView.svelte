<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import Renderer from '../renderer/Renderer.svelte';
  import type { RendererController, TrackInfo } from '../renderer/createRenderer';
  import { createLocalTransport, maxTempoPercent, type LocalTransport } from '../transport/localTransport';
  import type { SyncedSessionStore } from '../sync/syncedSessionStore';
  import { createTransportFollower } from '../sync/transportFollower';
  import { skewLog } from '../sync/skewLog';
  import Icon from '../icons/Icon.svelte';
  import ChordOverlay from '../chords/ChordOverlay.svelte';
  import type { Instrument } from '../chords/chordShapes';
  import type { ChordOnset } from '../chords/chordTimeline';
  import { projectBar, quarterNotesPerBar } from '../playhead/projectBar';
  import LyricsSheet from '../lyrics/LyricsSheet.svelte';
  import { parseChordPro, transposeSheet, type SongSheet } from '../lyrics/chordpro';
  import { prefersFlats, transposeChordLabel, transposeNote } from '../chords/transposeChord';
  import SyncBadge from '../sync/SyncBadge.svelte';
  import type { SyncTone } from '../sync/syncStatusLabel';

  /**
   * Chord-Changes-in-Time view (M1). A presentation template over the unified music
   * model + session transport: alphaTab renders chord symbols above the staff, its cursor
   * is the playhead, and the local-transport controller drives + stamps it.
   *
   * Mobile-layout prototype:
   *  - The top header is navigation/meta only (songs, title, info, menu); everything
   *    band-synced sits together in one strip below it (play/pause, return to start,
   *    key, tempo). Local-only controls (size, audio, "my part", sync setup) fold
   *    into the "More" sheet.
   *  - Notation reflows by container width (responsive bars-per-row) for legibility.
   *  - The SHARED MELODY is the default view; a player toggles "my part" to add their
   *    own instrument staff. One alphaTab player drives both, so the part's cursor stays
   *    in lockstep with the melody — no second clock. (A fully independent split surface
   *    is the richer M3 form.)
   * Local choices (part, tempo %, audio, zoom) live here; only Transport is synced.
   */
  let { song, store, sync, onsongs, onprogress }: {
    song: { id: string; url: string; title: string; key?: { tonalCenter: string; mode: string; fifths?: number }; composer?: string; notes?: string; lyricsUrl?: string };
    store: SyncedSessionStore;
    // Band sync controls for the settings sheet: the app starts local; syncing is an
    // intentional step, toggled here.
    sync: {
      on: boolean;
      bandName: string;
      summary: { label: string; tone: SyncTone };
      toggle: () => void;
      setBandName: (name: string) => void;
    };
    onsongs?: () => void; // open the slide-over song picker
    onprogress?: (fraction: number) => void; // 0–1 playback position, for the picker
  } = $props();

  let controller = $state<RendererController | undefined>(undefined);
  let transport = $state<LocalTransport | undefined>(undefined);
  let tracks = $state<TrackInfo[]>([]);
  // The shared melody is the first track; everyone sees it by default.
  let melodyIndex = $state(0);
  // The player's own part stacked under the melody (null = melody only).
  let myPart = $state<number | null>(null);
  let bar = $state(1);
  let playing = $state(false);
  let canPlay = $state(false); // true once the soundfont/player is loaded
  let speedPct = $state(100);
  let transpose = $state(0); // semitones from written key; 0 = original
  let scalePct = $state(100); // notation zoom (local presentation, not transport)
  let tempoBpm = $state(120); // replaced by the score's real tempo once it loads
  let measureCount = $state(1); // scrubber range; replaced from the score once loaded
  // Audio: on/off is local and never synced — a fast, hands-free toggle for use
  // mid-song. Default to hearing the arrangement; click off.
  let synth = $state(true);
  let click = $state(false);
  let countIn = $state(true); // one-bar count-in before play (local pref, FR-6)
  // Volume level is a personal, per-device preference (localStorage, like the chord
  // overlay below) so it's dialed in once, not reset every song. 100% is alphaTab's
  // own "1 = full" gain — no artificial boost. (An earlier version defaulted to 300%
  // to compensate the old sonivox soundfont's thin solo violin; the warmer Florestan
  // strings font doesn't need it, and the boost just made the default loud.) Headroom
  // to 150% stays available for any future instrument that does need a lift.
  const savedVolume = loadVolumePrefs();
  let synthVolumePct = $state(savedVolume.synth ?? 100);
  let clickVolumePct = $state(savedVolume.click ?? 100);
  let showMore = $state(false); // the settings sheet (opened by the ☰ / key / tempo)
  let composer = $state(''); // score credit, for the masthead
  let showMasthead = $state(loadMastheadPref()); // local viewing pref, persisted
  let errorMsg = $state<string | null>(null);

  // Lyrics/notes slide-over: personal + local, never synced. Open state is ephemeral.
  // The fetched sheet is cached per song; App.svelte remounts this view via {#key song.id},
  // so these reset on a song switch — no in-component reset needed.
  let lyricsOpen = $state(false);
  let lyricsSheet = $state<SongSheet | null>(null);
  let lyricsLoading = $state(false);
  let lyricsError = $state<string | null>(null);

  // Chord overlay: a personal, per-device preference (localStorage) — deliberately NOT
  // per-song or session/band state. On by default (it's the point of the app); charts
  // (fretboard diagrams) off by default — most players read the chord name alone.
  const savedOverlay = loadOverlayPrefs();
  let overlayOn = $state<boolean>(savedOverlay.on ?? true);
  let showCharts = $state<boolean>(savedOverlay.charts ?? false);
  let chartInstrument = $state<Instrument>(savedOverlay.instrument === 'ukulele' ? 'ukulele' : 'guitar');
  let chordTimeline = $state<ChordOnset[]>([]);
  let barProgress = $state(0); // 0..1 within the current bar, for the beat-progress track
  let beatsPerBar = $state(4);
  let timeSig = $state('4/4');

  // Masthead visibility is a local viewing preference (not song/session state).
  // Default hidden — the topbar already shows the title; the masthead is opt-in polish.
  function loadMastheadPref(): boolean {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem('bandaid.showMasthead') === '1';
    } catch {
      return false;
    }
  }
  function toggleMasthead() {
    showMasthead = !showMasthead;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('bandaid.showMasthead', showMasthead ? '1' : '0');
      }
    } catch {
      /* ignore */
    }
  }
  const openSettings = () => (showMore = true);

  // Chord-overlay prefs are personal/per-device (localStorage), never per-song or synced
  // to the band session — one player's chart view shouldn't be forced on everyone.
  function loadOverlayPrefs(): { on?: boolean; charts?: boolean; instrument?: string } {
    try {
      if (typeof localStorage === 'undefined') return {};
      return JSON.parse(localStorage.getItem('bandaid.chordOverlay') ?? '{}');
    } catch {
      return {};
    }
  }
  $effect(() => {
    const prefs = { on: overlayOn, charts: showCharts, instrument: chartInstrument };
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('bandaid.chordOverlay', JSON.stringify(prefs));
      }
    } catch {
      /* ignore */
    }
  });

  // Volume level is a personal, per-device preference — same rationale as the chord
  // overlay above.
  function loadVolumePrefs(): { synth?: number; click?: number } {
    try {
      if (typeof localStorage === 'undefined') return {};
      return JSON.parse(localStorage.getItem('bandaid.volume') ?? '{}');
    } catch {
      return {};
    }
  }
  $effect(() => {
    const prefs = { synth: synthVolumePct, click: clickVolumePct };
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('bandaid.volume', JSON.stringify(prefs));
      }
    } catch {
      /* ignore */
    }
  });

  let stageEl: HTMLElement;
  let renderScrollEl = $state<HTMLDivElement | undefined>(undefined); // the notation's scroller
  let renderTick = $state(0); // bumped after every completed (re-)render — bounds are fresh
  // One-shot waiters for the next completed render (fit-to-view's verification pass).
  let renderResolvers: Array<() => void> = [];
  const nextRender = () => new Promise<void>((resolve) => renderResolvers.push(resolve));
  // Matches the overlay's page-turn: JS-driven scrolling can't be reached by a CSS
  // reduced-motion rule, so honor the preference here.
  const reducedMotion =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let lastBarsPerRow = 0;
  let lastStageWidth = 0; // remembered so a late-arriving measureCount can re-pick
  let barsPerRow = $state(4); // notation bars-per-row; the overlay mirrors it 1:1

  // Responsive notation: fewer bars per row on narrow screens so notes aren't crowded.
  function barsForWidth(w: number): number {
    if (w <= 480) return 2;
    if (w <= 900) return 3;
    return 4;
  }
  // Avoid orphan rows: a song whose bar count leaves a single leftover bar (count % n
  // == 1) would end on a lone bar, so step down to a row width that doesn't — e.g. 33
  // bars at 4/row → 3/row (11 even rows). Stepping down (never up) keeps bars at least
  // as large as the width-based pick. If every candidate orphans, keep the base width;
  // the lone bar then renders at natural width (justifyLastSystem stays off), so the
  // cursor's pixel speed doesn't jump.
  function pickBarsPerRow(w: number, measures: number): number {
    const base = barsForWidth(w);
    if (measures <= 0) return base;
    for (let n = base; n >= 2; n--) if (measures % n !== 1) return n;
    return base;
  }
  function applyResponsiveLayout(w: number) {
    lastStageWidth = w;
    const bpr = pickBarsPerRow(w, measureCount);
    barsPerRow = bpr; // keep the overlay's row count in step with the notation
    if (bpr === lastBarsPerRow || !controller) return;
    lastBarsPerRow = bpr;
    controller.setBarsPerRow(bpr);
  }

  onMount(() => {
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? stageEl.clientWidth;
      applyResponsiveLayout(w);
    });
    if (stageEl) ro.observe(stageEl);
    return () => ro.disconnect();
  });

  // Tempo/key are shared session state (band-synced): a bandmate's change lands in the
  // doc immediately, but nothing re-renders this view unless we react to it here — the
  // initial read in onReady only covers this device's own load. This uses the dedicated
  // songSettings channel, not the generic subscribe() — that one also fires for plain
  // transport stamps (e.g. this same setTempoPercent's own restamp), which can fire
  // before the songSettings write lands and would read a stale value as authoritative.
  onMount(() =>
    store.subscribeSongSettings((settings) => {
      const saved = settings[song.id] ?? {};
      const nextSpeedPct = saved.tempoPct !== undefined ? Math.round(saved.tempoPct * 100) : 100;
      if (nextSpeedPct !== speedPct) {
        speedPct = nextSpeedPct;
        transport?.setTempoPercent(speedPct / 100);
      }
      const nextTranspose = saved.transpose ?? 0;
      if (nextTranspose !== transpose) {
        transpose = nextTranspose;
        controller?.setTranspose(transpose);
      }
    }),
  );

  // Beat clock for the overlay's progress track: reuse projectBar (alphaTab is the live
  // clock, this just reconciles "now" to a fractional bar). Only runs while the overlay
  // is visible; the integer bar still comes from alphaTab via onposition.
  $effect(() => {
    if (!overlayOn) return;
    const qpb = quarterNotesPerBar(timeSig);
    let raf = 0;
    const tick = () => {
      if (transport && playing) {
        const projected = projectBar(transport.getTransport(), Date.now(), qpb);
        // Measure the fill against alphaTab's authoritative bar, not projected's own floor.
        // Saturating at 1 holds the current bar full while we wait for the cursor to cross
        // into the next bar, instead of wrapping to 0 a frame early (the bar appearing to
        // snap back to empty just before the highlight advances).
        barProgress = Math.min(1, Math.max(0, projected - bar));
      } else {
        barProgress = 0;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  // Paged auto-turn: keep the cursor's row inside the visible page. The bottom PEEK_PX
  // stays reserved as a preview strip — the next row shows there partially, and when the
  // cursor reaches it the page turns with that row snapping to the top. So the row being
  // played carries across the turn (continuity) and a full page of upcoming music lands
  // below it (lookahead). Runs on bar changes and after re-renders (renderTick) only —
  // never on manual scrolling, so browsing a paused score is left alone.
  const PEEK_PX = 64;
  $effect(() => {
    void renderTick; // re-run after scale/bars-per-row re-renders move the rows
    const scroller = renderScrollEl;
    if (!scroller || !controller) return;
    const bounds = controller.getBarBounds(bar);
    if (!bounds) return;
    const viewTop = scroller.scrollTop;
    const viewH = scroller.clientHeight;
    if (scroller.scrollHeight <= viewH) return; // whole song fits: nothing to page
    // Row above the view (seek/return-to-start) or entering the bottom peek strip:
    // snap its top to the top of a fresh page.
    if (bounds.top < viewTop || bounds.bottom > viewTop + viewH - PEEK_PX) {
      scroller.scrollTo({
        top: Math.max(0, bounds.top - 4),
        behavior: reducedMotion ? 'auto' : 'smooth',
      });
    }
  });

  // Follow the band's transport (playback sync). Wired once the player can actually
  // play (onreadyforplayback) — applying a play stamp before the soundfont is loaded
  // would be dropped by alphaTab. One follower per loaded song; subscribing delivers
  // the current doc stamp immediately, so a device that opens mid-tune joins in.
  //
  // Called from both onReady (which creates `transport`) and the onplayable handler
  // (which sets `canPlay`): alphaTab gives no ordering guarantee between "score loaded"
  // and "player ready for playback" — on a real device, MusicXML fetch latency can let
  // onplayable fire first. Guarding on both and calling from both call sites means
  // whichever of the two fires second completes the wiring, instead of onplayable
  // silently finding `transport` still undefined and never being retried (the actual
  // real-device bug: playback sync working perfectly in every headless/local test but
  // never firing at all on a real phone/tablet).
  let unsubFollower: (() => void) | undefined;
  function wireFollower() {
    if (unsubFollower || !transport || !canPlay) return;
    const follower = createTransportFollower({
      songId: song.id,
      authorId: store.getIdentity().authorId,
      // Follow only while band sync is on: at boot the doc still holds the previous
      // session's stamps (IndexedDB persistence), and a local-only device must not
      // have its playhead yanked by them.
      enabled: () => sync.on,
      apply: (stamp) => transport!.applyRemote(stamp),
      skewLog,
    });
    unsubFollower = store.subscribeSessionTransport((stamp) => follower.receive(stamp));
  }
  onDestroy(() => {
    unsubFollower?.();
    transport?.dispose(); // cancel a pending scheduled remote start
  });

  function onReady(c: RendererController, t: TrackInfo[]) {
    controller = c;
    tracks = t;
    if (t.length && !t.some((x) => x.index === melodyIndex)) melodyIndex = t[0].index;
    renderSelection();

    const info = c.getSongInfo();
    tempoBpm = info?.tempoBpm ?? 120;
    measureCount = info?.measureCount ?? 1;
    // Re-pick bars-per-row now the bar count is known (orphan avoidance needs it) —
    // the ResizeObserver only re-fires on actual size changes.
    if (lastStageWidth > 0) applyResponsiveLayout(lastStageWidth);
    c.onRender(() => {
      renderTick++;
      renderResolvers.splice(0).forEach((resolve) => resolve());
    });
    // Masthead credit: the curated manifest composer wins; fall back to the score's
    // credit unless it's an export toolchain stamping its own name (e.g. Music21).
    const scoreCredit = info?.composer ?? '';
    composer = song.composer ?? (/^music21$/i.test(scoreCredit.trim()) ? '' : scoreCredit);
    chordTimeline = c.getChordTimeline();
    timeSig = info?.timeSignature ?? '4/4';
    beatsPerBar = Number(timeSig.split('/')[0]) || 4;
    transport = createLocalTransport({
      songId: song.id,
      defaultTempoBpm: tempoBpm,
      measureCount,
      quarterNotesPerBar: quarterNotesPerBar(timeSig),
      renderer: c,
      store,
    });
    // In case onplayable already fired before the score (and thus `transport`) was
    // ready — see the wireFollower comment for why both call sites are needed.
    wireFollower();
    // Apply this song's saved performance overrides (tempo, key); absent = canonical default.
    const saved = store.getSongSettings(song.id);
    speedPct = saved.tempoPct !== undefined ? Math.round(saved.tempoPct * 100) : 100;
    transport.setTempoPercent(speedPct / 100);
    transpose = saved.transpose ?? 0;
    if (transpose !== 0) c.setTranspose(transpose);
    applyAudio();
    // Apply the responsive bars-per-row for the current width on first render.
    lastBarsPerRow = 0;
    if (stageEl) applyResponsiveLayout(stageEl.clientWidth);
  }

  // Melody alone, or melody + the player's part stacked (one player → synced cursors).
  function renderSelection() {
    if (!controller) return;
    if (myPart === null || myPart === melodyIndex) controller.renderTracks([melodyIndex]);
    else controller.renderTracks([melodyIndex, myPart]);
  }

  function selectMyPart(index: number | null) {
    myPart = index;
    renderSelection();
  }

  function applyAudio() {
    controller?.setMasterVolume(synth ? synthVolumePct / 100 : 0);
    controller?.setMetronomeVolume(click ? clickVolumePct / 100 : 0);
  }
  function toggleSynth() {
    synth = !synth;
    controller?.setMasterVolume(synth ? synthVolumePct / 100 : 0);
  }
  function toggleClick() {
    click = !click;
    controller?.setMetronomeVolume(click ? clickVolumePct / 100 : 0);
  }
  function toggleCountIn() {
    countIn = !countIn;
    transport?.setCountIn(countIn);
  }
  function onSynthVolume(e: Event) {
    synthVolumePct = Number((e.target as HTMLInputElement).value);
    if (synth) controller?.setMasterVolume(synthVolumePct / 100);
  }
  function onClickVolume(e: Event) {
    clickVolumePct = Number((e.target as HTMLInputElement).value);
    if (click) controller?.setMetronomeVolume(clickVolumePct / 100);
  }

  // Keyboard flow for the slide-over: focus lands on its close button when it opens
  // (the action below) and returns to the opener when it closes.
  let lyricsReturnFocus: HTMLElement | null = null;
  const focusOnMount = (el: HTMLElement) => el.focus();

  async function openLyrics() {
    lyricsReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lyricsOpen = true;
    // The note renders immediately from the manifest; only lyrics need a fetch, and only once.
    if (!song.lyricsUrl || lyricsSheet || lyricsLoading) return;
    lyricsLoading = true;
    lyricsError = null;
    try {
      const res = await fetch(song.lyricsUrl);
      if (!res.ok) throw new Error(`Failed to load lyrics: ${res.status}`);
      lyricsSheet = parseChordPro(await res.text());
    } catch (e) {
      lyricsError = e instanceof Error ? e.message : String(e);
    } finally {
      lyricsLoading = false;
    }
  }
  const closeLyrics = () => {
    lyricsOpen = false;
    lyricsReturnFocus?.focus();
  };

  function togglePlay() {
    if (!transport) return;
    if (playing) transport.pause();
    else transport.play();
  }

  function onSpeed(e: Event) {
    speedPct = Number((e.target as HTMLInputElement).value);
    transport?.setTempoPercent(speedPct / 100);
    // Persist as a per-song override (shared session state); 100% = default, so clear it.
    if (speedPct === 100) store.resetSongSetting(song.id, 'tempoPct');
    else store.setSongSetting(song.id, { tempoPct: speedPct / 100 });
  }
  // Reset tempo to the song's canonical default (clears the override).
  function resetTempo() {
    speedPct = 100;
    transport?.setTempoPercent(1);
    store.resetSongSetting(song.id, 'tempoPct');
  }
  // True when tempo differs from the canonical default (drives the modified dot + reset).
  let tempoModified = $derived(speedPct !== 100);
  // The slider's ceiling: matches what the transport will actually allow for this
  // song's written tempo (see maxTempoPercent — an absolute BPM cap, not a flat
  // percentage), rounded down to the slider's step so every value is reachable.
  let maxSpeedPct = $derived(Math.max(100, Math.floor((maxTempoPercent(tempoBpm) * 100) / 5) * 5));

  // Key / transpose. Clamped to ±6 semitones (a tritone either way covers any key).
  function stepTranspose(delta: number) {
    transpose = Math.max(-6, Math.min(6, transpose + delta));
    controller?.setTranspose(transpose);
    if (transpose === 0) store.resetSongSetting(song.id, 'transpose');
    else store.setSongSetting(song.id, { transpose });
  }
  function resetTranspose() {
    transpose = 0;
    controller?.setTranspose(0);
    store.resetSongSetting(song.id, 'transpose');
  }
  let transposeModified = $derived(transpose !== 0);
  // Spell transposed labels for the *target* key: flat keys read in flats (G +3 → B♭, not A♯).
  let flats = $derived(prefersFlats(song.key?.fifths ?? 0, transpose));
  // Chord labels follow the key everywhere they're shown: the overlay timeline and the
  // lyrics sheet transpose here (the sheet-music symbols transpose inside the renderer).
  let displayTimeline = $derived(
    transpose === 0
      ? chordTimeline
      : chordTimeline.map((o) => ({
          ...o,
          label: transposeChordLabel(o.label, transpose, flats),
          root: transposeNote(o.root, transpose, flats),
        })),
  );
  let displaySheet = $derived(lyricsSheet && transposeSheet(lyricsSheet, transpose, flats));
  // The sounding tonic after transposition (header pill); falls back to a semitone count.
  let keyName = $derived.by(() => {
    const tc = song.key?.tonalCenter?.replace('♯', '#').replace('♭', 'b');
    if (tc === undefined) return transpose === 0 ? '—' : `${transpose > 0 ? '+' : ''}${transpose}`;
    return transposeNote(tc, transpose, flats).replace('#', '♯').replace('b', '♭');
  });
  // With the mode, for the settings stepper readout.
  let keyLabel = $derived(song.key?.mode ? `${keyName} ${song.key.mode}` : keyName);
  // Current sounding tempo (BPM = the ♩ = N your charts show).
  let currentBpm = $derived(Math.round((tempoBpm * speedPct) / 100));
  function onScale(e: Event) {
    scalePct = Number((e.target as HTMLInputElement).value);
    controller?.setScale(scalePct / 100);
  }
  // Fit the whole tune in the viewport. Two knobs: scale, and bars-per-row up to 6 (the
  // widest the band's paper charts use) — wider rows mean fewer rows, letting a short
  // tune trade bar width for a single-page fit. Estimate each candidate layout's height
  // from the current render's row height, take the one that fits at the largest scale
  // (min 75% for legibility — below that the tune stays multi-page and the paged
  // auto-turn covers it), then verify against the real render and trim if the estimate
  // ran long. Closes the settings sheet first: inline (wide-screen) it eats stage
  // height, and fitting to the reduced viewport would undersize the tune.
  async function fitToView() {
    showMore = false;
    await tick(); // let the sheet leave the layout before measuring
    const scroller = renderScrollEl;
    if (!scroller || !controller || measureCount <= 0) return;
    const contentH = scroller.scrollHeight;
    const viewH = scroller.clientHeight;
    if (contentH <= 0 || viewH <= 0) return;
    const rowH = contentH / Math.ceil(measureCount / barsPerRow); // at the current scale
    const base = pickBarsPerRow(lastStageWidth || stageEl?.clientWidth || 0, measureCount);
    let bestN = barsPerRow;
    let bestS = 75;
    for (let n = base; n <= 6; n++) {
      if (measureCount > n && measureCount % n === 1) continue; // no orphan rows
      const rows = Math.ceil(measureCount / n);
      const s = Math.min(225, Math.floor(((viewH / (rows * rowH)) * scalePct) / 5) * 5);
      if (s > bestS) {
        bestN = n;
        bestS = s;
      }
    }
    while (bestN !== barsPerRow || bestS !== scalePct) {
      barsPerRow = bestN; // the overlay mirrors the notation 1:1
      lastBarsPerRow = bestN;
      scalePct = bestS;
      const rendered = nextRender();
      controller.setLayout(bestN, bestS / 100);
      await rendered;
      // Estimate ran long (row heights shift with density): trim a step and re-verify.
      if (scroller.scrollHeight <= scroller.clientHeight || bestS <= 75) break;
      bestS = Math.max(75, bestS - 5);
    }
  }
  // Return to the top of the tune (a synced seek: the band jumps with you).
  function returnToStart() {
    setBar(1);
    transport?.seekToBar(1);
  }
  // Track the cursor bar and surface playback progress (0–1) for the song picker.
  function setBar(b: number) {
    bar = b;
    onprogress?.(measureCount > 1 ? Math.min(1, Math.max(0, (b - 1) / (measureCount - 1))) : 0);
  }

  // Spacebar toggles play/pause on laptop; Escape closes the topmost overlay.
  // Ignore Space when focused in a control.
  function onKeydown(e: KeyboardEvent) {
    if (e.code === 'Escape') {
      if (lyricsOpen) closeLyrics();
      else if (showMore) showMore = false;
      return;
    }
    if (e.code !== 'Space') return;
    const el = e.target as HTMLElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON')) return;
    e.preventDefault();
    if (canPlay) togglePlay();
  }

  // The parts a player can overlay as "their part" — everything but the shared melody.
  let overlayParts = $derived(tracks.filter((t) => t.index !== melodyIndex));
</script>

<svelte:window onkeydown={onKeydown} />

<!-- Top header: navigation and meta only — songs on the far left, the title, then
     info and the menu on the far right. Nothing here touches band state. -->
<header class="topbar">
  <button class="iconbtn" onclick={() => onsongs?.()} aria-label="Songs">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <circle cx="4" cy="6" r="1.3" fill="currentColor" stroke="none" /><line x1="9" y1="6" x2="20" y2="6" />
      <circle cx="4" cy="12" r="1.3" fill="currentColor" stroke="none" /><line x1="9" y1="12" x2="20" y2="12" />
      <circle cx="4" cy="18" r="1.3" fill="currentColor" stroke="none" /><line x1="9" y1="18" x2="20" y2="18" />
    </svg>
  </button>
  <h1 class="song">{song.title}</h1>
  {#if song.notes || song.lyricsUrl}
    <button class="iconbtn" onclick={openLyrics} aria-label="Notes and lyrics" title="Notes &amp; lyrics">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16" /><circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none" />
      </svg>
    </button>
  {/if}
  <button class="iconbtn" class:active={showMore} onclick={() => (showMore = !showMore)} aria-label="Settings" aria-expanded={showMore}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  </button>
</header>

<!-- The synced strip: everything band-synced lives together here — play/pause,
     return to start, key, tempo. What a bandmate changes, changes here. -->
<div class="transport">
  <button class="play" onclick={togglePlay} disabled={!transport || !canPlay} aria-label={!canPlay ? 'Loading' : playing ? 'Pause' : 'Play'}>
    <Icon name={!canPlay ? 'loading' : playing ? 'pause' : 'play'} size={20} />
  </button>
  <button class="play" onclick={returnToStart} disabled={!transport} aria-label="Return to start" title="Return to start">
    <Icon name="start" size={20} />
  </button>

  {#if !canPlay}
    <!-- The soundfont + MIDI take a few seconds on first load; say so instead of
         leaving a mysteriously disabled Play button. -->
    <span class="loading-note" role="status">Loading audio…</span>
  {/if}

  <span class="spacer"></span>

  <button class="pill" class:on={transposeModified} onclick={openSettings} disabled={!controller} title="Key">
    <span class="lbl">Key</span> {keyName}{#if transposeModified}<span class="dot">●</span>{/if}
  </button>
  <button class="pill" class:on={tempoModified} onclick={openSettings} disabled={!transport} title="Tempo">
    ♩ = {currentBpm}{#if tempoModified}<span class="dot">●</span>{/if}
  </button>
</div>

<!-- Settings sheet (opened by the ☰, or the Key / Tempo pills). Inline on wide
     screens; a bottom sheet over a scrim on phones so the music stays visible. -->
{#if showMore}
  <button class="sheet-scrim" onclick={() => (showMore = false)} aria-label="Close settings"></button>
  <div class="sheet">
    <!-- Band sync: the app starts local; turning this on is the intentional step that
         joins the band room named below. -->
    <div class="row">
      <span class="label">Sync</span>
      <div class="chips">
        <button class:active={sync.on} aria-pressed={sync.on} onclick={sync.toggle}>{sync.on ? 'On' : 'Off'}</button>
      </div>
      <SyncBadge summary={sync.summary} />
    </div>

    <label class="row">
      <span class="label">Band</span>
      <input
        class="band"
        type="text"
        value={sync.bandName}
        onchange={(e) => sync.setBandName((e.target as HTMLInputElement).value)}
        placeholder="soundcheck"
        autocapitalize="off"
        autocomplete="off"
        spellcheck="false"
        aria-label="Band name"
      />
    </label>

    <div class="row">
      <span class="label">Title</span>
      <div class="chips">
        <button class:active={showMasthead} aria-pressed={showMasthead} onclick={toggleMasthead}>{showMasthead ? 'Shown' : 'Hidden'}</button>
      </div>
    </div>

    <label class="row">
      <span class="label">Tempo{#if tempoModified}<span class="dot" title="Changed from default">●</span>{/if}</span>
      <input type="range" min="50" max={maxSpeedPct} step="5" value={speedPct} oninput={onSpeed} disabled={!transport} aria-valuetext={`${speedPct}% of original, ${currentBpm} beats per minute`} />
      <span class="readout">{speedPct}% · {Math.round((tempoBpm * speedPct) / 100)} bpm</span>
      <button class="reset" onclick={resetTempo} disabled={!transport || !tempoModified} title="Reset to original tempo" aria-label="Reset to original tempo"><Icon name="reset" size={16} /></button>
    </label>

    <div class="row">
      <span class="label">Key{#if transposeModified}<span class="dot" title="Changed from default">●</span>{/if}</span>
      <div class="stepper">
        <button onclick={() => stepTranspose(-1)} disabled={!controller || transpose <= -6} aria-label="Down a semitone">−</button>
        <span class="readout key">{keyLabel}{#if transposeModified}<span class="st"> ({transpose > 0 ? '+' : ''}{transpose} st)</span>{/if}</span>
        <button onclick={() => stepTranspose(1)} disabled={!controller || transpose >= 6} aria-label="Up a semitone">+</button>
      </div>
      <button class="reset" onclick={resetTranspose} disabled={!controller || !transposeModified} title="Reset to original key" aria-label="Reset to original key"><Icon name="reset" size={16} /></button>
    </div>

    <div class="row">
      <span class="label">Size</span>
      <input type="range" min="75" max="225" step="25" value={scalePct} oninput={onScale} disabled={!controller} aria-label="Notation size" aria-valuetext={`${scalePct}%`} />
      <span class="readout">{scalePct}%</span>
      <button class="fitbtn" onclick={fitToView} disabled={!controller} title="Size the whole tune to fill the view">Fit</button>
    </div>

    <div class="row">
      <span class="label">Audio</span>
      <div class="chips">
        <button class:active={synth} aria-pressed={synth} onclick={toggleSynth} disabled={!controller}><Icon name="sound" size={16} /> Sound</button>
        <button class:active={click} aria-pressed={click} onclick={toggleClick} disabled={!controller}><Icon name="click" size={16} /> Click</button>
        <button class:active={countIn} aria-pressed={countIn} onclick={toggleCountIn} disabled={!transport}><Icon name="countin" size={16} /> Count-in</button>
      </div>
    </div>

    <label class="row">
      <span class="label">Sound</span>
      <input type="range" min="0" max="150" step="5" value={synthVolumePct} oninput={onSynthVolume} disabled={!controller || !synth} aria-valuetext={`${synthVolumePct}%`} />
      <span class="readout">{synthVolumePct}%</span>
    </label>

    <label class="row">
      <span class="label">Click</span>
      <input type="range" min="0" max="150" step="5" value={clickVolumePct} oninput={onClickVolume} disabled={!controller || !click} aria-valuetext={`${clickVolumePct}%`} />
      <span class="readout">{clickVolumePct}%</span>
    </label>

    <!-- Only offer "My part" when the chart actually has another part to stack —
         a lone pre-selected "Melody only" chip is dead UI on single-track songs. -->
    {#if overlayParts.length > 0}
      <div class="row">
        <span class="label">My part</span>
        <div class="chips">
          <button class:active={myPart === null} aria-pressed={myPart === null} onclick={() => selectMyPart(null)}>Melody only</button>
          {#each overlayParts as t}
            <button class:active={t.index === myPart} aria-pressed={t.index === myPart} onclick={() => selectMyPart(t.index)}>{t.name}</button>
          {/each}
        </div>
      </div>
    {/if}

    <div class="row">
      <span class="label">Chords</span>
      <div class="chips">
        <button class:active={overlayOn} aria-pressed={overlayOn} onclick={() => (overlayOn = !overlayOn)}>
          <Icon name="chords" size={16} /> Overlay
        </button>
        <button class:active={showCharts} aria-pressed={showCharts} onclick={() => (showCharts = !showCharts)} disabled={!overlayOn}>Charts</button>
        {#if overlayOn && showCharts}
          <button class:active={chartInstrument === 'guitar'} aria-pressed={chartInstrument === 'guitar'} onclick={() => (chartInstrument = 'guitar')}>Guitar</button>
          <button class:active={chartInstrument === 'ukulele'} aria-pressed={chartInstrument === 'ukulele'} onclick={() => (chartInstrument = 'ukulele')}>Uke</button>
        {/if}
      </div>
    </div>

    <!-- Glance-checkable build identity: confirms a device actually picked up the
         latest deploy instead of a stale cached bundle. -->
    <div class="row">
      <span class="label">Version</span>
      <span class="readout">{__COMMIT_SHA__}</span>
    </div>
  </div>
{/if}

{#if errorMsg}
  <div class="error">Renderer error: {errorMsg}</div>
{/if}

<main class="stage" bind:this={stageEl}>
  {#if showMasthead}
    <!-- Our own deduped masthead (alphaTab's title block is suppressed): the crucial
         fields only — title, and composer when present. Key/tempo live in the header. -->
    <div class="masthead">
      <div class="mh-title">{song.title}</div>
      {#if composer}<div class="mh-sub">{composer}</div>{/if}
    </div>
  {/if}
  <div class="render-wrap">
    <Renderer
      musicXmlUrl={song.url}
      bind:scrollEl={renderScrollEl}
      onready={onReady}
      onposition={(b) => setBar(b)}
      onplaying={(p) => (playing = p)}
      onplayable={() => {
        canPlay = true;
        applyAudio(); // re-assert volumes now the synth is ready (not just at score load)
        wireFollower();
      }}
      onerror={(e) => (errorMsg = e.message)}
    />
  </div>
</main>

{#if overlayOn}
  <ChordOverlay
    timeline={displayTimeline}
    currentBar={bar}
    {barProgress}
    {beatsPerBar}
    {barsPerRow}
    {measureCount}
    instrument={chartInstrument}
    {showCharts}
  />
{/if}

{#if lyricsOpen}
  <button class="scrim" onclick={closeLyrics} aria-label="Close lyrics"></button>
  <div class="lyrics-panel" role="dialog" aria-modal="true" aria-label="Notes and lyrics">
    <header class="lyrics-head">
      <h2 class="lyrics-title">{song.title}</h2>
      <button class="iconbtn" use:focusOnMount onclick={closeLyrics} aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
      </button>
    </header>
    <div class="lyrics-body">
      {#if lyricsError}
        <p class="lyrics-msg">{lyricsError}</p>
      {:else if lyricsLoading && !lyricsSheet}
        <p class="lyrics-msg">Loading…</p>
      {:else}
        <LyricsSheet note={song.notes} sheet={displaySheet ?? undefined} />
      {/if}
    </div>
  </div>
{/if}

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.5rem 0.7rem;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  .iconbtn {
    flex: 0 0 auto;
    width: 2.1rem;
    height: 2.1rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .iconbtn.active { border-color: var(--accent); color: var(--accent); }
  /* Small, subtle song name — takes the slack so the pills/buttons stay put.
     Semantically the page's h1 (screen-reader structure); visually unchanged. */
  .song {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    color: var(--muted);
    font-family: var(--font-display);
    font-size: 0.88rem;
    font-weight: 400;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pill {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.32rem 0.5rem;
    font-size: 0.82rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .pill.on { border-color: var(--accent); }
  .pill .lbl { color: var(--muted); font-size: 0.72rem; }
  .pill .dot { color: var(--accent); font-size: 0.5rem; }

  .transport {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.45rem 0.9rem;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  .transport .play {
    flex: 0 0 auto;
    min-width: 2.6rem;
    min-height: 2.4rem; /* comfortable tap target on mobile */
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .spacer { flex: 1 1 auto; }
  .readout { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 0.85rem; flex: 0 0 auto; }
  .loading-note { color: var(--muted); font-size: 0.82rem; flex: 0 0 auto; white-space: nowrap; }

  /* The overflow sheet stacks its rows vertically so each control gets full width. */
  .sheet {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.7rem 1rem;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  .sheet .row { display: flex; align-items: center; gap: 0.6rem; }
  .sheet .row .label { flex: 0 0 4.5rem; color: var(--muted); font-size: 0.85rem; }
  .dot { color: var(--accent); font-size: 0.6rem; vertical-align: middle; margin-left: 0.25rem; }
  .reset {
    flex: 0 0 auto;
    min-width: 2rem;
    min-height: 2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .reset:disabled { opacity: 0.3; }
  .stepper { display: inline-flex; align-items: center; gap: 0.5rem; flex: 1 1 auto; }
  .stepper button { min-width: 2.2rem; min-height: 2.2rem; font-size: 1.1rem; line-height: 1; }
  .readout.key { min-width: 5rem; }
  .st { color: var(--muted); }
  .sheet .row input[type='range'] { flex: 1 1 auto; min-width: 0; }
  .sheet .row input.band {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0.4rem 0.6rem;
    font-size: 0.9rem;
    background: var(--bg);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  .sheet .row input.band:focus { border-color: var(--accent); outline: none; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .chips button {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.4rem 0.7rem;
    font-size: 0.85rem;
    min-height: 2.2rem;
  }
  .chips button.active { border-color: var(--accent); color: var(--accent); }
  .fitbtn { flex: 0 0 auto; padding: 0.4rem 0.7rem; font-size: 0.85rem; min-height: 2.2rem; }

  /* Touch screens get full-size (≥44px) targets on the controls tapped mid-practice;
     pointer precision keeps the compact sizes on desktop. */
  @media (pointer: coarse) {
    .iconbtn { width: 2.75rem; height: 2.75rem; }
    .pill { min-height: 2.75rem; }
    .stepper button,
    .chips button,
    .fitbtn,
    .reset { min-width: 2.75rem; min-height: 2.75rem; }
  }

  /* On phones the settings become a bottom sheet over a scrim, so adjusting tempo/key
     doesn't shove the notation off-screen. Above alphaTab's cursors (z-index 1000). */
  .sheet-scrim { display: none; }
  @media (max-width: 480px) {
    .sheet-scrim {
      display: block;
      position: fixed;
      inset: 0;
      border: none;
      border-radius: 0;
      padding: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 1003;
    }
    .sheet {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 1004;
      max-height: 60dvh;
      overflow-y: auto;
      border-top: 1px solid var(--line);
      border-radius: 14px 14px 0 0;
      box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.45);
      padding-bottom: calc(0.9rem + env(safe-area-inset-bottom));
    }
  }

  .error {
    padding: 0.5rem 1rem;
    background: #3a1d1d;
    color: #f1b4b4;
    font-size: 0.85rem;
  }

  .stage { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .render-wrap { flex: 1 1 auto; min-height: 0; }

  /* Minimal chart masthead above the music (alphaTab's own title is suppressed). */
  .masthead {
    flex: 0 0 auto;
    text-align: center;
    background: #faf7f2;
    color: #14110f;
    padding: 0.7rem 1rem 0.55rem;
    border-bottom: 1px solid #e7e0d5;
  }
  .mh-title {
    font-family: Georgia, 'Times New Roman', serif;
    font-weight: 700;
    font-size: 1.15rem;
    line-height: 1.15;
  }
  .mh-sub { color: #6b6258; font-size: 0.78rem; margin-top: 0.15rem; }

  .scrim {
    position: fixed;
    inset: 0;
    border: none;
    padding: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 1001;
  }
  .lyrics-panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(92%, 30rem);
    z-index: 1002;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    box-shadow: -2px 0 16px rgba(0, 0, 0, 0.4);
    animation: lyrics-in 0.16s ease-out;
  }
  @keyframes lyrics-in {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }
  .lyrics-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.7rem 0.9rem;
    border-bottom: 1px solid var(--line);
    color: var(--ink);
  }
  .lyrics-title { margin: 0; font-family: var(--font-display); font-size: 1.05rem; font-weight: 600; }
  .lyrics-body {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 1rem 1rem 2rem;
  }
  .lyrics-msg {
    color: var(--muted);
  }
</style>
