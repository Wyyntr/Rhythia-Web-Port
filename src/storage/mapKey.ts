/** Stable per-file key so re-importing the same map replaces it. */
export async function makeMapKey(format: string, bytes: Uint8Array): Promise<string> {
  const hash = await hashBytes(bytes);
  return `${format}:${hash}`;
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
      return toHex(new Uint8Array(digest), 16);
    } catch {
      // Fall through to the fast non-cryptographic hash.
    }
  }

  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    h1 = Math.imul(h1 ^ byte, 0x01000193);
    h2 = Math.imul(h2 ^ byte, 0x85ebca6b);
    h2 ^= h2 >>> 13;
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

function toHex(bytes: Uint8Array, length: number): string {
  let out = '';
  for (let i = 0; i < Math.min(length, bytes.length); i++) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}
