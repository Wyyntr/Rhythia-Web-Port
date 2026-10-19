import type { MapData, Note } from './types';
import { MapParseError, decodeUtf8, getBaseName } from './util';

/**
 * Legacy SSMap v1 text maps. The official client reads a single CSV line:
 *   <header>,<x>|<y>|<ms>,<x>|<y>|<ms>,...
 * where x/y are 0..2 grid coordinates with Y pointing down.
 *
 * Audio is not embedded in this format; the importer may pair a separate file.
 */
export function parseTxt(
  bytes: Uint8Array,
  options: { audio?: Blob | null; fileName?: string } = {},
): MapData {
  const text = decodeUtf8(bytes);
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  if (!firstLine.trim()) {
    throw new MapParseError('TXT map is empty');
  }

  const tokens = firstLine.split(',');
  if (tokens.length < 2) {
    throw new MapParseError('TXT map has no notes');
  }

  const notes: Note[] = [];
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]!.trim();
    if (!token) continue;

    const parts = token.split('|');
    if (parts.length < 3) {
      throw new MapParseError(`Invalid note "${token}" in TXT map`);
    }

    const rawX = Number.parseFloat(parts[0]!);
    const rawY = Number.parseFloat(parts[1]!);
    const time = Number.parseFloat(parts[2]!);
    if (!Number.isFinite(rawX) || !Number.isFinite(rawY) || !Number.isFinite(time)) {
      throw new MapParseError(`Invalid note "${token}" in TXT map`);
    }

    notes.push({ time, x: -rawX + 1, y: rawY - 1 });
  }

  notes.sort((a, b) => a.time - b.time);

  return {
    format: 'txt',
    id: null,
    artist: null,
    title: options.fileName ? getBaseName(options.fileName) : 'Unknown map',
    mappers: [],
    difficulty: 0,
    difficultyName: null,
    starRating: null,
    lengthMs: notes.at(-1)?.time ?? 0,
    notes,
    audio: options.audio ?? null,
    cover: null,
  };
}
