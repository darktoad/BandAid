# Corrections Sync Substrate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Yjs CRDT document per band room, with layered convergent transports, that carries song "corrections" durably across devices and exposes the existing `SessionStore` seam — plus the headless pull/resolve scripts that feed a Claude session editing the MusicXML.

**Architecture:** One `Y.Doc` per band code holds `corrections` / `songSettings` / `session` maps. Transport *providers* (local `y-indexeddb`, durable PartyKit, optional `y-webrtc`, plus export/import) all bind to that one doc and converge because it is a CRDT. `createSyncedSessionStore()` implements today's `SessionStore` interface over the doc so app consumers are unchanged; it degrades to local-only with no band code.

**Tech Stack:** Svelte 5 (runes) + Vite 6 + TypeScript 5.7 (strict) + Vitest. Yjs (`yjs`, `y-indexeddb`, `y-webrtc`, `y-partykit`), PartyKit server (Cloudflare). Static SPA on GitHub Pages; the only server-side piece is the external PartyKit party.

## Global Constraints

- Tests run in **Node with no jsdom** — pure logic must not touch DOM/`localStorage`/`IndexedDB`/`WebRTC` directly; those go behind injectable seams (mirror `localTransport`'s injected `now`). Verbatim test command: `npm test` (alias for `vitest run`); type-check: `npm run check`.
- Preserve the existing `SessionStore` interface in `src/session/types.ts` — `createSyncedSessionStore` must satisfy it unchanged ("no M1 code is thrown away").
- Bars are **1-based** (alphaTab master-bar index + 1, MusicXML `<measure>` document order).
- Identity has **no accounts**; the per-device display name is **editable at any time**; `authorId` is a stable persisted UUID.
- Presence display ("who's online") is **deferred** — wire only what authorship needs.
- localStorage key conventions follow existing `bandaid.*` (e.g. `bandaid.songSettings.v1`, new `bandaid.identity.v1`).
- Use `crypto.randomUUID()` for ids (no `uuid` dependency). Make id/time injectable in pure factories for deterministic tests.
- Spec: `docs/superpowers/specs/2026-06-29-corrections-sync-substrate-design.md`.

---

## File Structure

- `src/sync/types.ts` — `Correction`, `CorrectionAnchor`, `Identity`, `InboxFile`, `SyncProvider`, `SyncedSessionStore` (extends `SessionStore`).
- `src/sync/corrections.ts` — pure helpers: `makeCorrection`, `isStale`, `openForSong`, `serializeInbox`.
- `src/sync/identity.ts` — `loadIdentity`, `setDisplayName` over an injectable `Storage`.
- `src/sync/doc.ts` — `createBandDoc`, corrections/songSettings accessors, `migrateSongSettings`, `exportUpdate`/`importUpdate`.
- `src/sync/providers/types.ts` — `SyncProvider` contract + `makeProviders` factory inputs.
- `src/sync/providers/{indexeddb,partykit,webrtc}.ts` — thin wrappers (browser-only).
- `src/sync/syncedSessionStore.ts` — `createSyncedSessionStore` implementing `SessionStore` + corrections/identity over the doc.
- `src/session/store.ts` — unchanged (kept as the no-band local fallback).
- `src/App.svelte` — read band code (`?band=` / localStorage), construct the synced store, fall back to local.
- `party/corrections.ts`, `partykit.json` — the PartyKit server (deploy is a manual step).
- `scripts/corrections-pull.ts`, `scripts/corrections-resolve.ts` — headless Node tooling.
- `package.json` — new deps + `corrections:pull` / `corrections:resolve` scripts.

---

## Task 1: Correction model + pure helpers

**Files:**
- Create: `src/sync/types.ts`
- Create: `src/sync/corrections.ts`
- Test: `src/sync/corrections.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `type CorrectionAnchor = { kind: 'point'; bar: number; beat: number; voice?: number } | { kind: 'range'; startBar: number; endBar: number }`
  - `interface Correction { id: string; songId: string; anchor: CorrectionAnchor; category?: 'tie' | 'repeat' | 'wrong-note' | 'other'; text: string; author: string; authorId: string; createdAt: number; status: 'open' | 'applied' | 'dismissed'; songVersion: string }`
  - `makeCorrection(input: NewCorrection, opts?: { id?: string; now?: number }): Correction` where `NewCorrection = Omit<Correction, 'id' | 'createdAt' | 'status'>`
  - `isStale(c: Correction, currentSongVersion: string): boolean`
  - `openForSong(list: Correction[], songId: string): Correction[]`
  - `serializeInbox(list: Correction[], currentSongVersion: string): InboxFile` where `InboxFile = { generatedAt: number | null; songs: Record<string, InboxEntry[]> }` and each `InboxEntry` is the correction plus `stale: boolean`, sorted bottom-up (highest anchor bar first).

- [ ] **Step 1: Write the failing test**

```typescript
// src/sync/corrections.test.ts
import { describe, it, expect } from 'vitest';
import { makeCorrection, isStale, openForSong, serializeInbox } from './corrections';
import type { Correction } from './types';

const base = (over: Partial<Correction> = {}): Correction =>
  makeCorrection(
    {
      songId: 'stones-rag',
      anchor: { kind: 'point', bar: 5, beat: 1 },
      text: 'needs a tie',
      author: 'Fiddle',
      authorId: 'dev-1',
      songVersion: 'v1',
      ...over,
    } as any,
    { id: over.id ?? 'c1', now: over.createdAt ?? 1000 },
  );

describe('makeCorrection', () => {
  it('stamps id, createdAt, and open status', () => {
    const c = makeCorrection(
      { songId: 's', anchor: { kind: 'point', bar: 2, beat: 1 }, text: 't', author: 'A', authorId: 'd', songVersion: 'v1' },
      { id: 'abc', now: 42 },
    );
    expect(c).toMatchObject({ id: 'abc', createdAt: 42, status: 'open', songId: 's' });
  });
});

describe('isStale', () => {
  it('is stale when the song version moved on', () => {
    expect(isStale(base({ songVersion: 'v1' }), 'v2')).toBe(true);
    expect(isStale(base({ songVersion: 'v2' }), 'v2')).toBe(false);
  });
});

describe('openForSong', () => {
  it('keeps only open corrections for the song', () => {
    const list = [
      base({ id: 'a', songId: 'x', status: 'open' }),
      base({ id: 'b', songId: 'x', status: 'applied' }),
      base({ id: 'c', songId: 'y', status: 'open' }),
    ];
    expect(openForSong(list, 'x').map((c) => c.id)).toEqual(['a']);
  });
});

describe('serializeInbox', () => {
  it('groups open pins by song, marks stale, sorts bottom-up', () => {
    const list = [
      base({ id: 'lo', songId: 'x', anchor: { kind: 'point', bar: 3, beat: 1 }, songVersion: 'v1' }),
      base({ id: 'hi', songId: 'x', anchor: { kind: 'range', startBar: 9, endBar: 12 }, songVersion: 'v2' }),
    ];
    const inbox = serializeInbox(list, 'v2');
    expect(inbox.songs.x.map((e) => e.id)).toEqual(['hi', 'lo']); // bar 9 before bar 3
    expect(inbox.songs.x.find((e) => e.id === 'lo')!.stale).toBe(true);
    expect(inbox.generatedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/sync/corrections.test.ts`
Expected: FAIL — `Cannot find module './corrections'`.

- [ ] **Step 3: Write the types**

```typescript
// src/sync/types.ts
export type CorrectionAnchor =
  | { kind: 'point'; bar: number; beat: number; voice?: number }
  | { kind: 'range'; startBar: number; endBar: number };

export interface Correction {
  id: string;
  songId: string;
  anchor: CorrectionAnchor;
  category?: 'tie' | 'repeat' | 'wrong-note' | 'other';
  text: string;
  author: string; // display name at creation
  authorId: string; // stable per-device id
  createdAt: number; // epoch ms
  status: 'open' | 'applied' | 'dismissed';
  songVersion: string; // build id / sha the pin was made against
}

export type NewCorrection = Omit<Correction, 'id' | 'createdAt' | 'status'>;

export interface InboxEntry extends Correction {
  stale: boolean;
}
export interface InboxFile {
  /** Stamped by the caller after generation (kept null in pure code for determinism). */
  generatedAt: number | null;
  songs: Record<string, InboxEntry[]>;
}
```

- [ ] **Step 4: Write the helpers**

```typescript
// src/sync/corrections.ts
import type { Correction, NewCorrection, InboxFile, InboxEntry } from './types';

export function makeCorrection(
  input: NewCorrection,
  opts: { id?: string; now?: number } = {},
): Correction {
  return {
    ...input,
    id: opts.id ?? crypto.randomUUID(),
    createdAt: opts.now ?? Date.now(),
    status: 'open',
  };
}

export function isStale(c: Correction, currentSongVersion: string): boolean {
  return c.songVersion !== currentSongVersion;
}

export function openForSong(list: Correction[], songId: string): Correction[] {
  return list.filter((c) => c.songId === songId && c.status === 'open');
}

/** First bar an anchor touches — used to sort resolution work bottom-up. */
function anchorBar(c: Correction): number {
  return c.anchor.kind === 'point' ? c.anchor.bar : c.anchor.startBar;
}

export function serializeInbox(list: Correction[], currentSongVersion: string): InboxFile {
  const songs: Record<string, InboxEntry[]> = {};
  for (const c of list.filter((x) => x.status === 'open')) {
    (songs[c.songId] ??= []).push({ ...c, stale: isStale(c, currentSongVersion) });
  }
  // Bottom-up: highest bar first, so applying an edit doesn't shift lower bar numbers.
  for (const songId of Object.keys(songs)) {
    songs[songId].sort((a, b) => anchorBar(b) - anchorBar(a));
  }
  return { generatedAt: null, songs };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/sync/corrections.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/sync/types.ts src/sync/corrections.ts src/sync/corrections.test.ts
git commit -m "feat: correction model + pure helpers (make/stale/inbox)"
```

---

## Task 2: Per-device identity

**Files:**
- Create: `src/sync/identity.ts`
- Test: `src/sync/identity.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Identity { authorId: string; name: string }`
  - `loadIdentity(storage?: StorageLike, gen?: () => string): Identity` — reads/creates `bandaid.identity.v1`; mints a stable `authorId` once; default `name` is `''`.
  - `setDisplayName(name: string, storage?: StorageLike): Identity` — edits the name, keeps `authorId`.
  - `type StorageLike = Pick<Storage, 'getItem' | 'setItem'>`

- [ ] **Step 1: Write the failing test**

```typescript
// src/sync/identity.test.ts
import { describe, it, expect } from 'vitest';
import { loadIdentity, setDisplayName } from './identity';

function fakeStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe('identity', () => {
  it('mints a stable authorId once and persists it', () => {
    const s = fakeStorage();
    let n = 0;
    const a = loadIdentity(s, () => `id-${++n}`);
    const b = loadIdentity(s, () => `id-${++n}`);
    expect(a.authorId).toBe('id-1');
    expect(b.authorId).toBe('id-1'); // reused, not regenerated
    expect(a.name).toBe('');
  });

  it('edits the display name but keeps the id', () => {
    const s = fakeStorage();
    const a = loadIdentity(s, () => 'id-1');
    const b = setDisplayName('Fiddle', s);
    expect(b).toEqual({ authorId: 'id-1', name: 'Fiddle' });
    expect(loadIdentity(s, () => 'id-2').name).toBe('Fiddle');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/sync/identity.test.ts`
Expected: FAIL — `Cannot find module './identity'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/sync/identity.ts
export interface Identity {
  authorId: string;
  name: string;
}
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const KEY = 'bandaid.identity.v1';

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadIdentity(
  storage: StorageLike | null = defaultStorage(),
  gen: () => string = () => crypto.randomUUID(),
): Identity {
  let id = '';
  let name = '';
  try {
    const raw = storage?.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Identity>;
      id = parsed.authorId ?? '';
      name = parsed.name ?? '';
    }
  } catch {
    /* ignore corrupt value */
  }
  if (!id) {
    id = gen();
    save(storage, { authorId: id, name });
  }
  return { authorId: id, name };
}

export function setDisplayName(name: string, storage: StorageLike | null = defaultStorage()): Identity {
  const current = loadIdentity(storage);
  const next = { authorId: current.authorId, name };
  save(storage, next);
  return next;
}

function save(storage: StorageLike | null, identity: Identity): void {
  try {
    storage?.setItem(KEY, JSON.stringify(identity));
  } catch {
    /* ignore */
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/sync/identity.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sync/identity.ts src/sync/identity.test.ts
git commit -m "feat: editable per-device identity (stable authorId)"
```

---

## Task 3: Yjs band document + accessors

**Files:**
- Modify: `package.json` (add `yjs`)
- Create: `src/sync/doc.ts`
- Test: `src/sync/doc.test.ts`

**Interfaces:**
- Consumes: `Correction` (Task 1); `SongSettings` from `src/session/types.ts`.
- Produces (all operate on a `Y.Doc`):
  - `createBandDoc(): Y.Doc`
  - `listCorrections(doc): Correction[]`
  - `putCorrection(doc, c: Correction): void`
  - `setCorrectionStatus(doc, id: string, status: Correction['status']): void`
  - `removeCorrection(doc, id: string): void`
  - `getSongSettings(doc, songId): SongSettings`
  - `setSongSetting(doc, songId, patch: Partial<SongSettings>): void`
  - `resetSongSetting(doc, songId, field?: keyof SongSettings): void`
  - `migrateSongSettings(doc, storage?: StorageLike): void` — folds `bandaid.songSettings.v1` into the doc once (guarded by a `migrated` flag in the doc).
  - `exportUpdate(doc): Uint8Array` / `importUpdate(doc, update: Uint8Array): void`

- [ ] **Step 1: Add the dependency**

Run: `npm install yjs`
Expected: `yjs` appears under `dependencies` in `package.json`.

- [ ] **Step 2: Write the failing test**

```typescript
// src/sync/doc.test.ts
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  createBandDoc, listCorrections, putCorrection, setCorrectionStatus,
  getSongSettings, setSongSetting, resetSongSetting, exportUpdate, importUpdate, migrateSongSettings,
} from './doc';
import { makeCorrection } from './corrections';

const c1 = makeCorrection(
  { songId: 's', anchor: { kind: 'point', bar: 1, beat: 1 }, text: 't', author: 'A', authorId: 'd', songVersion: 'v1' },
  { id: 'c1', now: 1 },
);

describe('doc corrections', () => {
  it('stores and reads a correction', () => {
    const doc = createBandDoc();
    putCorrection(doc, c1);
    expect(listCorrections(doc).map((c) => c.id)).toEqual(['c1']);
  });

  it('updates status in place', () => {
    const doc = createBandDoc();
    putCorrection(doc, c1);
    setCorrectionStatus(doc, 'c1', 'applied');
    expect(listCorrections(doc)[0].status).toBe('applied');
  });

  it('converges two docs that each add a correction (CRDT merge)', () => {
    const a = createBandDoc();
    const b = createBandDoc();
    putCorrection(a, { ...c1, id: 'a1' });
    putCorrection(b, { ...c1, id: 'b1' });
    // exchange updates both ways
    importUpdate(b, exportUpdate(a));
    importUpdate(a, exportUpdate(b));
    expect(listCorrections(a).map((c) => c.id).sort()).toEqual(['a1', 'b1']);
    expect(listCorrections(b).map((c) => c.id).sort()).toEqual(['a1', 'b1']);
  });
});

describe('doc songSettings', () => {
  it('merges and resets per-song settings', () => {
    const doc = createBandDoc();
    setSongSetting(doc, 's', { tempoPct: 0.8 });
    setSongSetting(doc, 's', { transpose: 2 });
    expect(getSongSettings(doc, 's')).toEqual({ tempoPct: 0.8, transpose: 2 });
    resetSongSetting(doc, 's', 'tempoPct');
    expect(getSongSettings(doc, 's')).toEqual({ transpose: 2 });
  });

  it('migrates legacy localStorage once', () => {
    const m = new Map<string, string>([['bandaid.songSettings.v1', JSON.stringify({ s: { transpose: 3 } })]]);
    const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    const doc = createBandDoc();
    migrateSongSettings(doc, storage);
    migrateSongSettings(doc, storage); // second call is a no-op
    expect(getSongSettings(doc, 's')).toEqual({ transpose: 3 });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/sync/doc.test.ts`
Expected: FAIL — `Cannot find module './doc'`.

- [ ] **Step 4: Write the implementation**

```typescript
// src/sync/doc.ts
import * as Y from 'yjs';
import type { Correction } from './types';
import type { SongSettings } from '../session/types';
import type { StorageLike } from './identity';

const CORRECTIONS = 'corrections';
const SONG_SETTINGS = 'songSettings';
const META = 'meta';

export function createBandDoc(): Y.Doc {
  return new Y.Doc();
}

function correctionsMap(doc: Y.Doc): Y.Map<Correction> {
  return doc.getMap<Correction>(CORRECTIONS);
}
function songSettingsMap(doc: Y.Doc): Y.Map<SongSettings> {
  return doc.getMap<SongSettings>(SONG_SETTINGS);
}

export function listCorrections(doc: Y.Doc): Correction[] {
  return [...correctionsMap(doc).values()];
}
export function putCorrection(doc: Y.Doc, c: Correction): void {
  correctionsMap(doc).set(c.id, c);
}
export function setCorrectionStatus(doc: Y.Doc, id: string, status: Correction['status']): void {
  const m = correctionsMap(doc);
  const existing = m.get(id);
  if (existing) m.set(id, { ...existing, status });
}
export function removeCorrection(doc: Y.Doc, id: string): void {
  correctionsMap(doc).delete(id);
}

export function getSongSettings(doc: Y.Doc, songId: string): SongSettings {
  return { ...(songSettingsMap(doc).get(songId) ?? {}) };
}
export function setSongSetting(doc: Y.Doc, songId: string, patch: Partial<SongSettings>): void {
  const m = songSettingsMap(doc);
  const next: SongSettings = { ...(m.get(songId) ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) (next as Record<string, unknown>)[k] = v;
  }
  m.set(songId, next);
}
export function resetSongSetting(doc: Y.Doc, songId: string, field?: keyof SongSettings): void {
  const m = songSettingsMap(doc);
  if (!field) {
    m.delete(songId);
    return;
  }
  const next = { ...(m.get(songId) ?? {}) };
  delete next[field];
  if (Object.keys(next).length === 0) m.delete(songId);
  else m.set(songId, next);
}

export function exportUpdate(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}
export function importUpdate(doc: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(doc, update);
}

/** Fold legacy localStorage song settings into the doc once. */
export function migrateSongSettings(doc: Y.Doc, storage: StorageLike | null): void {
  const meta = doc.getMap<boolean>(META);
  if (meta.get('songSettingsMigrated')) return;
  try {
    const raw = storage?.getItem('bandaid.songSettings.v1');
    if (raw) {
      const legacy = JSON.parse(raw) as Record<string, SongSettings>;
      for (const [songId, settings] of Object.entries(legacy)) setSongSetting(doc, songId, settings);
    }
  } catch {
    /* ignore corrupt legacy value */
  }
  meta.set('songSettingsMigrated', true);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/sync/doc.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/sync/doc.ts src/sync/doc.test.ts
git commit -m "feat: Yjs band doc — corrections + songSettings + migration + export"
```

---

## Task 4: Synced session store (local mode)

**Files:**
- Create: `src/sync/syncedSessionStore.ts`
- Test: `src/sync/syncedSessionStore.test.ts`

**Interfaces:**
- Consumes: `SessionStore`, `SessionState`, `Transport`, `SongSettings` from `src/session/types.ts`; doc accessors (Task 3); `Identity`, `loadIdentity` (Task 2); `Correction`, `NewCorrection`, `makeCorrection` (Tasks 1).
- Produces:
  - `interface SyncedSessionStore extends SessionStore { listCorrections(): Correction[]; addCorrection(input: NewCorrection): Correction; setCorrectionStatus(id: string, status: Correction['status']): void; removeCorrection(id: string): void; getIdentity(): Identity; setDisplayName(name: string): void; subscribeCorrections(run: (list: Correction[]) => void): () => void; }`
  - `createSyncedSessionStore(opts?: { doc?: Y.Doc; storage?: StorageLike }): SyncedSessionStore` — with no providers attached this is a fully working local store. (Providers are wired in Task 5/6.)

- [ ] **Step 1: Write the failing test**

```typescript
// src/sync/syncedSessionStore.test.ts
import { describe, it, expect } from 'vitest';
import { createSyncedSessionStore } from './syncedSessionStore';

function fakeStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe('createSyncedSessionStore', () => {
  it('satisfies the SessionStore surface (currentSong + transport)', () => {
    const store = createSyncedSessionStore({ storage: fakeStorage() });
    store.setCurrentSong('stones-rag');
    expect(store.getState().currentSongId).toBe('stones-rag');
  });

  it('adds a correction and notifies subscribers', () => {
    const store = createSyncedSessionStore({ storage: fakeStorage() });
    const seen: number[] = [];
    store.subscribeCorrections((list) => seen.push(list.length));
    const c = store.addCorrection({
      songId: 's', anchor: { kind: 'point', bar: 1, beat: 1 }, text: 't',
      author: 'A', authorId: store.getIdentity().authorId, songVersion: 'v1',
    });
    expect(store.listCorrections().map((x) => x.id)).toEqual([c.id]);
    expect(seen.at(-1)).toBe(1);
  });

  it('edits the display name via identity', () => {
    const store = createSyncedSessionStore({ storage: fakeStorage() });
    store.setDisplayName('Fiddle');
    expect(store.getIdentity().name).toBe('Fiddle');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/sync/syncedSessionStore.test.ts`
Expected: FAIL — `Cannot find module './syncedSessionStore'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/sync/syncedSessionStore.ts
import * as Y from 'yjs';
import type { SessionState, SessionStore, SongSettings, Transport } from '../session/types';
import type { Correction, NewCorrection } from './types';
import type { Identity, StorageLike } from './identity';
import { loadIdentity, setDisplayName as persistName } from './identity';
import * as doc from './doc';
import { makeCorrection } from './corrections';

export interface SyncedSessionStore extends SessionStore {
  listCorrections(): Correction[];
  addCorrection(input: NewCorrection): Correction;
  setCorrectionStatus(id: string, status: Correction['status']): void;
  removeCorrection(id: string): void;
  getIdentity(): Identity;
  setDisplayName(name: string): void;
  subscribeCorrections(run: (list: Correction[]) => void): () => void;
  /** The underlying doc, so providers (Task 5) can attach. */
  readonly doc: Y.Doc;
}

export function createSyncedSessionStore(
  opts: { doc?: Y.Doc; storage?: StorageLike | null } = {},
): SyncedSessionStore {
  const ydoc = opts.doc ?? doc.createBandDoc();
  const storage = opts.storage === undefined ? safeLocalStorage() : opts.storage;
  doc.migrateSongSettings(ydoc, storage ?? null);

  let identity = loadIdentity(storage ?? null);
  // currentSongId + transport are session-local in this spec (not yet doc-synced).
  let currentSongId: string | null = null;
  let transport: Transport | null = null;

  const stateSubs = new Set<(s: SessionState) => void>();
  const corrSubs = new Set<(list: Correction[]) => void>();

  const snapshot = (): SessionState => ({
    currentSongId,
    transport,
    songSettings: {}, // settings are read on demand via getSongSettings
  });
  const emitState = () => stateSubs.forEach((cb) => cb(snapshot()));
  const emitCorrections = () => corrSubs.forEach((cb) => cb(doc.listCorrections(ydoc)));

  ydoc.getMap('corrections').observeDeep(emitCorrections);

  return {
    doc: ydoc,
    subscribe(run) {
      stateSubs.add(run);
      run(snapshot());
      return () => stateSubs.delete(run);
    },
    getState: snapshot,
    setCurrentSong(songId) {
      currentSongId = songId;
      emitState();
    },
    setTransport(t) {
      transport = t;
      emitState();
    },
    getSongSettings: (songId) => doc.getSongSettings(ydoc, songId),
    setSongSetting: (songId, patch: Partial<SongSettings>) => {
      doc.setSongSetting(ydoc, songId, patch);
      emitState();
    },
    resetSongSetting: (songId, field) => {
      doc.resetSongSetting(ydoc, songId, field);
      emitState();
    },
    listCorrections: () => doc.listCorrections(ydoc),
    addCorrection(input) {
      const c = makeCorrection(input);
      doc.putCorrection(ydoc, c);
      return c;
    },
    setCorrectionStatus: (id, status) => doc.setCorrectionStatus(ydoc, id, status),
    removeCorrection: (id) => doc.removeCorrection(ydoc, id),
    getIdentity: () => identity,
    setDisplayName(name) {
      identity = persistName(name, storage ?? null);
    },
    subscribeCorrections(run) {
      corrSubs.add(run);
      run(doc.listCorrections(ydoc));
      return () => corrSubs.delete(run);
    },
  };
}

function safeLocalStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/sync/syncedSessionStore.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full suite + type-check**

Run: `npm test && npm run check`
Expected: all green, 0 type errors.

- [ ] **Step 6: Commit**

```bash
git add src/sync/syncedSessionStore.ts src/sync/syncedSessionStore.test.ts
git commit -m "feat: synced session store over Yjs doc (local mode)"
```

---

## Task 5: Provider interface + transport wrappers

**Files:**
- Modify: `package.json` (add `y-indexeddb`, `y-webrtc`, `y-partykit`)
- Create: `src/sync/providers/types.ts`
- Create: `src/sync/providers/indexeddb.ts`
- Create: `src/sync/providers/webrtc.ts`
- Create: `src/sync/providers/partykit.ts`
- Create: `src/sync/providers/attach.ts`
- Test: `src/sync/providers/attach.test.ts`

**Interfaces:**
- Consumes: `Y.Doc` (the store's `doc`).
- Produces:
  - `interface SyncProvider { name: string; disconnect(): void }`
  - `type ProviderFactory = (doc: Y.Doc, bandCode: string) => SyncProvider`
  - `attachProviders(doc: Y.Doc, bandCode: string, factories: ProviderFactory[]): () => void` — builds all providers, returns a disconnect-all cleanup. Tolerates a factory that throws (logs + skips) so one bad transport never blocks the rest.
  - `indexeddbProvider`, `webrtcProvider`, `partykitProvider(host: string): ProviderFactory`

- [ ] **Step 1: Add dependencies**

Run: `npm install y-indexeddb y-webrtc y-partykit`
Expected: the three packages appear under `dependencies`.

- [ ] **Step 2: Write the failing test (provider-agnostic orchestration)**

```typescript
// src/sync/providers/attach.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { attachProviders, type ProviderFactory } from './attach';

describe('attachProviders', () => {
  it('builds every provider and disconnects them all', () => {
    const doc = new Y.Doc();
    const d1 = vi.fn();
    const d2 = vi.fn();
    const f1: ProviderFactory = () => ({ name: 'a', disconnect: d1 });
    const f2: ProviderFactory = () => ({ name: 'b', disconnect: d2 });
    const cleanup = attachProviders(doc, 'band-code', [f1, f2]);
    cleanup();
    expect(d1).toHaveBeenCalledOnce();
    expect(d2).toHaveBeenCalledOnce();
  });

  it('skips a factory that throws and still attaches the others', () => {
    const doc = new Y.Doc();
    const ok = vi.fn();
    const bad: ProviderFactory = () => {
      throw new Error('no network');
    };
    const good: ProviderFactory = () => ({ name: 'good', disconnect: ok });
    const cleanup = attachProviders(doc, 'x', [bad, good]);
    cleanup();
    expect(ok).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/sync/providers/attach.test.ts`
Expected: FAIL — `Cannot find module './attach'`.

- [ ] **Step 4: Write the interface + orchestrator**

```typescript
// src/sync/providers/types.ts
import type * as Y from 'yjs';
export interface SyncProvider {
  name: string;
  disconnect(): void;
}
export type ProviderFactory = (doc: Y.Doc, bandCode: string) => SyncProvider;
```

```typescript
// src/sync/providers/attach.ts
import type * as Y from 'yjs';
import type { ProviderFactory, SyncProvider } from './types';
export type { ProviderFactory, SyncProvider } from './types';

export function attachProviders(
  doc: Y.Doc,
  bandCode: string,
  factories: ProviderFactory[],
): () => void {
  const built: SyncProvider[] = [];
  for (const make of factories) {
    try {
      built.push(make(doc, bandCode));
    } catch (e) {
      console.warn(`[sync] provider failed to attach, skipping:`, e);
    }
  }
  return () => built.forEach((p) => p.disconnect());
}
```

- [ ] **Step 5: Write the concrete wrappers (browser-only; thin glue)**

```typescript
// src/sync/providers/indexeddb.ts
import { IndexeddbPersistence } from 'y-indexeddb';
import type { ProviderFactory } from './types';
export const indexeddbProvider: ProviderFactory = (doc, bandCode) => {
  const p = new IndexeddbPersistence(`bandaid-${bandCode}`, doc);
  return { name: 'indexeddb', disconnect: () => void p.destroy() };
};
```

```typescript
// src/sync/providers/webrtc.ts
import { WebrtcProvider } from 'y-webrtc';
import type { ProviderFactory } from './types';
export const webrtcProvider: ProviderFactory = (doc, bandCode) => {
  const p = new WebrtcProvider(`bandaid-${bandCode}`, doc);
  return { name: 'webrtc', disconnect: () => p.destroy() };
};
```

```typescript
// src/sync/providers/partykit.ts
import YPartyKitProvider from 'y-partykit/provider';
import type { ProviderFactory } from './types';
/** host: the deployed PartyKit host, e.g. "bandaid.<user>.partykit.dev". */
export function partykitProvider(host: string): ProviderFactory {
  return (doc, bandCode) => {
    const p = new YPartyKitProvider(host, bandCode, doc, { party: 'corrections' });
    return { name: 'partykit', disconnect: () => p.disconnect() };
  };
}
```

- [ ] **Step 6: Run tests + type-check**

Run: `npm test -- src/sync/providers/attach.test.ts && npm run check`
Expected: PASS (2 tests), 0 type errors. (The concrete wrappers are import-only here; they're exercised in-app in Task 6.)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/sync/providers/
git commit -m "feat: sync provider interface + indexeddb/webrtc/partykit wrappers"
```

---

## Task 6: App wiring (band code + provider attach + local fallback)

**Files:**
- Create: `src/sync/bandCode.ts`
- Test: `src/sync/bandCode.test.ts`
- Modify: `src/App.svelte` (store construction)
- Modify: `.env.example` (Create) — document `VITE_PARTYKIT_HOST`

**Interfaces:**
- Consumes: `createSyncedSessionStore` (Task 4), `attachProviders` + provider factories (Task 5).
- Produces: `readBandCode(search: string, storage?: StorageLike): string | null` — parses `?band=<code>` (remembering it in `bandaid.band.v1`), else returns the remembered code, else `null`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/sync/bandCode.test.ts
import { describe, it, expect } from 'vitest';
import { readBandCode } from './bandCode';

function fakeStorage(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe('readBandCode', () => {
  it('reads ?band= and remembers it', () => {
    const s = fakeStorage();
    expect(readBandCode('?band=rhythm-cats', s)).toBe('rhythm-cats');
    expect(readBandCode('', s)).toBe('rhythm-cats'); // remembered
  });
  it('returns null when never set', () => {
    expect(readBandCode('', fakeStorage())).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/sync/bandCode.test.ts`
Expected: FAIL — `Cannot find module './bandCode'`.

- [ ] **Step 3: Implement `readBandCode`**

```typescript
// src/sync/bandCode.ts
import type { StorageLike } from './identity';

const KEY = 'bandaid.band.v1';

export function readBandCode(
  search: string,
  storage: StorageLike | null = safeLocal(),
): string | null {
  const fromUrl = new URLSearchParams(search).get('band');
  if (fromUrl) {
    try {
      storage?.setItem(KEY, fromUrl);
    } catch {
      /* ignore */
    }
    return fromUrl;
  }
  try {
    return storage?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

function safeLocal(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/sync/bandCode.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the store in `App.svelte`**

Replace the store construction at the top of `src/App.svelte`:

```svelte
  import { createSyncedSessionStore } from './sync/syncedSessionStore';
  import { attachProviders } from './sync/providers/attach';
  import { indexeddbProvider } from './sync/providers/indexeddb';
  import { webrtcProvider } from './sync/providers/webrtc';
  import { partykitProvider } from './sync/providers/partykit';
  import { readBandCode } from './sync/bandCode';
  import { onDestroy } from 'svelte';

  // Synced store over a Yjs doc. With a band code we attach transports; without one
  // the same store works fully local (IndexedDB only, no network).
  const store = createSyncedSessionStore();
  const bandCode = readBandCode(typeof location !== 'undefined' ? location.search : '');
  let detach: (() => void) | undefined;
  if (bandCode) {
    const host = import.meta.env.VITE_PARTYKIT_HOST;
    const factories = [indexeddbProvider, webrtcProvider, ...(host ? [partykitProvider(host)] : [])];
    detach = attachProviders(store.doc, bandCode, factories);
  } else {
    // Local-only durability even without a band: persist to IndexedDB.
    detach = attachProviders(store.doc, 'solo', [indexeddbProvider]);
  }
  onDestroy(() => detach?.());
```

Remove the old `import { createLocalSessionStore }` line and its `const store = createLocalSessionStore();`. Everything else in `App.svelte` is unchanged because `store` still satisfies `SessionStore`.

- [ ] **Step 6: Document the env var**

```bash
# .env.example
# Deployed PartyKit host for durable correction sync (omit for local/P2P-only).
VITE_PARTYKIT_HOST=bandaid.<your-account>.partykit.dev
```

- [ ] **Step 7: Verify build + type-check + run**

Run: `npm run check && npm run build`
Expected: 0 type errors; build succeeds.
Then `npm run dev`, open the app with `?band=test`, add a correction via the dev console (`window`-exposed store is not required — verify no console errors and that reloading the page preserves the doc via IndexedDB).

- [ ] **Step 8: Commit**

```bash
git add src/sync/bandCode.ts src/sync/bandCode.test.ts src/App.svelte .env.example
git commit -m "feat: wire synced store + providers into App with local fallback"
```

---

## Task 7: PartyKit server + deploy config

**Files:**
- Modify: `package.json` (add `partykit` devDependency)
- Create: `party/corrections.ts`
- Create: `partykit.json`

**Interfaces:**
- Consumes: nothing in-repo (runtime is `y-partykit/server`).
- Produces: a deployed party named `corrections` that persists each room's Yjs doc.

- [ ] **Step 1: Add the dev dependency**

Run: `npm install -D partykit`
Expected: `partykit` under `devDependencies`.

- [ ] **Step 2: Write the party server**

```typescript
// party/corrections.ts
import { onConnect } from 'y-partykit';
import type * as Party from 'partykit/server';

export default class CorrectionsServer implements Party.Server {
  constructor(readonly room: Party.Room) {}
  // y-partykit handles Yjs sync + durable persistence per room (the band code).
  onConnect(conn: Party.Connection) {
    return onConnect(conn, this.room, { persist: { mode: 'snapshot' } });
  }
}
```

- [ ] **Step 3: Write the PartyKit config**

```json
{
  "$schema": "https://www.partykit.io/schema.json",
  "name": "bandaid",
  "parties": { "corrections": "party/corrections.ts" },
  "main": "party/corrections.ts"
}
```

- [ ] **Step 4: Verify it builds locally**

Run: `npx partykit dev`
Expected: a local party boots on `127.0.0.1:1999` with no errors. Stop it with Ctrl-C. (No automated test — this is an external runtime; the in-app provider exercises it.)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json party/corrections.ts partykit.json
git commit -m "feat: PartyKit corrections server + config"
```

- [ ] **Step 6: Deploy (manual, one-time — documented, not automated)**

Run (the human, with their Cloudflare/PartyKit login): `npx partykit deploy`
Then set `VITE_PARTYKIT_HOST` in the deploy environment to the printed host. This is an operator step; the plan does not automate account-bound deploys.

---

## Task 8: Headless pull + resolve scripts

**Files:**
- Create: `scripts/corrections-pull.ts`
- Create: `scripts/corrections-resolve.ts`
- Test: `scripts/corrections-pull.test.ts`
- Modify: `package.json` (scripts + `tsx` devDependency)

**Interfaces:**
- Consumes: `serializeInbox` (Task 1), `createBandDoc`/`importUpdate`/`listCorrections`/`setCorrectionStatus`/`exportUpdate` (Task 3), `YPartyKitProvider` (Task 5 dep).
- Produces: `npm run corrections:pull -- <bandCode>` writes `corrections/inbox.json`; `npm run corrections:resolve -- <id...>` flips pins to `applied`. A pure `buildInbox(doc, currentSongVersion, now)` is extracted for testing.

- [ ] **Step 1: Add the runner dependency + scripts**

Run: `npm install -D tsx`
Then add to `package.json` `scripts`:

```json
    "corrections:pull": "tsx scripts/corrections-pull.ts",
    "corrections:resolve": "tsx scripts/corrections-resolve.ts"
```

- [ ] **Step 2: Write the failing test for the pure builder**

```typescript
// scripts/corrections-pull.test.ts
import { describe, it, expect } from 'vitest';
import { buildInbox } from './corrections-pull';
import { createBandDoc, putCorrection } from '../src/sync/doc';
import { makeCorrection } from '../src/sync/corrections';

describe('buildInbox', () => {
  it('serializes open corrections from a doc and stamps generatedAt', () => {
    const doc = createBandDoc();
    putCorrection(
      doc,
      makeCorrection(
        { songId: 's', anchor: { kind: 'point', bar: 4, beat: 1 }, text: 'tie', author: 'A', authorId: 'd', songVersion: 'v1' },
        { id: 'c1', now: 1 },
      ),
    );
    const inbox = buildInbox(doc, 'v2', 5000);
    expect(inbox.generatedAt).toBe(5000);
    expect(inbox.songs.s[0].id).toBe('c1');
    expect(inbox.songs.s[0].stale).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- scripts/corrections-pull.test.ts`
Expected: FAIL — `Cannot find module './corrections-pull'`.

- [ ] **Step 4: Write the pull script**

```typescript
// scripts/corrections-pull.ts
import { writeFileSync, mkdirSync } from 'node:fs';
import * as Y from 'yjs';
import { listCorrections } from '../src/sync/doc';
import { serializeInbox } from '../src/sync/corrections';
import type { InboxFile } from '../src/sync/types';

/** Pure: doc → inbox JSON. `now`/version injected so it's testable offline. */
export function buildInbox(doc: Y.Doc, currentSongVersion: string, now: number): InboxFile {
  return { ...serializeInbox(listCorrections(doc), currentSongVersion), generatedAt: now };
}

async function main() {
  const bandCode = process.argv[2];
  if (!bandCode) throw new Error('usage: corrections:pull -- <bandCode>');
  const host = process.env.VITE_PARTYKIT_HOST;
  if (!host) throw new Error('set VITE_PARTYKIT_HOST to the deployed party host');

  const { default: YPartyKitProvider } = await import('y-partykit/provider');
  const doc = new Y.Doc();
  const provider = new YPartyKitProvider(host, bandCode, doc, { party: 'corrections', connect: true });
  await new Promise<void>((resolve) => provider.once('synced', () => resolve()));

  const songVersion = process.env.BUILD_ID ?? 'unknown';
  const inbox = buildInbox(doc, songVersion, Date.now());
  mkdirSync('corrections', { recursive: true });
  writeFileSync('corrections/inbox.json', JSON.stringify(inbox, null, 2) + '\n');
  console.log(`Wrote corrections/inbox.json (${Object.keys(inbox.songs).length} song(s))`);
  provider.disconnect();
}

// Only run when invoked directly, not when imported by the test.
if (process.argv[1]?.endsWith('corrections-pull.ts')) {
  main().then(() => process.exit(0)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
```

- [ ] **Step 5: Write the resolve script**

```typescript
// scripts/corrections-resolve.ts
import * as Y from 'yjs';
import { setCorrectionStatus } from '../src/sync/doc';

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) throw new Error('usage: corrections:resolve -- <id> [id...]');
  const bandCode = process.env.BAND_CODE;
  const host = process.env.VITE_PARTYKIT_HOST;
  if (!bandCode || !host) throw new Error('set BAND_CODE and VITE_PARTYKIT_HOST');

  const { default: YPartyKitProvider } = await import('y-partykit/provider');
  const doc = new Y.Doc();
  const provider = new YPartyKitProvider(host, bandCode, doc, { party: 'corrections', connect: true });
  await new Promise<void>((resolve) => provider.once('synced', () => resolve()));

  for (const id of ids) setCorrectionStatus(doc, id, 'applied');
  // Give the provider a tick to flush the update to the server before exiting.
  await new Promise((r) => setTimeout(r, 500));
  console.log(`Marked ${ids.length} correction(s) applied`);
  provider.disconnect();
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 6: Run the test + type-check**

Run: `npm test -- scripts/corrections-pull.test.ts && npm run check`
Expected: PASS (1 test), 0 type errors.

- [ ] **Step 7: Add `corrections/` ignore (working artifact, not committed)**

Append to `.gitignore`:

```
corrections/
```

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json scripts/ .gitignore
git commit -m "feat: headless corrections pull + resolve scripts"
```

---

## Self-Review

**Spec coverage:**
- Y.Doc per band + layered providers → Tasks 3, 5, 6. ✓
- Provider interface (swappable) → Task 5. ✓
- Corrections data shape (anchor/status/author/songVersion) → Task 1. ✓
- Local durability (`y-indexeddb`) + offline → Task 5 + Task 6 fallback. ✓
- Durable hosted (PartyKit) → Tasks 5, 7. ✓
- P2P (`y-webrtc`) → Task 5. ✓
- Export/import tier → `exportUpdate`/`importUpdate` (Task 3); in-app export button is sub-project B (UX). ✓ (data path covered)
- Band code join → Task 6. ✓
- Editable identity + stable authorId → Task 2. ✓
- Minimal presence → deferred per spec; awareness not wired in v1 (documented in spec). ✓ (intentional omission)
- `songSettings` migration → Task 3. ✓
- `SessionStore` seam preserved → Task 4 (implements the interface), Task 6 (drop-in). ✓
- Pull/resolve loop → Task 8. ✓
- Staleness via `songVersion` → Tasks 1 (`isStale`) + 8 (inbox `stale`). ✓

**Placeholder scan:** No TBD/TODO; every code step is complete. The PartyKit *deploy* (Task 7 Step 6) is intentionally a manual operator action (account-bound), clearly labeled, not a code placeholder.

**Type consistency:** `Correction`/`NewCorrection`/`InboxFile` defined in Task 1 and used unchanged in Tasks 3/4/8. Doc accessors named identically across Tasks 3, 4, 8 (`listCorrections`, `putCorrection`, `setCorrectionStatus`, `exportUpdate`, `importUpdate`). `StorageLike` defined in Task 2 and reused in Tasks 3/4/6. `ProviderFactory`/`SyncProvider` defined in Task 5 and used in Task 6.

**Note for the implementer:** the in-app capture/review UI (tapping a note to create a pin, the corrections list, moving status, the export button) is **sub-project B** and is intentionally absent here — Task 6's verification adds corrections programmatically. This plan ends with a working, synced, durable corrections substrate plus the headless tooling.
