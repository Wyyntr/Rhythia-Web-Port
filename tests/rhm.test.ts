import { describe, expect, it } from 'vitest';
import { parseRhm } from '../src/formats/rhm';
import { MapParseError } from '../src/formats/util';
import { buildRhm } from './builders';

const AUDIO = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02]);

describe('RHM', () => {
  it('parses map JSON, notes and assets', async () => {
    const map = parseRhm(
      buildRhm(
        [
          { time: 500, x: 0.5, y: 0 },
          { time: 100, x: -1, y: 1 },
          { time: 250, x: 1, y: -1 },
        ],
        {
          title: 'Composer - Long Song - Deluxe',
          mappers: ['A', 'B'],
          difficulty: 5,
          difficultyName: 'Tasukete',
          legacyId: 'legacy-id',
          audio: AUDIO,
        },
      ),
    );

    expect(map.format).toBe('rhm');
    expect(map.id).toBe('legacy-id');
    expect(map.artist).toBe('Composer');
    expect(map.title).toBe('Long Song - Deluxe');
    expect(map.mappers).toEqual(['A', 'B']);
    expect(map.difficulty).toBe(5);
    expect(map.difficultyName).toBe('Tasukete');
    expect(map.lengthMs).toBe(500);
    expect(map.notes).toEqual([
      { time: 100, x: -1, y: 1 },
      { time: 250, x: 1, y: -1 },
      { time: 500, x: 0.5, y: 0 },
    ]);
    expect(map.audio?.type).toBe('audio/ogg');
    expect(new Uint8Array(await map.audio!.arrayBuffer())).toEqual(AUDIO);
  });

  it('rejects archives without a map entry', () => {
    expect(() => parseRhm(new Uint8Array([0x50, 0x4b, 0x05, 0x06]))).toThrow(MapParseError);
  });
});
