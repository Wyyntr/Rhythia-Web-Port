import { zipSync } from 'fflate';

/** Test-only writers for building synthetic map files. */

export interface TestNote {
  time: number;
  /** Internal coordinate in [-1, 1]. */
  x: number;
  /** Internal coordinate in [-1, 1], positive is up. */
  y: number;
}

const encoder = new TextEncoder();

class ByteWriter {
  private parts: Uint8Array[] = [];

  get length(): number {
    return this.parts.reduce((total, part) => total + part.length, 0);
  }

  u8(value: number): void {
    this.parts.push(new Uint8Array([value & 0xff]));
  }

  u16(value: number): void {
    this.parts.push(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]));
  }

  u32(value: number): void {
    this.parts.push(
      new Uint8Array([
        value & 0xff,
        (value >>> 8) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 24) & 0xff,
      ]),
    );
  }

  u64(value: number): void {
    this.u32(value >>> 0);
    this.u32(Math.floor(value / 2 ** 32));
  }

  f32(value: number): void {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer as ArrayBuffer).setFloat32(0, value, true);
    this.parts.push(bytes);
  }

  raw(bytes: Uint8Array): void {
    this.parts.push(bytes);
  }

  string(value: string): void {
    this.parts.push(encoder.encode(value));
  }

  string16(value: string): void {
    const bytes = encoder.encode(value);
    this.u16(bytes.length);
    this.raw(bytes);
  }

  line(value: string): void {
    this.string(value);
    this.u8(0x0a);
  }

  toUint8Array(): Uint8Array {
    const result = new Uint8Array(this.length);
    let offset = 0;
    for (const part of this.parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  }
}

function isQuantum(note: TestNote): boolean {
  const rawX = note.x + 1;
  const rawY = 1 - note.y;
  return !Number.isInteger(rawX) || !Number.isInteger(rawY);
}

export interface SspmOptions {
  id?: string;
  mapName?: string;
  mappers?: string[];
  difficulty?: number;
  difficultyName?: string;
  starRating?: number;
  audio?: Uint8Array;
  cover?: Uint8Array;
}

export function buildSspmV1(notes: TestNote[], options: SspmOptions = {}): Uint8Array {
  const writer = new ByteWriter();
  writer.string('SS+m');
  writer.u16(1);
  writer.u16(0);
  writer.line(options.id ?? 'test-map');
  writer.line(options.mapName ?? 'Test Artist - Test Song');
  writer.line((options.mappers ?? ['Tester']).join('&'));
  writer.u32(Math.max(0, ...notes.map((note) => note.time)));
  writer.u32(notes.length);
  writer.u8(options.difficulty ?? 3);

  if (options.cover) {
    writer.u8(2);
    writer.u64(options.cover.length);
    writer.raw(options.cover);
  } else {
    writer.u8(0);
  }

  if (options.audio) {
    writer.u8(1);
    writer.u64(options.audio.length);
    writer.raw(options.audio);
  } else {
    writer.u8(0);
  }

  for (const note of notes) {
    const quantum = isQuantum(note);
    const rawX = note.x + 1;
    const rawY = 1 - note.y;
    writer.u32(note.time);
    writer.u8(quantum ? 1 : 0);
    if (quantum) {
      writer.f32(rawX);
      writer.f32(rawY);
    } else {
      writer.u8(rawX);
      writer.u8(rawY);
    }
  }

  return writer.toUint8Array();
}

const NOTE_DEFINITION = new Uint8Array([
  0x01, // one definition
  0x08, 0x00, 0x73, 0x73, 0x70, 0x5f, 0x6e, 0x6f, 0x74, 0x65, // "ssp_note"
  0x01, 0x07, // one position value
  0x00, // end of value list
]);

