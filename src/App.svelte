<script lang="ts">
  import ChordChangesView from './views/ChordChangesView.svelte';
  import { createLocalSessionStore } from './session/store';

  // Hardcoded for the single-tune slice; library-browsing (M1, last step) will pick this.
  const SONG = {
    id: 'big-john-mcneil',
    url: `${import.meta.env.BASE_URL}songs/big-john-mcneil.musicxml`,
    title: 'Big John McNeil',
  };

  // The app owns the session (a session of one in M1); the view consumes it and
  // local-transport is the sole writer of its Transport. In M2 this same store is
  // swapped for a CRDT-backed one with no change to the view or transport.
  const store = createLocalSessionStore({ currentSongId: SONG.id });
</script>

<ChordChangesView song={SONG} {store} />
