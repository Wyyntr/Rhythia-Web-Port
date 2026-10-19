import type { Note } from '../formats/types';

/** Constants ported from the native client. */
export const HIT_WINDOW_MS = 55;
export const HIT_BOX_SIZE = 0.07;
export const HIT_BOX_HALF = 0.5 + HIT_BOX_SIZE;
export const BOUNDS = 1.5 - 0.2625 / 2;

export type JudgmentType = 'hit' | 'miss';

export interface JudgmentEvent {
  type: JudgmentType;
  index: number;
  note: Note;
  lateness: number;
  combo: number;
  multiplier: number;
}

export interface SessionOptions {
  speed: number;
  /** Progress (ms) after which the attempt is considered complete. */
  endTimeMs: number;
}

export interface SessionSnapshot {
  progress: number;
  score: number;
  accuracy: number;
  combo: number;
  maxCombo: number;
  hits: number;
  misses: number;
  judged: number;
  multiplier: number;
  health: number;
  finished: boolean;
  failed: boolean;
}

/**
 * Pure gameplay simulation, ported from the current Rhythia client:
 * - notes become hittable at their timestamp
 * - they can still be hit during a 55 ms (real time) late window
 * - the cursor must be inside the note's cell plus HIT_BOX_SIZE (Chebyshev)
 * - score/combo/health follow Runner.onHitResultChanged
 */
export class GameSession {
  readonly notes: Note[];
  readonly results: Uint8Array;
  readonly speed: number;

  cursorX = 0;
  cursorY = 0;

  progress = 0;
  score = 0;
  accuracy = 100;
  combo = 0;
  maxCombo = 0;
  hits = 0;
  misses = 0;
  judged = 0;
  multiplier = 1;
  multiplierProgress = 0;
  health = 100;
  healthStep = 15;
  finished = false;
  failed = false;

  private readonly endTimeMs: number;
  private readonly multiplierIncrement: number;
  private firstPending = 0;

  constructor(notes: Note[], options: SessionOptions) {
    this.notes = notes;
    this.results = new Uint8Array(notes.length);
    this.speed = options.speed;
    this.endTimeMs = options.endTimeMs;
    this.multiplierIncrement = Math.max(2, Math.floor(notes.length / 200));
  }

  get sum(): number {
    return this.hits + this.misses;
  }

  setCursor(x: number, y: number): void {
    this.cursorX = clamp(x, -BOUNDS, BOUNDS);
    this.cursorY = clamp(y, -BOUNDS, BOUNDS);
  }

  /**
   * Advances the simulation to `progress` (milliseconds of map time) and
   * returns the notes judged on this frame.
   */
  update(progress: number): JudgmentEvent[] {
    if (this.finished || this.failed) return [];

    this.progress = progress;
    const events: JudgmentEvent[] = [];

    while (this.firstPending < this.notes.length && this.results[this.firstPending] !== 0) {
      this.firstPending++;
    }

    const lateWindow = HIT_WINDOW_MS * this.speed;
    for (let i = this.firstPending; i < this.notes.length; i++) {
      const note = this.notes[i]!;
      if (note.time > progress) break;
      if (this.results[i] !== 0) continue;

      if (progress > note.time + lateWindow) {
        events.push(this.missNote(i, note));
      } else if (this.cursorHits(note)) {
        events.push(this.hitNote(i, note, progress));
      }

      if (this.failed) break;
    }

    while (this.firstPending < this.notes.length && this.results[this.firstPending] !== 0) {
      this.firstPending++;
    }

    if (!this.failed && progress >= this.endTimeMs) {
      this.finished = true;
    }

    return events;
  }

  snapshot(): SessionSnapshot {
    return {
      progress: this.progress,
      score: this.score,
      accuracy: this.accuracy,
      combo: this.combo,
      maxCombo: this.maxCombo,
      hits: this.hits,
      misses: this.misses,
      judged: this.sum,
      multiplier: this.multiplier,
      health: this.health,
      finished: this.finished,
      failed: this.failed,
    };
  }

  private cursorHits(note: Note): boolean {
    return (
      this.cursorX + HIT_BOX_SIZE >= note.x - 0.5
      && this.cursorX - HIT_BOX_SIZE <= note.x + 0.5
      && this.cursorY + HIT_BOX_SIZE >= note.y - 0.5
      && this.cursorY - HIT_BOX_SIZE <= note.y + 0.5
    );
  }

  private hitNote(index: number, note: Note, progress: number): JudgmentEvent {
    this.results[index] = 1;
    this.hits++;
    this.judged++;

    const lateness = (progress - note.time) / this.speed;
    const factor = 1 - Math.max(0, lateness - 25) / 150;
    const hitScore = Math.floor(
      100 * this.multiplier * factor * ((this.speed - 1) / 2.5 + 1),
    );

    this.score += hitScore;
    this.accuracy = Math.floor((this.hits / this.judged) * 10000) / 100;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.multiplierProgress++;

    if (this.multiplierProgress === this.multiplierIncrement && this.multiplier < 8) {
      this.multiplierProgress = this.multiplier === 7 ? this.multiplierIncrement : 0;
      this.multiplier++;
    }

    this.healthStep = Math.max(this.healthStep / 1.45, 15);
    this.health = Math.min(100, this.health + this.healthStep / 1.75);

    return {
      type: 'hit',
      index,
      note,
      lateness,
      combo: this.combo,
      multiplier: this.multiplier,
    };
  }

  private missNote(index: number, note: Note): JudgmentEvent {
    this.results[index] = 2;
    this.misses++;
    this.judged++;
    this.accuracy = Math.floor((this.hits / this.judged) * 10000) / 100;
    this.combo = 0;
    this.multiplierProgress = 0;
    this.multiplier = Math.max(1, this.multiplier - 1);

    this.health = Math.max(0, this.health - this.healthStep);
    this.healthStep = Math.min(this.healthStep * 1.2, 100);

    if (this.health <= 0) {
      this.failed = true;
    }

    return {
      type: 'miss',
      index,
      note,
      lateness: HIT_WINDOW_MS,
      combo: 0,
      multiplier: this.multiplier,
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
