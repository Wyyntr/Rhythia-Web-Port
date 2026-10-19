import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMapFile } from '../src/formats';

const SUPPORTED = new Set(['.sspm', '.phxm', '.rhm', '.txt']);
const sampleDir = process.env['RHYTHIA_SAMPLES'] ?? join(process.cwd(), 'samples');

const files = existsSync(sampleDir)
  ? readdirSync(sampleDir).filter((name) => SUPPORTED.has(extname(name).toLowerCase()))
  : [];

const describeSamples = files.length > 0 ? describe : describe.skip;

/**
 * Parses real maps from a local, git-ignored `samples/` directory. This is how
 * the parsers get validated against actual files without redistributing maps.
 */
describeSamples('real map samples', () => {
  for (const fileName of files) {
    it(`parses ${fileName}`, () => {
      const bytes = new Uint8Array(readFileSync(join(sampleDir, fileName)));
      const map = parseMapFile({ name: fileName, bytes });

      expect(map.title.length).toBeGreaterThan(0);
      expect(map.notes.length).toBeGreaterThan(0);

      for (const note of map.notes) {
        expect(Number.isFinite(note.time)).toBe(true);
        expect(Number.isFinite(note.x)).toBe(true);
        expect(Number.isFinite(note.y)).toBe(true);
      }

      for (let i = 1; i < map.notes.length; i++) {
        expect(map.notes[i]!.time).toBeGreaterThanOrEqual(map.notes[i - 1]!.time);
      }
    });
  }
});

describe('format detection', () => {
  it('rejects unknown extensions', () => {
    expect(() =>
      parseMapFile({ name: 'notes.docx', bytes: new TextEncoder().encode('hello') }),
    ).toThrow(/Unsupported map file/);
  });

  it('detects SSPM files by magic when the extension is missing', () => {
    const bytes = new Uint8Array(8);
    bytes.set([0x53, 0x53, 0x2b, 0x6d, 0x02, 0x00, 0x00, 0x00]);
    expect(() => parseMapFile({ name: 'no-extension', bytes })).toThrow(/Unexpected end of file/);
  });
});
