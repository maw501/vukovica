import { describe, expect, it } from 'vitest';

import {
  DAILY_GOAL,
  LEVEL_XP,
  XP_AWARDS,
  goalFraction,
  levelFor,
  levelProgress,
  ringSweep,
  todayXp,
} from '@/lib/xp';

/**
 * A timestamp `n` local days before `now`, at a given local hour, serialized the
 * way PostgREST hands `timestamptz` back (ISO-8601 / UTC). Same helper as the
 * streak tests use, and for the same reason: the local-build / UTC-read
 * round-trip is exactly what the day maths has to survive.
 */
function localDaysAgo(now: Date, n: number, hour = 12): string {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

/** A fixed, unremarkable local instant: mid-month, mid-day. */
const NOW = new Date(2026, 7, 29, 14, 30, 0, 0); // 29 Aug 2026, 14:30 local

describe('XP_AWARDS', () => {
  it('is the table the spec fixes', () => {
    expect(XP_AWARDS).toEqual({
      review: 2,
      drill: 10,
      grammar: 15,
      story: 20,
      book_page: 0,
      book_finish: 50,
      request: 0,
    });
  });
});

describe('levelFor', () => {
  it('starts at level 1 with no XP at all', () => {
    expect(levelFor(0)).toBe(1);
  });

  it('holds level 1 right up to the boundary', () => {
    expect(levelFor(1)).toBe(1);
    expect(levelFor(LEVEL_XP - 1)).toBe(1); // 149
  });

  it('turns over exactly on the boundary', () => {
    expect(levelFor(LEVEL_XP)).toBe(2); // 150
    expect(levelFor(LEVEL_XP + 1)).toBe(2);
    expect(levelFor(2 * LEVEL_XP - 1)).toBe(2); // 299
    expect(levelFor(2 * LEVEL_XP)).toBe(3); // 300
  });

  it('never goes below 1, whatever it is handed', () => {
    // The ledger is append-only and every award is positive, so a negative
    // total means something is wrong upstream -- but "level 0" on the progress
    // screen would be a second, louder wrong thing.
    expect(levelFor(-10)).toBe(1);
    expect(levelFor(Number.NaN)).toBe(1);
  });
});

describe('levelProgress', () => {
  it('splits a total into its level and the XP earned inside it', () => {
    expect(levelProgress(0)).toEqual({ level: 1, into: 0, needed: LEVEL_XP });
    expect(levelProgress(149)).toEqual({ level: 1, into: 149, needed: LEVEL_XP });
    expect(levelProgress(150)).toEqual({ level: 2, into: 0, needed: LEVEL_XP });
    expect(levelProgress(325)).toEqual({ level: 3, into: 25, needed: LEVEL_XP });
  });

  it('reads a nonsense total as a fresh level 1', () => {
    expect(levelProgress(-5)).toEqual({ level: 1, into: 0, needed: LEVEL_XP });
  });
});

describe('todayXp', () => {
  const event = (created_at: string | null, amount = 2) => ({ amount, created_at });

  it('is 0 with no events', () => {
    expect(todayXp([], NOW)).toBe(0);
  });

  it('sums every event from today', () => {
    const events = [
      event(localDaysAgo(NOW, 0, 8), 2),
      event(localDaysAgo(NOW, 0, 13), 10),
      event(localDaysAgo(NOW, 0, 14), 20),
    ];
    expect(todayXp(events, NOW)).toBe(32);
  });

  it('ignores events from yesterday and earlier', () => {
    const events = [event(localDaysAgo(NOW, 0), 2), event(localDaysAgo(NOW, 1), 50)];
    expect(todayXp(events, NOW)).toBe(2);
  });

  it('buckets by LOCAL calendar day, not UTC day', () => {
    // Just after local midnight today: east of UTC this instant is *yesterday*
    // in UTC, so a UTC-bucketing implementation would drop it from the ring.
    expect(todayXp([event(localDaysAgo(NOW, 0, 0), 10)], NOW)).toBe(10);
    // ...and late yesterday must stay out of it, however close it is.
    expect(todayXp([event(localDaysAgo(NOW, 1, 23), 10)], NOW)).toBe(0);
  });

  it('ignores nulls, unparseable timestamps and non-numeric amounts', () => {
    const events = [
      event(null, 10),
      event('not a date', 10),
      { amount: Number.NaN, created_at: localDaysAgo(NOW, 0) },
      event(localDaysAgo(NOW, 0), 2),
    ];
    expect(todayXp(events, NOW)).toBe(2);
  });

  it('leaves a future-dated event out of today', () => {
    // A clock that has run backwards is the only way this happens, and "today"
    // has to keep meaning today rather than "everything since midnight".
    expect(todayXp([event(localDaysAgo(NOW, -1), 10)], NOW)).toBe(0);
  });
});

describe('goalFraction', () => {
  it('is the share of the daily goal earned so far', () => {
    expect(goalFraction(0)).toBe(0);
    expect(goalFraction(15)).toBe(0.5);
    expect(goalFraction(DAILY_GOAL)).toBe(1);
  });

  it('caps at a full ring once the goal is beaten', () => {
    expect(goalFraction(DAILY_GOAL * 3)).toBe(1);
  });

  it('never goes negative', () => {
    expect(goalFraction(-4)).toBe(0);
  });
});

describe('ringSweep', () => {
  // The ring is two clipped half-circles, each rotated into place: the right
  // one covers the first 180 degrees of the sweep, the left one the rest. At
  // rest both sit fully outside their clip, i.e. rotated back by 180.
  it('shows nothing at all at zero', () => {
    expect(ringSweep(0)).toEqual({ right: -180, left: -180 });
  });

  it('moves only the right half through the first quarter turn', () => {
    expect(ringSweep(0.25)).toEqual({ right: -90, left: -180 });
    expect(ringSweep(0.5)).toEqual({ right: 0, left: -180 });
  });

  it('holds the right half open while the left one sweeps', () => {
    expect(ringSweep(0.75)).toEqual({ right: 0, left: -90 });
    expect(ringSweep(1)).toEqual({ right: 0, left: 0 });
  });

  it('clamps anything outside 0..1', () => {
    expect(ringSweep(2)).toEqual({ right: 0, left: 0 });
    expect(ringSweep(-1)).toEqual({ right: -180, left: -180 });
    expect(ringSweep(Number.NaN)).toEqual({ right: -180, left: -180 });
  });
});