export function buildSspmV2(notes: TestNote[], options: SspmOptions = {}): Uint8Array {
  const markerWriter = new ByteWriter();
  for (const note of notes) {
    const quantum = isQuantum(note);
    const rawX = note.x + 1;
    const rawY = 1 - note.y;
    markerWriter.u32(note.time);
    markerWriter.u8(0); // definition index: ssp_note
    markerWriter.u8(quantum ? 1 : 0);
    if (quantum) {
      markerWriter.f32(rawX);
      markerWriter.f32(rawY);
    } else {
      markerWriter.u8(rawX);
      markerWriter.u8(rawY);
    }
  }
  const markers = markerWriter.toUint8Array();

  const customWriter = new ByteWriter();
  const fields: Array<[string, string]> = [];
  if (options.difficultyName) fields.push(['difficulty_name', options.difficultyName]);
  customWriter.u16(fields.length);
  for (const [id, value] of fields) {
    customWriter.string16(id);
    customWriter.u8(0x09); // string
    customWriter.string16(value);
  }
  const custom = customWriter.toUint8Array();

  const metadata = new ByteWriter();
  metadata.string16(options.id ?? 'test-map');
  metadata.string16(options.mapName ?? 'Test Artist - Test Song');
  metadata.string16(options.mapName ?? 'Test Artist - Test Song');
  metadata.u16(options.mappers?.length ?? 1);
  for (const mapper of options.mappers ?? ['Tester']) {
    metadata.string16(mapper);
  }
  const metadataBytes = metadata.toUint8Array();

  const headerSize = 128;
  const customOffset = headerSize + metadataBytes.length;
  const audioOffset = options.audio ? customOffset + custom.length : 0;
  const audioLength = options.audio?.length ?? 0;
  const coverOffset = options.cover ? (options.audio ? audioOffset + audioLength : customOffset + custom.length) : 0;
  const coverLength = options.cover?.length ?? 0;
  const defsOffset = customOffset + custom.length + audioLength + coverLength;
  const markersOffset = defsOffset + NOTE_DEFINITION.length;

  const header = new ByteWriter();
  header.string('SS+m');
  header.u16(2);
  header.u32(0);
  header.raw(new Uint8Array(20)); // sha1 (not validated by the parser)
  header.u32(Math.max(0, ...notes.map((note) => note.time)));
  header.u32(notes.length);
  header.u32(notes.length);
  header.u8(options.difficulty ?? 3);
  header.u16(options.starRating ?? 0);
  header.u8(options.audio ? 1 : 0);
  header.u8(options.cover ? 1 : 0);
  header.u8(0); // requires mod
  header.u64(customOffset);
  header.u64(custom.length);
  header.u64(audioOffset);
  header.u64(audioLength);
  header.u64(coverOffset);
  header.u64(coverLength);
  header.u64(defsOffset);
  header.u64(NOTE_DEFINITION.length);
  header.u64(markersOffset);
  header.u64(markers.length);
  header.raw(metadataBytes);

  const file = new ByteWriter();
  file.raw(header.toUint8Array());
  file.raw(custom);
  if (options.audio) file.raw(options.audio);
  if (options.cover) file.raw(options.cover);
  file.raw(NOTE_DEFINITION);
  file.raw(markers);
  return file.toUint8Array();
}

export interface PhxmOptions {
  id?: string;
  artist?: string;
  title?: string;
  mappers?: string[];
  difficulty?: number;
  difficultyName?: string;
  length?: number;
  audio?: Uint8Array;
  cover?: Uint8Array;
}

export function buildPhxm(notes: TestNote[], options: PhxmOptions = {}): Uint8Array {
  const objects = new ByteWriter();
  objects.u32(12);
  objects.u32(notes.length);
  for (const note of notes) {
    const quantum = !Number.isInteger(note.x) || !Number.isInteger(note.y);
    objects.u32(note.time);
    objects.u8(quantum ? 1 : 0);
    if (quantum) {
      objects.f32(note.x);
      objects.f32(note.y);
    } else {
      objects.u8(note.x + 1);
      objects.u8(note.y + 1);
    }
  }
  for (let i = 0; i < 11; i++) objects.u32(0); // timing points and effects sections

  const metadata = {
    ID: options.id ?? 'phxm-test',
    Artist: options.artist ?? 'Test Artist',
    Title: options.title ?? 'Test Song',
    Mappers: options.mappers ?? ['Tester'],
    Difficulty: options.difficulty ?? 2,
    DifficultyName: options.difficultyName ?? 'Test',
    Length: options.length ?? Math.max(0, ...notes.map((note) => note.time)),
    HasAudio: Boolean(options.audio),
    AudioExt: 'mp3',
    HasCover: Boolean(options.cover),
    HasVideo: false,
    ArtistLink: '',
    ArtistPlatform: '',
  };

  const files: Record<string, Uint8Array> = {
    'metadata.json': encoder.encode(JSON.stringify(metadata)),
    'objects.phxmo': objects.toUint8Array(),
  };
  if (options.audio) files['audio.mp3'] = options.audio;
  if (options.cover) files['cover.png'] = options.cover;

  return zipSync(files);
}

export interface RhmOptions {
  title?: string;
  mappers?: string[];
  difficulty?: number;
  difficultyName?: string;
  legacyId?: string;
  audio?: Uint8Array;
  cover?: Uint8Array;
}

export function buildRhm(notes: TestNote[], options: RhmOptions = {}): Uint8Array {
  const map = {
    Title: options.title ?? 'Test Artist - Test Song',
    Mappers: options.mappers ?? ['Tester'],
    Difficulty: options.difficulty ?? 1,
    CustomDifficultyName: options.difficultyName ?? 'Test',
    LegacyId: options.legacyId ?? 'rhm-test',
    AudioFileName: 'audio',
    ImagePath: 'cover',
    Notes: notes.map((note) => ({
      Time: note.time,
      X: note.x + 1,
      Y: 1 - note.y,
    })),
  };

  const files: Record<string, Uint8Array> = {
    map: encoder.encode(JSON.stringify(map)),
  };
  if (options.audio) files['audio'] = options.audio;
  if (options.cover) files['cover'] = options.cover;

  return zipSync(files);
}
