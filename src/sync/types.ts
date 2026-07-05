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
