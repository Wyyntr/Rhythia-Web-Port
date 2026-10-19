import { parsePhxm } from './phxm';
import { parseRhm } from './rhm';
import { parseSspm } from './sspm';
import { parseTxt } from './txt';
import type { MapData, MapFormat, MapSourceFile } from './types';
import { MapParseError, getExtension } from './util';

export * from './types';
export { MapParseError } from './util';
export { parsePhxm, parseRhm, parseSspm, parseTxt };

const decoder = new TextDecoder();

/**
 * Determines the map format from the file extension, falling back to magic
 * bytes for extension-less files.
 */
export function detectFormat(file: MapSourceFile): MapFormat {
  const ext = getExtension(file.name);
  const magic = decoder.decode(file.bytes.subarray(0, 4));

  switch (ext) {
    case 'sspm':
      if (magic !== 'SS+m') {
        throw new MapParseError(`"${file.name}" does not look like an SSPM file`);
      }
      return sspmVersion(file.bytes) === 1 ? 'sspm-v1' : 'sspm-v2';
    case 'phxm':
      return 'phxm';
    case 'rhm':
      return 'rhm';
    case 'txt':
      return 'txt';
    default:
      break;
  }

  if (magic === 'SS+m') {
    return sspmVersion(file.bytes) === 1 ? 'sspm-v1' : 'sspm-v2';
  }
  if (magic === 'PK\u0003\u0004') {
    throw new MapParseError(
      `"${file.name}" is a ZIP-based map; give it a .phxm or .rhm extension so it can be identified`,
    );
  }
  throw new MapParseError(`Unsupported map file "${file.name}"`);
}

export function parseMapFile(
  file: MapSourceFile,
  options: { audio?: Blob | null } = {},
): MapData {
  const format = detectFormat(file);

  switch (format) {
    case 'sspm-v1':
    case 'sspm-v2':
      return parseSspm(file.bytes);
    case 'phxm':
      return parsePhxm(file.bytes);
    case 'rhm':
      return parseRhm(file.bytes);
    case 'txt':
      return parseTxt(file.bytes, { audio: options.audio ?? null, fileName: file.name });
  }
}

function sspmVersion(bytes: Uint8Array): number {
  return (bytes[4] ?? 0) | ((bytes[5] ?? 0) << 8);
}
