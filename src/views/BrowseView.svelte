<script lang="ts">
  import { onMount } from 'svelte';
  import type { LibraryService } from '../library/libraryService';
  import type { SongSummary } from '../library/types';
  import type { SetListStore, MergedSetList } from '../library/setListStore';
  import SyncBadge from '../sync/SyncBadge.svelte';
  import type { SyncTone } from '../sync/syncStatusLabel';

  /**
   * Integrated song picker (M1) + set list editing (M2). A tab row at the top selects
   * which list to show — each set list, plus "All songs" — and the body shows that one
   * list; tap a song to open. Set lists come from the setListStore (bundled manifest
   * defaults + the band's shared edits); "All songs" stays a plain manifest read.
   *
   * Edit mode (per-device, per-visit): drag rows to reorder, remove songs, append from
   * an add panel, rename the list, delete it behind a confirmation, drag tabs to
   * reorder the lists themselves. Every edit syncs to the band and persists.
   */
  let { service, setListStore, onopen, onclose, activeId, activeVariantId, progress = 0, syncSummary }: {
    service: LibraryService;
    setListStore: SetListStore;
    onopen: (song: SongSummary, variantId?: string) => void;
    onclose?: () => void; // present when shown as the slide-over
    activeId?: string; // the currently-open song (highlighted)
    activeVariantId?: string; // the open song's arrangement, if any (highlight must match)
    progress?: number; // 0–1 playback position of the active song
    syncSummary: { label: string; tone: SyncTone };
  } = $props();

  // The store instance is stable for this component's lifetime (App builds it once
  // with the manifest) — reading it at init is deliberate, not a missed reaction.
  // svelte-ignore state_referenced_locally
  let setLists = $state<MergedSetList[]>(setListStore.getLists());
  onMount(() => setListStore.subscribe((ls) => (setLists = ls)));
  let allSongs = $derived(service.getAllSongs());

  const LAST_KEY = 'bandaid.lastList';
  function loadLast(): string | null {
    try {
      return typeof localStorage !== 'undefined' ? localStorage.getItem(LAST_KEY) : null;
    } catch {
      return null;
    }
  }
  let pickedRaw = $state<string | null>(loadLast());

  // Resolve the selection: the remembered list if it still exists, else the first set
  // list, else "all". ('all' is an explicit, valid choice.)
  let selected = $derived.by<string>(() => {
    if (pickedRaw === 'all') return 'all';
    if (pickedRaw && setLists.some((l) => l.id === pickedRaw)) return pickedRaw;
    return setLists[0]?.id ?? 'all';
  });
  let selectedList = $derived(setLists.find((l) => l.id === selected));

  type Item = { song: SongSummary; variantId?: string; variantName?: string; entryId?: string };
  // Set-list entries resolved to songs: unknown song ids are dropped (library drift —
  // the entry stays in the doc, display just skips it); unknown variants fall back to
  // canonical, same as the old manifest path.
  let shownItems = $derived.by<Item[]>(() => {
    if (selected === 'all' || !selectedList) return allSongs.map((song) => ({ song }));
    return selectedList.entries.flatMap((e) => {
      const song = service.getSongSummary(e.songId);
      if (!song) return [];
      const variant = e.variantId ? (song.variants?.find((v) => v.id === e.variantId) ?? undefined) : undefined;
      return [{ song, variantId: variant?.id, variantName: variant?.name, entryId: e.entryId }];
    });
  });

  function pick(id: string) {
    pickedRaw = id;
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(LAST_KEY, id);
    } catch {
      /* ignore */
    }
  }

  // ---- Edit mode ----------------------------------------------------------------

  let editing = $state(false);
  let confirmDelete = $state(false);
  // Focus the rename field right after creating a list (name it while it's fresh).
  let focusRename = $state(false);
  const canEdit = $derived(selected !== 'all' && !!selectedList);

  function newList() {
    const id = setListStore.createList('New set list');
    pick(id);
    editing = true;
    focusRename = true;
  }
  function commitRename(e: Event) {
    const name = (e.target as HTMLInputElement).value.trim();
    if (name && selectedList && name !== selectedList.name) setListStore.renameList(selectedList.id, name);
  }
  function doDelete() {
    if (selectedList) setListStore.deleteList(selectedList.id);
    confirmDelete = false;
    editing = false;
  }
  const renameFocus = (el: HTMLInputElement) => {
    if (focusRename) {
      el.focus();
      el.select();
      focusRename = false;
    }
  };

  // ---- Drag to reorder (rows vertical, tabs horizontal) ---------------------------
  // Pointer events cover mouse and touch with one code path; the handle sets
  // touch-action: none so a touch drag reorders instead of scrolling. Keyboard path:
  // ArrowUp/ArrowDown on the focused handle. While dragging, the pending order is
  // applied locally (displayItems) and committed to the store on drop.

  let listEl = $state<HTMLUListElement | undefined>(undefined);
  let drag = $state<{ entryId: string; toIndex: number } | null>(null);

  let displayItems = $derived.by<Item[]>(() => {
    if (!drag) return shownItems;
    const from = shownItems.findIndex((i) => i.entryId === drag!.entryId);
    if (from === -1) return shownItems;
    const arr = [...shownItems];
    const [moved] = arr.splice(from, 1);
    arr.splice(drag.toIndex, 0, moved);
    return arr;
  });

  function rowIndexForY(y: number): number {
    if (!listEl) return 0;
    const rows = [...listEl.querySelectorAll<HTMLLIElement>('li.entry')];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return rows.length - 1;
  }
  function capture(e: PointerEvent) {
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* no active pointer (synthetic events) — move/up still bubble to the handle */
    }
  }
  function startRowDrag(e: PointerEvent, entryId: string, index: number) {
    capture(e);
    drag = { entryId, toIndex: index };
  }
  function moveRowDrag(e: PointerEvent) {
    if (!drag) return;
    const toIndex = rowIndexForY(e.clientY);
    if (toIndex !== drag.toIndex) drag = { ...drag, toIndex };
  }
  function endRowDrag() {
    if (!drag) return;
    setListStore.moveEntry(selected, drag.entryId, drag.toIndex);
    drag = null;
  }
  function rowKeydown(e: KeyboardEvent, entryId: string, index: number) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const to = e.key === 'ArrowUp' ? index - 1 : index + 1;
    if (to < 0 || to >= shownItems.length) return;
    setListStore.moveEntry(selected, entryId, to);
    (e.currentTarget as HTMLElement).focus();
  }

  // Tab drag: pointerdown arms it; real movement (past a slop) turns it into a drag,
  // a still pointerup stays a tap that selects the list.
  let tabsEl = $state<HTMLElement | undefined>(undefined);
  let tabDrag = $state<{ listId: string; toIndex: number; startX: number; active: boolean } | null>(null);

  let displayLists = $derived.by<MergedSetList[]>(() => {
    if (!tabDrag?.active) return setLists;
    const from = setLists.findIndex((l) => l.id === tabDrag!.listId);
    if (from === -1) return setLists;
    const arr = [...setLists];
    const [moved] = arr.splice(from, 1);
    arr.splice(tabDrag.toIndex, 0, moved);
    return arr;
  });

  function tabIndexForX(x: number): number {
    if (!tabsEl) return 0;
    const tabs = [...tabsEl.querySelectorAll<HTMLElement>('button.tab[data-list]')];
    for (let i = 0; i < tabs.length; i++) {
      const r = tabs[i].getBoundingClientRect();
      if (x < r.left + r.width / 2) return i;
    }
    return tabs.length - 1;
  }
  function startTabDrag(e: PointerEvent, listId: string, index: number) {
    if (!editing) return;
    capture(e);
    tabDrag = { listId, toIndex: index, startX: e.clientX, active: false };
  }
  function moveTabDrag(e: PointerEvent) {
    if (!tabDrag) return;
    const active = tabDrag.active || Math.abs(e.clientX - tabDrag.startX) > 6;
    const toIndex = tabIndexForX(e.clientX);
    if (active !== tabDrag.active || toIndex !== tabDrag.toIndex) tabDrag = { ...tabDrag, active, toIndex };
  }
  function endTabDrag(listId: string) {
    if (!tabDrag) return;
    if (tabDrag.active) setListStore.moveList(tabDrag.listId, tabDrag.toIndex);
    else pick(listId); // a still tap selects, as outside edit mode
    tabDrag = null;
  }

  // As a slide-over, receive keyboard focus on open (the close button is first).
  const focusOnMount = (el: HTMLElement) => el.focus();

  // The open row: song AND arrangement must match — a variant being open must not
  // light up the canonical row (or any "All songs" row), and vice versa.
  const isActive = (it: Item) => it.song.id === activeId && (it.variantId ?? null) === (activeVariantId ?? null);

  const keyLabel = (s: SongSummary) => `${s.defaultKey.tonalCenter} ${s.defaultKey.mode}`;
  const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

  // Expected running time of the shown list (sum of single-pass times). '~' because
  // it's one pass per tune at the chart tempo; bands often play more.
  let totalSec = $derived(shownItems.reduce((a, i) => a + (i.song.durationSec ?? 0), 0));
  let allTimed = $derived(shownItems.length > 0 && shownItems.every((i) => i.song.durationSec !== undefined));
