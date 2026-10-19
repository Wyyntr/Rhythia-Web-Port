export interface Settings {
  /** Music rate: 1 = normal speed. Affects pitch like the native client. */
  speed: number;
  /** Positive values make notes arrive later, used for audio calibration. */
  offsetMs: number;
  /** 0..1 master volume. */
  volume: number;
  /** Play a click on every hit. */
  hitSounds: boolean;
  /** Finger offset in CSS pixels (touch/pen only). */
  touchOffsetX: number;
  touchOffsetY: number;
  /** Native approach rate: approach time (ms) = 15000 / approachRate. */
  approachRate: number;
}

export const DEFAULT_SETTINGS: Settings = {
  speed: 1,
  offsetMs: 0,
  volume: 0.8,
  hitSounds: true,
  touchOffsetX: 0,
  touchOffsetY: 48,
  approachRate: 30,
};

const STORAGE_KEY = 'rhythia-web-settings-v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return normalizeSettings({ ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable in private mode; settings stay in memory.
  }
}

export function normalizeSettings(settings: Settings): Settings {
  return {
    speed: clamp(Number(settings.speed) || DEFAULT_SETTINGS.speed, 0.5, 3),
    offsetMs: clamp(Number(settings.offsetMs) || 0, -500, 500),
    volume: clamp(Number.isFinite(settings.volume) ? settings.volume : DEFAULT_SETTINGS.volume, 0, 1),
    hitSounds: Boolean(settings.hitSounds),
    touchOffsetX: clamp(Number(settings.touchOffsetX) || 0, -160, 160),
    touchOffsetY: clamp(Number(settings.touchOffsetY) || 0, -80, 240),
    approachRate: clamp(Number(settings.approachRate) || DEFAULT_SETTINGS.approachRate, 5, 100),
  };
}

/** Approach time in milliseconds, matching the native client (AD / AR). */
export function approachTimeMs(settings: Settings): number {
  return (15 / settings.approachRate) * 1000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
