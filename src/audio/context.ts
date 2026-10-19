/**
 * A single AudioContext for the whole app. Browsers (especially iOS Safari)
 * require it to be created or resumed inside a user gesture, so the library
 * primes it directly in the Play click, before the game module is imported.
 */
let shared: AudioContext | null = null;

export function primeAudioContext(): AudioContext | null {
  if (!shared || shared.state === 'closed') {
    const Ctor = globalThis.AudioContext;
    if (!Ctor) return null;
    shared = new Ctor({ latencyHint: 'interactive' });
  }
  if (shared.state === 'suspended') {
    void shared.resume().catch(() => undefined);
  }
  return shared;
}

export function getSharedAudioContext(): AudioContext | null {
  return shared;
}
