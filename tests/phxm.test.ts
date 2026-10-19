import { describe, expect, it } from 'vitest';
import { parsePhxm } from '../src/formats/phxm';
import { MapParseError } from '../src/formats/util';
import { buildPhxm } from './builders';

const AUDIO = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]);
const COVER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('PHXM', () => {
  it('parses metadata, assets and notes', async () => {
    const map = parsePhxm(
      buildPhxm(
        [
          { time: 200, x: 1, y: -1 },
          { time: 100, x: -0.25, y: 0.75 },
          { time: 300, x: 0, y: 0 },
        ],
        {
          id: 'phxm-id',
          artist: 'Artist',
          title: 'Song',
          mappers: ['Mapper'],
          difficulty: 3,
          difficultyName: 'Hard',
          audio: AUDIO,
          cover: COVER,
        },
      ),
    );

    expect(map.format).toBe('phxm');
    expect(map.id).toBe('phxm-id');
    expect(map.artist).toBe('Artist');
    expect(map.title).toBe('Song');
    expect(map.mappers).toEqual(['Mapper']);
    expect(map.difficulty).toBe(3);
    expect(map.difficultyName).toBe('Hard');
    expect(map.notes).toEqual([
      { time: 100, x: -0.25, y: 0.75 },
      { time: 200, x: 1, y: -1 },
      { time: 300, x: 0, y: 0 },
    ]);
    expect(map.audio?.type).toBe('audio/mpeg');
    expect(new Uint8Array(await map.audio!.arrayBuffer())).toEqual(AUDIO);
    expect(map.cover?.type).toBe('image/png');
  });

  it('rejects a zip without map contents', () => {
    expect(() => parsePhxm(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toThrow(MapParseError);
  });
});
