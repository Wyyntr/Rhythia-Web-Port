import { getSharedAudioContext, primeAudioContext } from './context';

export interface AudioEngineOptions {
  volume: number;
  offsetMs: number;
  hitSounds: boolean;
}

type EngineState = 'idle' | 'playing' | 'paused' | 'stopped';

/**
 * Audio-clock driven timing for gameplay. Visuals and judgments are derived
 * from the audible audio position (AudioContext time minus output latency),
 * not from requestAnimationFrame deltas.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private hitBuffer: AudioBuffer | null = null;
  private missBuffer: AudioBuffer | null = null;

  private state: EngineState = 'idle';
  private speed = 1;
  private offsetMs = 0;
  private volume = 0.8;
  private hitSoundsEnabled = true;
  private startCtxTime = 0;
  private baseProgress = 0;
  private latencySeconds = 0;
  private pausedProgress = 0;
  private audioAvailable = false;
  private useVirtualClock = false;
  private virtualStartMs = 0;

  constructor(options: AudioEngineOptions) {
    this.volume = options.volume;
    this.offsetMs = options.offsetMs;
    this.hitSoundsEnabled = options.hitSounds;
  }

  get hasAudio(): boolean {
    return this.audioAvailable;
  }

  get isPlaying(): boolean {
    return this.state === 'playing';
  }

  get isPaused(): boolean {
    return this.state === 'paused';
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Must be called from a user gesture the first time. */
  async init(): Promise<void> {
    if (!this.ctx) {
      const context = getSharedAudioContext() ?? primeAudioContext();
      if (!context) throw new Error('Web Audio is not supported in this browser');
      this.ctx = context;

      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.55;
      this.sfxGain.connect(this.master);

      this.hitBuffer = makeHitSound(this.ctx);
      this.missBuffer = makeMissSound(this.ctx);
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  async load(blob: Blob | null): Promise<void> {
    await this.init();
    this.stop();
    this.buffer = null;
    this.audioAvailable = false;

    if (!blob) return;

    const bytes = await blob.arrayBuffer();
    try {
      this.buffer = await this.ctx!.decodeAudioData(bytes);
      this.audioAvailable = true;
    } catch {
      this.buffer = null;
      throw new Error('Could not decode the audio embedded in this map');
    }
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.02);
    }
  }

  setOffsetMs(offsetMs: number): void {
    this.offsetMs = offsetMs;
  }

  setHitSounds(enabled: boolean): void {
    this.hitSoundsEnabled = enabled;
  }

  /**
   * Starts the attempt. `leadInMs` is a countdown before progress reaches
   * zero; `fromProgressMs` is used when resuming a paused attempt. When
   * `resume` is set the song continues from the corresponding audio position
   * instead of from the beginning.
   */
  start(leadInMs: number, fromProgressMs: number, speed: number, resume = false): void {
    if (!this.ctx) throw new Error('Audio engine has not been initialized');

    this.stopSource();
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => undefined);
    }
    this.speed = speed;
    this.baseProgress = resume ? fromProgressMs + this.offsetMs : fromProgressMs;
    this.startCtxTime = this.ctx.currentTime + Math.max(0, leadInMs) / 1000;
    this.latencySeconds = outputLatency(this.ctx);
    this.useVirtualClock = !this.buffer || this.ctx.state !== 'running';
    this.virtualStartMs = performance.now() + Math.max(0, leadInMs);
    this.state = 'playing';
    this.pausedProgress = fromProgressMs;

    if (this.buffer) {
      const source = this.ctx.createBufferSource();
      source.buffer = this.buffer;
      source.playbackRate.value = speed;
      source.connect(this.master!);

      // Map time and song time share the same timeline; the offset only shifts
      // judgments, not which part of the song is resumed.
      const audioPositionMs = resume ? Math.max(0, fromProgressMs + this.offsetMs) : 0;
      if (audioPositionMs < this.buffer.duration * 1000) {
        source.start(this.startCtxTime, audioPositionMs / 1000);
        this.source = source;
      } else {
        source.disconnect();
      }
    }
  }

  /** Map time in milliseconds (may be negative during the lead-in). */
  getProgress(): number {
    if (!this.ctx || this.state !== 'playing') {
      return this.pausedProgress;
    }

    if (this.useVirtualClock) {
      const elapsedMs = (performance.now() - this.virtualStartMs) * this.speed;
      return this.baseProgress + elapsedMs - this.offsetMs;
    }

    const elapsedMs =
      (this.ctx.currentTime - this.startCtxTime - this.latencySeconds) * 1000 * this.speed;
    return this.baseProgress + elapsedMs - this.offsetMs;
  }

  /** Stops and returns the current map position. */
  pause(): number {
    if (this.state !== 'playing') return this.pausedProgress;
    this.pausedProgress = this.getProgress();
    this.stopSource();
    this.state = 'paused';
    return this.pausedProgress;
  }

  stop(): void {
    this.stopSource();
    this.pausedProgress = 0;
    this.state = 'stopped';
  }

  playHit(): void {
    if (!this.hitSoundsEnabled || !this.ctx || !this.sfxGain || !this.hitBuffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = this.hitBuffer;
    source.playbackRate.value = 0.94 + Math.random() * 0.12;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.35;
    source.connect(gain).connect(this.sfxGain);
    source.start();
  }

  playMiss(): void {
    if (!this.ctx || !this.sfxGain || !this.missBuffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = this.missBuffer;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.3;
    source.connect(gain).connect(this.sfxGain);
    source.start();
  }

  dispose(): void {
    this.stopSource();
    this.state = 'stopped';
    this.master?.disconnect();
    this.sfxGain?.disconnect();
    this.master = null;
    this.sfxGain = null;
    this.hitBuffer = null;
    this.missBuffer = null;
    this.buffer = null;
    this.ctx = null;
  }

  private stopSource(): void {
    if (!this.source) return;
    try {
      this.source.stop();
    } catch {
      // Already stopped.
    }
    this.source.disconnect();
    this.source = null;
  }
}

function outputLatency(context: AudioContext): number {
  const output = Number.isFinite(context.outputLatency) ? context.outputLatency : 0;
  const base = Number.isFinite(context.baseLatency) ? context.baseLatency : 0;
  return output + base;
}

function makeHitSound(context: AudioContext): AudioBuffer {
  const duration = 0.08;
  const length = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / context.sampleRate;
    const envelope = Math.exp(-t * 65);
    const tone = Math.sin(2 * Math.PI * 880 * t) * 0.55
      + Math.sin(2 * Math.PI * 1760 * t) * 0.2;
    data[i] = tone * envelope * 0.7;
  }

  return buffer;
}

function makeMissSound(context: AudioContext): AudioBuffer {
  const duration = 0.18;
  const length = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const t = i / context.sampleRate;
    const envelope = Math.exp(-t * 22);
    data[i] = Math.sin(2 * Math.PI * 110 * t) * envelope * 0.5;
  }

  return buffer;
}
