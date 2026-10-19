import { describe, expect, it } from 'vitest';
import { GameSession, HIT_WINDOW_MS } from '../src/game/GameSession';
import type { Note } from '../src/formats/types';

function note(time: number, x = 0, y = 0): Note {
  return { time, x, y };
}

function session(notes: Note[], endTimeMs = 10_000, speed = 1): GameSession {
  return new GameSession(notes, { speed, endTimeMs });
}

describe('GameSession', () => {
  it('does not judge notes before their timestamp', () => {
    const game = session([note(1000)]);
    game.setCursor(0, 0);
    expect(game.update(999)).toEqual([]);
    expect(game.snapshot().judged).toBe(0);
  });

  it('hits notes when the cursor is over the cell', () => {
    const game = session([note(1000, -1, 1), note(2000, 0, 0)]);
    game.setCursor(-1, 1);

    const first = game.update(1000);
    expect(first).toHaveLength(1);
    expect(first[0]?.type).toBe('hit');
    expect(first[0]?.note).toEqual(note(1000, -1, 1));

    expect(game.hits).toBe(1);
    expect(game.combo).toBe(1);
    expect(game.accuracy).toBe(100);
    expect(game.score).toBe(100);
  });

  it('rolls score back as the late window progresses', () => {
    const early = session([note(1000)]);
    early.setCursor(0, 0);
    early.update(1000);
    expect(early.score).toBe(100);

    const late = session([note(1000)]);
    late.setCursor(0, 0);
    late.update(1040);
    expect(late.score).toBe(90);
  });

  it('misses notes after the hit window', () => {
    const game = session([note(1000)]);
    game.setCursor(-1, -1);

    expect(game.update(1000 + HIT_WINDOW_MS)).toEqual([]);
    const events = game.update(1001 + HIT_WINDOW_MS);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('miss');
    expect(game.misses).toBe(1);
    expect(game.accuracy).toBe(0);
    expect(game.combo).toBe(0);
  });

  it('judges overlapping notes independently', () => {
    const game = session([note(1000), note(1005), note(1010)]);
    game.setCursor(0, 0);

    const events = game.update(1010);
    expect(events.map((event) => event.type)).toEqual(['hit', 'hit', 'hit']);
    expect(game.hits).toBe(3);
    expect(game.combo).toBe(3);
  });

  it('increments the combo multiplier like the native client', () => {
    const game = session([
      note(100),
      note(200),
      note(300),
      note(400),
    ]);
    game.setCursor(0, 0);

    game.update(100);
    expect(game.multiplier).toBe(1);
    game.update(200);
    expect(game.multiplier).toBe(2);

    game.setCursor(-1, -1);
    game.update(1000);
    expect(game.multiplier).toBe(1);
    expect(game.combo).toBe(0);
  });

  it('fails after repeated misses drain health', () => {
    const notes = Array.from({ length: 10 }, (_, index) => note(1000 + index * 100, 1, 1));
    const game = session(notes, 20_000);
    game.setCursor(-1, -1);

    let failed = false;
    for (let i = 0; i < notes.length; i++) {
      game.update(notes[i]!.time + 100);
      if (game.failed) {
        failed = true;
        break;
      }
    }

    expect(failed).toBe(true);
    expect(game.health).toBe(0);
  });

  it('finishes at the end time', () => {
    const game = session([note(100)], 1500);
    game.setCursor(0, 0);
    game.update(1500);
    expect(game.finished).toBe(true);
  });

  it('applies speed to the late window in map time', () => {
    const game = session([note(1000)], 10_000, 2);
    game.setCursor(-1, -1);

    game.update(1000 + HIT_WINDOW_MS * 2);
    expect(game.misses).toBe(0);
    game.update(1001 + HIT_WINDOW_MS * 2);
    expect(game.misses).toBe(1);
  });
});
