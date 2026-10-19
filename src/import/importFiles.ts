import { unzipSync } from 'fflate';
import { makeBlob } from '../formats/blobs';
import { parseMapFile } from '../formats';
import type { MapData } from '../formats/types';
import { getBaseName, getExtension } from '../formats/util';
import { makeMapKey } from '../storage/mapKey';

const MAP_EXTENSIONS = new Set(['sspm', 'phxm', 'rhm', 'txt']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'ogg', 'wav', 'flac']);
const MAX_ARCHIVE_ENTRIES = 1000;
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

const AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  flac: 'audio/flac',
};

interface LoadedFile {
  name: string;
  size: number;
  bytes: Uint8Array;
}

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
 * Reads dropped/selected files (or ZIP archives) and parses every map. Audio
 * files are paired with `.txt` maps that share the same base name, matching
 * the legacy client.
 */
export async function importFiles(files: File[]): Promise<ImportSummary> {
  const maps: ImportedMap[] = [];
  const errors: ImportError[] = [];
  const ignored: string[] = [];

  const loaded: LoadedFile[] = [];
  for (const file of files) {
    const ext = getExtension(file.name);
    if (ext === 'zip') {
      try {
        const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
        const entries: LoadedFile[] = [];
        let total = 0;
        for (const [path, bytes] of Object.entries(archive)) {
          const name = archiveEntryName(path);
          if (!name) continue;
          total += bytes.length;
          if (entries.length + 1 > MAX_ARCHIVE_ENTRIES || total > MAX_ARCHIVE_BYTES) {
            throw new Error('the archive contains too many or too-large files');
          }
          entries.push({ name, size: bytes.length, bytes });
        }
        loaded.push(...entries);
      } catch (error) {
        errors.push({
          fileName: file.name,
          message: error instanceof Error ? `Could not open ZIP archive: ${error.message}` : 'Could not open ZIP archive',
        });
      }
    } else {
      loaded.push({
        name: file.name,
        size: file.size,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
    }
  }

  const audioByBaseName = new Map<string, Blob>();
  for (const { name, bytes } of loaded) {
    const ext = getExtension(name);
    if (!AUDIO_EXTENSIONS.has(ext)) continue;
    const type = AUDIO_MIME[ext] || 'audio/mpeg';
    audioByBaseName.set(getBaseName(name).toLowerCase(), makeBlob(bytes, type));
  }

  for (const { name, size, bytes } of loaded) {
    const ext = getExtension(name);
    if (!MAP_EXTENSIONS.has(ext)) {
      if (!AUDIO_EXTENSIONS.has(ext)) ignored.push(name);
      continue;
    }

    try {
      const audio = ext === 'txt'
        ? audioByBaseName.get(getBaseName(name).toLowerCase()) ?? null
        : null;
      const map = parseMapFile({ name, bytes }, { audio });
      const key = await makeMapKey(map.format, bytes);
      maps.push({ key, fileName: name, fileSize: size, map });
    } catch (error) {
      errors.push({
        fileName: name,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  maps.sort((a, b) => a.map.title.localeCompare(b.map.title));
  return { maps, errors, ignored };
}

/** Returns the basename of a ZIP entry, or null for directories/macOS junk. */
function archiveEntryName(path: string): string | null {
  if (path.endsWith('/') || path.endsWith('\\')) return null;
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.some((part) => part.startsWith('.'))) return null;
  return parts.at(-1) ?? null;
}
