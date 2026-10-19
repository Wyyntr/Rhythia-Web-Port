import { BinaryReader } from './binary';
import { makeAudioBlob, makeImageBlob } from './blobs';
import type { MapData, Note } from './types';
import { MapParseError, readLength, splitArtistTitle, splitMappers } from './util';

const MAGIC = 'SS+m';

const DataType = {
  End: 0x00,
  U8: 0x01,
  U16: 0x02,
  U32: 0x03,
  U64: 0x04,
  F32: 0x05,
  F64: 0x06,
  Position: 0x07,
  Buffer: 0x08,
  String: 0x09,
  LongBuffer: 0x0a,
  LongString: 0x0b,
  Array: 0x0c,
} as const;

interface PositionValue {
  kind: 'position';
  x: number;
  y: number;
  quantum: boolean;
}

type CustomValue = number | string | Uint8Array | PositionValue | CustomValue[];

interface MarkerDefinition {
  id: string;
  types: number[];
}

export function parseSspm(bytes: Uint8Array): MapData {
  const reader = new BinaryReader(bytes);
  if (reader.utf8(4) !== MAGIC) {
    throw new MapParseError('Not an SSPM file (bad file signature)');
  }

  const version = reader.u16();
  switch (version) {
    case 1:
      return parseV1(reader);
    case 2:
      return parseV2(reader);
    default:
      throw new MapParseError(`Unsupported SSPM version ${version}`);
  }
}

function parseV1(reader: BinaryReader): MapData {
  reader.skip(2); // reserved

  const id = reader.line().trim();
  const mapName = reader.line();
  const mappers = splitMappers(reader.line());
  const lengthMs = reader.u32();
  const noteCount = reader.u32();
  const difficulty = reader.u8();

  const hasCover = reader.u8() === 2;
  const cover = hasCover ? makeImageBlob(reader.read(readLength(reader.u64()))) : null;

  const hasAudio = reader.u8() === 1;
  const audio = hasAudio ? makeAudioBlob(reader.read(readLength(reader.u64()))) : null;

  const notes = readV1Notes(reader, noteCount);
  const { artist, title } = splitArtistTitle(mapName);

  return {
    format: 'sspm-v1',
    id: id || null,
    artist,
    title,
    mappers,
    difficulty,
    difficultyName: null,
    starRating: null,
    lengthMs: lengthMs || notes.at(-1)?.time || 0,
    notes,
    audio,
    cover,
  };
}

function readV1Notes(reader: BinaryReader, count: number): Note[] {
  const notes: Note[] = [];
  for (let i = 0; i < count; i++) {
    const time = reader.u32();
    const quantum = reader.u8() === 1;
    const rawX = quantum ? reader.f32() : reader.u8();
    const rawY = quantum ? reader.f32() : reader.u8();
    notes.push(toNote(time, rawX, rawY));
  }
  return sortNotes(notes);
}

function parseV2(reader: BinaryReader): MapData {
  reader.skip(4); // reserved
  reader.skip(20); // sha1 of marker definition + marker blocks

  const lengthMs = reader.u32();
  const noteCount = reader.u32();
  const markerCount = reader.u32();
  const difficulty = reader.u8();
  const starRating = reader.u16();
  const hasAudio = reader.u8() === 1;
  const hasCover = reader.u8() === 1;
  reader.skip(1); // requires a game mod

  const customOffset = reader.u64();
  const customLength = reader.u64();
  const audioOffset = reader.u64();
  const audioLength = reader.u64();
  const coverOffset = reader.u64();
  const coverLength = reader.u64();
  const definitionsOffset = reader.u64();
  const definitionsLength = reader.u64();
  const markersOffset = reader.u64();
  reader.skip(8); // marker byte length (derived from markerCount instead)

  const id = reader.string16().trim();
  const mapName = reader.string16();
  const songName = reader.string16();

  const mapperCount = reader.u16();
  const mappers: string[] = [];
  for (let i = 0; i < mapperCount; i++) {
    mappers.push(reader.string16().trim());
  }

  const custom = readCustomData(reader, customOffset, customLength);
  const difficultyName = typeof custom.get('difficulty_name') === 'string'
    ? (custom.get('difficulty_name') as string)
    : null;

  const audio = hasAudio && audioLength > 0 && audioOffset > 0
    ? makeAudioBlob(sliceBlock(reader, audioOffset, audioLength))
    : null;
  const cover = hasCover && coverLength > 0 && coverOffset > 0
    ? makeImageBlob(sliceBlock(reader, coverOffset, coverLength))
    : null;

  const definitions = readMarkerDefinitions(reader, definitionsOffset, definitionsLength);
  const notes = readV2Markers(reader, markersOffset, noteCount, markerCount, definitions);

  const { artist, title } = splitArtistTitle(mapName || songName);

  return {
    format: 'sspm-v2',
    id: id || null,
    artist,
    title,
    mappers,
    difficulty,
    difficultyName,
    starRating,
    lengthMs: lengthMs || notes.at(-1)?.time || 0,
    notes,
    audio,
    cover,
  };
}

