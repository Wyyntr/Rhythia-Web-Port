export class MapParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MapParseError';
  }
}

export function readLength(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new MapParseError(`Invalid length ${value}`);
  }
  return value;
}

export function splitArtistTitle(name: string): { artist: string | null; title: string } {
  const separator = name.indexOf(' - ');
  if (separator === -1) {
    return { artist: null, title: name.trim() };
  }
  return {
    artist: name.slice(0, separator).trim() || null,
    title: name.slice(separator + 3).trim(),
  };
}

export function splitMappers(value: string): string[] {
  return value
    .split(/[&,]/)
    .map((mapper) => mapper.trim())
    .filter(Boolean);
}

export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
}

export function getBaseName(fileName: string): string {
  const normalized = fileName.replace(/\\/g, '/');
  const name = normalized.slice(normalized.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? name : name.slice(0, dot);
}

export function getExtension(fileName: string): string {
  const name = fileName.replace(/\\/g, '/').slice(fileName.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}
