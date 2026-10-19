/**
 * Helpers for sniffing embedded media. Map files do not always carry a
 * reliable extension for their audio/cover blocks, so the mime type is
 * detected from the bytes themselves.
 */

export function sniffAudioMime(bytes: Uint8Array): string {
  if (startsWith(bytes, [0x4f, 0x67, 0x67, 0x53])) return 'audio/ogg'; // "OggS"
  if (startsWith(bytes, [0x66, 0x4c, 0x61, 0x43])) return 'audio/flac'; // "fLaC"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46])) return 'audio/wav'; // "RIFF"
  if (startsWith(bytes, [0x49, 0x44, 0x33])) return 'audio/mpeg'; // "ID3"
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return 'audio/mpeg'; // MPEG frame sync
  return 'audio/mpeg';
}

export function sniffImageMime(bytes: Uint8Array): string {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes.length >= 12) {
    return 'image/webp';
  }
  return 'image/png';
}

export function makeAudioBlob(bytes: Uint8Array): Blob {
  return makeBlob(bytes, sniffAudioMime(bytes));
}

export function makeImageBlob(bytes: Uint8Array): Blob {
  return makeBlob(bytes, sniffImageMime(bytes));
}

export function makeBlob(bytes: Uint8Array, type: string): Blob {
  return new Blob([asBlobPart(bytes)], { type });
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

function asBlobPart(bytes: Uint8Array): BlobPart {
  // The underlying buffer is not mutated after parsing; avoiding a copy keeps
  // large audio blocks cheap to import.
  return bytes as unknown as BlobPart;
}
