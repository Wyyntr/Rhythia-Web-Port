import { unzipSync } from 'fflate';
import { BinaryReader } from './binary';
import { makeAudioBlob, makeImageBlob } from './blobs';
import type { MapData, Note } from './types';
import { MapParseError, decodeUtf8 } from './util';

/**
 * .phxm maps are ZIP archives:
 *   metadata.json
 *   objects.phxmo  (binary note data)
 *   audio.<ext>
 *   cover.png
 *   video.mp4      (optional)
 */
export function parsePhxm(bytes: Uint8Array): MapData {
  const entries = unzip(bytes, 'PHXM');

  const metadataBytes = entries.get('metadata.json');
  if (!metadataBytes) {
    throw new MapParseError('PHXM archive is missing metadata.json');
  }

  const objectsBytes = entries.get('objects.phxmo');
  if (!objectsBytes) {
    throw new MapParseError('PHXM archive is missing objects.phxmo');
  }

  let metadata: Record<string, unknown>;
  try {
    metadata = JSON.parse(decodeUtf8(metadataBytes)) as Record<string, unknown>;
  } catch {
    throw new MapParseError('PHXM metadata.json is not valid JSON');
  }

  const notes = decodePhxmo(objectsBytes);
  const audioExt = asString(metadata['AudioExt'], 'mp3');
  const audioBytes = asBool(metadata['HasAudio'], true)
    ? entries.get(`audio.${audioExt}`) ?? entries.get('audio')
    : undefined;
  const coverBytes = asBool(metadata['HasCover'], false)
    ? entries.get('cover.png') ?? entries.get('cover')
    : undefined;

  return {
    format: 'phxm',
    id: asString(metadata['ID']) || null,
    artist: asString(metadata['Artist']) || null,
    title: asString(metadata['Title']) || 'Unknown map',
    mappers: asStringArray(metadata['Mappers']),
    difficulty: asNumber(metadata['Difficulty'], 0),
    difficultyName: asString(metadata['DifficultyName']) || null,
    starRating: asNumberOrNull(metadata['StarRating']),
    lengthMs: asNumber(metadata['Length'], notes.at(-1)?.time ?? 0),
    notes,
    audio: audioBytes ? makeAudioBlob(audioBytes) : null,
    cover: coverBytes ? makeImageBlob(coverBytes) : null,
  };
}

/**
 * objects.phxmo layout:
 *   u32 version, u32 note count, then (u32 ms, u8 quantum, position) per note.
 * Positions are stored in -1..1 grid coordinates (quantum floats) or 0..2 bytes.
 * The sections after the notes (timing points, effects) are not needed yet.
 */
export function decodePhxmo(bytes: Uint8Array): Note[] {
  const reader = new BinaryReader(bytes);
  reader.u32(); // format version

  const count = reader.u32();
  const notes: Note[] = [];
  for (let i = 0; i < count; i++) {
    const time = reader.u32();
    const quantum = reader.u8() === 1;
    const x = quantum ? reader.f32() : reader.u8() - 1;
    const y = quantum ? reader.f32() : reader.u8() - 1;
    notes.push({ time, x, y });
  }

  return notes.sort((a, b) => a.time - b.time);
}

function unzip(bytes: Uint8Array, format: string): Map<string, Uint8Array> {
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(bytes);
  } catch {
    throw new MapParseError(`${format} file is not a valid ZIP archive`);
  }

  const entries = new Map<string, Uint8Array>();
  for (const [name, contents] of Object.entries(raw)) {
    if (!name.endsWith('/')) {
      entries.set(name, contents);
    }
  }
  return entries;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim());
}
