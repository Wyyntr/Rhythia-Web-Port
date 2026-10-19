import { describe, expect, it } from 'vitest';
import { parseMapFile } from '../src/formats';
import { parseTxt } from '../src/formats/txt';
import { MapParseError } from '../src/formats/util';

const text = new TextEncoder().encode('v1,0|2|100,2|0|250,1|1|175');

describe('legacy TXT maps', () => {
  it('parses 0..2 grid coordinates', () => {
    const map = parseTxt(text, { fileName: 'My Map.txt' });

    expect(map.format).toBe('txt');
    expect(map.title).toBe('My Map');
    expect(map.notes).toEqual([
      { time: 100, x: 1, y: 1 },
      { time: 175, x: 0, y: 0 },
      { time: 250, x: -1, y: -1 },
    ]);
  });

  it('uses a supplied audio file', async () => {
    const audio = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' });
    const map = parseMapFile({ name: 'Song.txt', bytes: text }, { audio });
    expect(map.audio).toBe(audio);
  });

  it('rejects empty files', () => {
    expect(() => parseTxt(new Uint8Array())).toThrow(MapParseError);
  });
});
