import { unzipSync } from 'fflate';
import { makeAudioBlob, makeImageBlob } from './blobs';
import type { MapData, Note } from './types';
import { MapParseError, decodeUtf8, splitArtistTitle } from './util';

/**
 * .rhm maps are ZIP archives containing:
 *   map         (UTF-8 JSON)
 *   audio       (mp3/ogg)
 *   cover       (png)
 *
 * Note coordinates in the JSON use the 0..2 grid with Y pointing down.
 */
export function parseRhm(bytes: Uint8Array): MapData {
  const entries = unzip(bytes, 'RHM');

  const mapBytes = entries.get('map');
  if (!mapBytes) {
    throw new MapParseError("RHM archive is missing the 'map' entry");
  }

  let map: Record<string, unknown>;
  try {
    map = JSON.parse(decodeUtf8(mapBytes)) as Record<string, unknown>;
  } catch {
    throw new MapParseError('RHM map entry is not valid JSON');
  }

  const rawNotes = map['Notes'];
  if (!Array.isArray(rawNotes)) {
    throw new MapParseError('RHM map has no Notes array');
  }

  const notes: Note[] = [];
  for (const raw of rawNotes) {
    if (typeof raw !== 'object' || raw === null) continue;
    const note = raw as Record<string, unknown>;
    const time = asNumber(note['Time'], NaN);
    const x = asNumber(note['X'], NaN);
    const y = asNumber(note['Y'], NaN);
    if (!Number.isFinite(time) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    notes.push({ time, x: x - 1, y: 1 - y });
  }
  notes.sort((a, b) => a.time - b.time);

  const title = asString(map['Title']) || asString(map['SongName']) || 'Unknown map';
  const { artist, title: songTitle } = splitArtistTitle(title);

  const audio = entries.get('audio')
    ?? entries.get(asString(map['AudioFileName']))
    ?? undefined;
  const cover = entries.get(asString(map['ImagePath']))
    ?? entries.get('cover')
    ?? undefined;

  return {
    format: 'rhm',
    id: asString(map['LegacyId']) || asString(map['OnlineId']) || null,
    artist,
    title: songTitle,
    mappers: asStringArray(map['Mappers']),
    difficulty: asNumber(map['Difficulty'], 0),
    difficultyName: asString(map['CustomDifficultyName']) || null,
    starRating: asNumberOrNull(map['StarRating']),
    lengthMs: notes.at(-1)?.time ?? 0,
    notes,
    audio: audio ? makeAudioBlob(audio) : null,
    cover: cover ? makeImageBlob(cover) : null,
  };
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

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim());
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
