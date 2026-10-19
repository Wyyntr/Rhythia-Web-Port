import { describe, expect, it } from 'vitest';
import { parseSspm } from '../src/formats/sspm';
import { MapParseError } from '../src/formats/util';
import { buildSspmV1, buildSspmV2, type TestNote } from './builders';

const OGG = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x01, 0x02, 0x03]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x07, 0x08]);

async function blobBytes(blob: Blob | null): Promise<Uint8Array | null> {
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

describe('SSPM v2', () => {
  it('parses integer and quantum notes with metadata and assets', async () => {
    const notes: TestNote[] = [
      { time: 400, x: 0.5, y: -0.5 },
      { time: 100, x: -1, y: 1 },
      { time: 250, x: 0, y: 0 },
    ];

    const map = parseSspm(
      buildSspmV2(notes, {
        id: 'abc',
        mapName: 'Some Artist - Some Song',
        mappers: ['One', 'Two'],
        difficulty: 4,
        difficultyName: 'Extra',
        starRating: 21,
        audio: OGG,
        cover: PNG,
      }),
    );

    expect(map.format).toBe('sspm-v2');
    expect(map.id).toBe('abc');
    expect(map.artist).toBe('Some Artist');
    expect(map.title).toBe('Some Song');
    expect(map.mappers).toEqual(['One', 'Two']);
    expect(map.difficulty).toBe(4);
    expect(map.difficultyName).toBe('Extra');
    expect(map.starRating).toBe(21);
    expect(map.lengthMs).toBe(400);
    expect(map.notes).toEqual([
      { time: 100, x: -1, y: 1 },
      { time: 250, x: 0, y: 0 },
      { time: 400, x: 0.5, y: -0.5 },
    ]);
    expect(map.audio?.type).toBe('audio/ogg');
    expect(await blobBytes(map.audio)).toEqual(OGG);
    expect(map.cover?.type).toBe('image/png');
    expect(await blobBytes(map.cover)).toEqual(PNG);
  });

  it('handles maps without audio or cover', () => {
    const map = parseSspm(buildSspmV2([{ time: 10, x: 0, y: 0 }]));
    expect(map.audio).toBeNull();
    expect(map.cover).toBeNull();
  });

  it('rejects bad signatures', () => {
    expect(() => parseSspm(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(MapParseError);
  });

  it('rejects unknown versions', () => {
    const file = new Uint8Array(10);
    file.set([0x53, 0x53, 0x2b, 0x6d], 0);
    file[4] = 9;
    expect(() => parseSspm(file)).toThrow(/Unsupported SSPM version/);
  });
});

describe('SSPM v1', () => {
  it('parses metadata, assets and notes', async () => {
    const notes: TestNote[] = [
      { time: 30, x: 0, y: 0 },
      { time: 10, x: -1, y: -1 },
      { time: 20, x: 1, y: 1 },
    ];

    const map = parseSspm(
      buildSspmV1(notes, {
        id: 'legacy',
        mapName: 'Artist - Song',
        mappers: ['Mapper A', 'Mapper B'],
        difficulty: 2,
        audio: OGG,
        cover: PNG,
      }),
    );

    expect(map.format).toBe('sspm-v1');
    expect(map.id).toBe('legacy');
    expect(map.artist).toBe('Artist');
    expect(map.title).toBe('Song');
    expect(map.mappers).toEqual(['Mapper A', 'Mapper B']);
    expect(map.difficulty).toBe(2);
    expect(map.lengthMs).toBe(30);
    expect(map.notes).toEqual([
      { time: 10, x: -1, y: -1 },
      { time: 20, x: 1, y: 1 },
      { time: 30, x: 0, y: 0 },
    ]);
    expect(await blobBytes(map.audio)).toEqual(OGG);
    expect(await blobBytes(map.cover)).toEqual(PNG);
  });

  it('parses maps without assets', () => {
    const map = parseSspm(buildSspmV1([{ time: 5, x: 0, y: 0 }], { mapName: 'No separator' }));
    expect(map.artist).toBeNull();
    expect(map.title).toBe('No separator');
    expect(map.audio).toBeNull();
    expect(map.cover).toBeNull();
  });
});