</script>

<div class="picker">
  <header class="phead">
    <h1 class="brand">BandAid</h1>
    <span class="ptitle">Songs</span>
    <SyncBadge summary={syncSummary} />
    {#if onclose}
      <button class="iconbtn" use:focusOnMount onclick={onclose} aria-label="Close">✕</button>
    {/if}
  </header>

  <nav class="tabs" aria-label="Song lists" bind:this={tabsEl}>
    {#each displayLists as l (l.id)}
      <button
        class="tab"
        class:active={selected === l.id}
        class:dragging={tabDrag?.active && tabDrag.listId === l.id}
        aria-current={selected === l.id}
        data-list={l.id}
        onclick={() => { if (!editing) pick(l.id); }}
        onpointerdown={(e) => startTabDrag(e, l.id, displayLists.indexOf(l))}
        onpointermove={moveTabDrag}
        onpointerup={() => endTabDrag(l.id)}
        onpointercancel={() => (tabDrag = null)}
      >{l.name}</button>
    {/each}
    <button class="tab" class:active={selected === 'all'} aria-current={selected === 'all'} onclick={() => pick('all')}>All songs</button>
    <button class="tab newlist" onclick={newList} title="New set list">+ New list</button>
  </nav>

  <!-- <main> when full-screen; a plain region inside the slide-over (the drill view
       underneath already owns the page's <main>). -->
  <svelte:element this={onclose ? 'div' : 'main'} class="pbody">
    {#if editing && selectedList}
      <div class="editbar">
        {#key selectedList.id}
          <input
            class="rename"
            value={selectedList.name}
            use:renameFocus
            onchange={commitRename}
            onkeydown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
            aria-label="Set list name"
          />
        {/key}
        <button class="danger" onclick={() => (confirmDelete = true)}>Delete list</button>
        <button class="donebtn" onclick={() => (editing = false)}>Done</button>
      </div>
    {/if}

    {#if shownItems.length === 0 && !editing}
      <p class="empty">No songs here yet.{#if canEdit}&nbsp;Tap Edit to add some.{/if}</p>
    {/if}
    <div class="listmeta">
      {#if shownItems.length > 0}
        {shownItems.length} song{shownItems.length === 1 ? '' : 's'}{#if totalSec > 0}{' · '}{allTimed
            ? ''
            : '≥'}~{fmt(totalSec)}{/if}
      {/if}
      {#if canEdit && !editing}
        <button class="editbtn" onclick={() => (editing = true)}>Edit</button>
      {/if}
    </div>
    {#if shownItems.length > 0 || (editing && selected !== 'all')}
      <ul class="list" bind:this={listEl}>
        {#each displayItems as it, index (it.entryId ?? `${it.song.id}@${it.variantId ?? ''}`)}
          <li class="entry" class:lifted={drag?.entryId === it.entryId}>
            {#if editing && it.entryId}
              <div class="srow editrow" class:active={isActive(it)}>
                <button
                  class="handle"
                  aria-label={`Reorder ${it.song.title} (arrow keys move it)`}
                  onpointerdown={(e) => startRowDrag(e, it.entryId!, index)}
                  onpointermove={moveRowDrag}
                  onpointerup={endRowDrag}
                  onpointercancel={() => (drag = null)}
                  onkeydown={(e) => rowKeydown(e, it.entryId!, index)}
                >≡</button>
                <span class="stitle">
                  {it.song.title}
                  {#if it.variantName}<span class="arr">{it.variantName}</span>{/if}
                </span>
                <span class="smeta">{keyLabel(it.song)}{#if it.song.durationSec}{' · '}{fmt(it.song.durationSec)}{/if}</span>
                <button class="removebtn" onclick={() => setListStore.removeEntry(selected, it.entryId!)} aria-label={`Remove ${it.song.title}`}>✕</button>
              </div>
            {:else}
              <button class="srow" class:active={isActive(it)} aria-current={isActive(it)} onclick={() => onopen(it.song, it.variantId)}>
                <span class="stitle">
                  {it.song.title}
                  {#if it.variantName}<span class="arr">{it.variantName}</span>{/if}
                  {#if isActive(it)}<span class="now">▶ now</span>{/if}
                </span>
                <span class="smeta"
                  >{keyLabel(it.song)} · ♩ = {it.song.defaultTempoBpm}{#if it.song.durationSec}{' · '}{fmt(it.song.durationSec)}{/if}</span
                >
                {#if isActive(it)}
                  <span class="prog" style="width: {(Math.min(1, Math.max(0, progress)) * 100).toFixed(1)}%"></span>
                {/if}
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if editing && selectedList}
      <section class="addpanel">
        <h3 class="addhead">Add songs</h3>
        {#each allSongs as s (s.id)}
          <div class="addrow">
            <span class="addtitle">{s.title}</span>
            <button class="addbtn" onclick={() => setListStore.addSong(selectedList!.id, s.id)} aria-label={`Add ${s.title}`}>+ Add</button>
          </div>
          {#each s.variants ?? [] as v (v.id)}
            <div class="addrow variantrow">
              <span class="addtitle">{s.title} <span class="arr">{v.name}</span></span>
              <button class="addbtn" onclick={() => setListStore.addSong(selectedList!.id, s.id, v.id)} aria-label={`Add ${s.title} (${v.name})`}>+ Add</button>
            </div>
          {/each}
        {/each}
      </section>
    {/if}
  </svelte:element>
</div>

{#if confirmDelete && selectedList}
  <div class="confirm-scrim"></div>
  <div class="confirm" role="alertdialog" aria-modal="true" aria-label="Delete set list">
    <p class="confirmtext">Delete “{selectedList.name}” for the whole band?</p>
    <div class="confirmrow">
      <button use:focusOnMount onclick={() => (confirmDelete = false)}>Cancel</button>
      <button class="danger" onclick={doDelete}>Delete</button>
    </div>
  </div>
{/if}

<style>
  .picker { display: flex; flex-direction: column; height: 100%; background: var(--bg); }
  .phead {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    padding: 0.7rem 1rem;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  .brand { margin: 0; font-family: var(--font-display); font-size: 1.05rem; font-weight: 700; letter-spacing: 0.02em; }
  .ptitle { color: var(--muted); font-size: 0.82rem; flex: 1 1 auto; }
  .iconbtn { flex: 0 0 auto; width: 2rem; height: 2rem; display: inline-flex; align-items: center; justify-content: center; padding: 0; }

  /* List selector: set lists + "All songs", one shown at a time. */
  .tabs {
    display: flex;
    gap: 0.4rem;
    padding: 0.6rem 0.8rem;
    overflow-x: auto;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  .tab {
    flex: 0 0 auto;
    padding: 0.35rem 0.7rem;
    font-size: 0.82rem;
    white-space: nowrap;
  }
  .tab.active { border-color: var(--accent); color: var(--accent); }
  .tab.dragging { opacity: 0.6; border-style: dashed; }
  .newlist { color: var(--muted); border-style: dashed; }

  .pbody { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 0.5rem 0.8rem 1.2rem; }
  .listmeta {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    color: var(--muted);
    font-size: 0.74rem;
    font-variant-numeric: tabular-nums;
    padding: 0.3rem 0.2rem 0.5rem;
  }
  .editbtn { margin-left: auto; padding: 0.25rem 0.7rem; font-size: 0.78rem; }

  /* Edit mode header: rename, delete, done. */
  .editbar { display: flex; gap: 0.5rem; align-items: center; padding: 0.4rem 0 0.6rem; }
  .rename {
    flex: 1 1 auto;
    min-width: 0;
    font-family: var(--font-display);
    font-weight: 600;
    padding: 0.45rem 0.6rem;
  }
  .danger { color: #e05d5d; border-color: #e05d5d; }
  .donebtn { border-color: var(--accent); color: var(--accent); }

  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
  .entry.lifted .srow { border-color: var(--accent); box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35); }
  .srow {
    position: relative;
    overflow: hidden;
    width: 100%;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.7rem 0.8rem;
    min-height: 2.9rem; /* comfortable tap target */
    text-align: left;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  .srow:hover { border-color: var(--accent); }
  /* The currently-open song. */
  .srow.active { border-color: var(--accent); background: rgba(217, 138, 61, 0.1); }
  .editrow { align-items: center; }
  .handle {
    flex: 0 0 auto;
    cursor: grab;
    touch-action: none; /* a touch drag reorders; it must not scroll the list */
    padding: 0.3rem 0.55rem;
    font-size: 1rem;
    color: var(--muted);
  }
  .editrow .stitle { flex: 1 1 auto; }
  .removebtn { flex: 0 0 auto; padding: 0.3rem 0.55rem; color: var(--muted); }
  .removebtn:hover { color: #e05d5d; border-color: #e05d5d; }
  .stitle { font-family: var(--font-display); font-weight: 600; }
  .now { color: var(--accent); font-size: 0.7rem; font-weight: 600; margin-left: 0.4rem; white-space: nowrap; }
  .arr { color: var(--muted); font-size: 0.7rem; font-weight: 600; margin-left: 0.4rem; white-space: nowrap; border: 1px solid var(--line); border-radius: 999px; padding: 0.05rem 0.4rem; }
  .smeta { color: var(--muted); font-size: 0.82rem; font-variant-numeric: tabular-nums; white-space: nowrap; }
  /* Live playback progress along the bottom of the active row. */
  .prog {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 3px;
    background: var(--accent);
    transition: width 0.2s linear;
  }
  .empty { color: var(--muted); padding: 0.6rem 0.2rem; }

  /* Add panel (edit mode). */
  .addpanel { margin-top: 1.1rem; border-top: 1px solid var(--line); padding-top: 0.7rem; }
  .addhead { margin: 0 0 0.5rem; font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
  .addrow { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; padding: 0.3rem 0.2rem; }
  .variantrow { padding-left: 1rem; }
  .addtitle { font-size: 0.92rem; }
  .addbtn { flex: 0 0 auto; padding: 0.25rem 0.6rem; font-size: 0.78rem; }

  /* Delete confirmation. Above the picker slide-over (z 1002). */
  .confirm-scrim { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55); z-index: 1004; }
  .confirm {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 1005;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 1rem 1.1rem;
    width: min(92%, 22rem);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
  }
  .confirmtext { margin: 0 0 0.9rem; }
  .confirmrow { display: flex; justify-content: flex-end; gap: 0.5rem; }
</style>