function readV2Markers(
  reader: BinaryReader,
  offset: number,
  noteCount: number,
  markerCount: number,
  definitions: MarkerDefinition[],
): Note[] {
  if (definitions.length === 0) {
    throw new MapParseError('SSPM v2 file has no marker definitions');
  }

  reader.seek(offset);
  const notes: Note[] = [];
  const count = Math.max(noteCount, markerCount);

  for (let i = 0; i < count; i++) {
    const time = reader.u32();
    const definitionIndex = reader.u8();
    const definition = definitions[definitionIndex];
    if (!definition) {
      throw new MapParseError(`Unknown marker definition ${definitionIndex} at marker ${i}`);
    }

    const values = definition.types.map((type) => readMarkerValue(reader, type));
    const position = values.find((value): value is PositionValue => isPosition(value));

    if (position) {
      notes.push(toNote(time, position.x, position.y));
    }
  }

  return sortNotes(notes);
}

function readMarkerValue(reader: BinaryReader, type: number): CustomValue {
  if (type === DataType.Array) {
    throw new MapParseError('Arrays are not allowed inside markers');
  }
  return readValue(reader, type);
}

function readMarkerDefinitions(
  reader: BinaryReader,
  offset: number,
  length: number,
): MarkerDefinition[] {
  if (offset <= 0 || length <= 0) {
    throw new MapParseError('SSPM v2 file has no marker definitions');
  }

  reader.seek(offset);
  const count = reader.u8();
  const definitions: MarkerDefinition[] = [];

  for (let i = 0; i < count; i++) {
    const id = reader.string16();
    const valueCount = reader.u8();
    const types: number[] = [];
    for (let value = 0; value < valueCount; value++) {
      types.push(reader.u8());
    }
    const end = reader.u8();
    if (end !== DataType.End) {
      throw new MapParseError(`Marker definition "${id}" is not terminated`);
    }
    definitions.push({ id, types });
  }

  return definitions;
}

function readCustomData(reader: BinaryReader, offset: number, length: number): Map<string, CustomValue> {
  const fields = new Map<string, CustomValue>();
  if (offset <= 0 || length < 2 || offset >= reader.length) {
    return fields;
  }

  reader.seek(offset);
  const count = reader.u16();
  for (let i = 0; i < count; i++) {
    const id = reader.string16();
    const type = reader.u8();
    fields.set(id, readValue(reader, type));
  }
  return fields;
}

function readValue(reader: BinaryReader, type: number): CustomValue {
  switch (type) {
    case DataType.U8:
      return reader.u8();
    case DataType.U16:
      return reader.u16();
    case DataType.U32:
      return reader.u32();
    case DataType.U64:
      return reader.u64();
    case DataType.F32:
      return reader.f32();
    case DataType.F64:
      return reader.f64();
    case DataType.Position:
      return readPosition(reader);
    case DataType.Buffer:
      return reader.read(reader.u16());
    case DataType.String:
      return reader.string16();
    case DataType.LongBuffer:
      return reader.read(readLength(reader.u32()));
    case DataType.LongString:
      return reader.string32();
    case DataType.Array: {
      const elementType = reader.u8();
      const byteLength = reader.u32();
      const count = reader.u16();
      const start = reader.offset;
      const values: CustomValue[] = [];
      for (let i = 0; i < count; i++) {
        values.push(readValue(reader, elementType));
      }
      const consumed = reader.offset - start;
      if (consumed !== byteLength) {
        reader.seek(start + byteLength);
      }
      return values;
    }
    default:
      throw new MapParseError(`Unknown value type 0x${type.toString(16)}`);
  }
}

function readPosition(reader: BinaryReader): PositionValue {
  const flag = reader.u8();
  if (flag === 0) {
    return { kind: 'position', x: reader.u8(), y: reader.u8(), quantum: false };
  }
  if (flag === 1) {
    return { kind: 'position', x: reader.f32(), y: reader.f32(), quantum: true };
  }
  throw new MapParseError(`Invalid position encoding 0x${flag.toString(16)}`);
}

function isPosition(value: CustomValue): value is PositionValue {
  return typeof value === 'object' && value !== null && !(value instanceof Uint8Array)
    && (value as PositionValue).kind === 'position';
}

/** SSPM stores 0..2 grid coordinates with the Y axis pointing down. */
function toNote(time: number, rawX: number, rawY: number): Note {
  return { time, x: rawX - 1, y: 1 - rawY };
}

function sortNotes(notes: Note[]): Note[] {
  return notes.sort((a, b) => a.time - b.time);
}

function sliceBlock(reader: BinaryReader, offset: number, length: number): Uint8Array {
  if (offset + length > reader.length) {
    throw new MapParseError('Map asset block extends past the end of the file');
  }
  return reader.bytes.subarray(offset, offset + length);
}
