export interface Note {
  /** Hit time in milliseconds from the start of the map. */
  time: number;
  /** Horizontal grid position in [-1, 1]; 0 is the centre column. */
  x: number;
  /** Vertical grid position in [-1, 1]; 0 is the centre row and positive is up. */
  y: number;
}

export type MapFormat = 'sspm-v1' | 'sspm-v2' | 'phxm' | 'rhm' | 'txt';

export interface MapData {
  format: MapFormat;
  id: string | null;
  artist: string | null;
  title: string;
  mappers: string[];
  /** Difficulty group: 0 = N/A, 1 = Easy, 2 = Medium, 3 = Hard, 4 = Logic, 5 = Tasukete. */
  difficulty: number;
  difficultyName: string | null;
  starRating: number | null;
  lengthMs: number;
  notes: Note[];
  audio: Blob | null;
  cover: Blob | null;
}

export interface MapSourceFile {
  name: string;
  bytes: Uint8Array;
}
