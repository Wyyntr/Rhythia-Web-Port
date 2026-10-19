import { makeBlob } from '../formats/blobs';
import { parseMapFile } from '../formats';
import type { MapData } from '../formats/types';
import { getBaseName, getExtension } from '../formats/util';
import { makeMapKey } from '../storage/mapKey';

const MAP_EXTENSIONS = new Set(['sspm', 'phxm', 'rhm', 'txt']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'ogg', 'wav', 'flac']);

const AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  flac: 'audio/flac',
};

export interface ImportedMap {
  key: string;
  fileName: string;
  fileSize: number;
  map: MapData;
}

export interface ImportError {
  fileName: string;
  message: string;
}

export interface ImportSummary {
  maps: ImportedMap[];
  errors: ImportError[];
  ignored: string[];
}

/**
 * Reads dropped/selected files and parses every map. Audio files are paired
 * with `.txt` maps that share the same base name, matching the legacy client.
 */
export async function importFiles(files: File[]): Promise<ImportSummary> {
  const maps: ImportedMap[] = [];
  const errors: ImportError[] = [];
  const ignored: string[] = [];

  const loaded = await Promise.all(
    files.map(async (file) => ({
      file,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })),
  );

  const audioByBaseName = new Map<string, Blob>();
  for (const { file, bytes } of loaded) {
    const ext = getExtension(file.name);
    if (!AUDIO_EXTENSIONS.has(ext)) continue;
    const type = file.type || AUDIO_MIME[ext] || 'audio/mpeg';
    audioByBaseName.set(getBaseName(file.name).toLowerCase(), makeBlob(bytes, type));
  }

  for (const { file, bytes } of loaded) {
    const ext = getExtension(file.name);
    if (!MAP_EXTENSIONS.has(ext)) {
      if (!AUDIO_EXTENSIONS.has(ext)) ignored.push(file.name);
      continue;
    }

    try {
      const audio = ext === 'txt'
        ? audioByBaseName.get(getBaseName(file.name).toLowerCase()) ?? null
        : null;
      const map = parseMapFile({ name: file.name, bytes }, { audio });
      const key = await makeMapKey(map.format, bytes);
      maps.push({ key, fileName: file.name, fileSize: file.size, map });
    } catch (error) {
      errors.push({
        fileName: file.name,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  maps.sort((a, b) => a.map.title.localeCompare(b.map.title));
  return { maps, errors, ignored };
}
