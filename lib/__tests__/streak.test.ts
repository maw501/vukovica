import { describe, expect, it } from 'vitest';

import { computeStreak } from '@/lib/streak';

/**
 * A timestamp `n` local days before `now`, at a given local hour, serialized
 * the way PostgREST hands `timestamptz` back (ISO-8601 / UTC). Building it in
 * local time and reading it back is exactly the round-trip `computeStreak` has
 * to survive.
 */
function localDaysAgo(now: Date, n: number, hour = 12): string {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

// A fixed, unremarkable local instant: mid-month, mid-day, so that none of the
// cases below straddle a month boundary by accident.
const NOW = new Date(2026, 7, 29, 14, 30, 0, 0); // 29 Aug 2026, 14:30 local

describe('computeStreak', () => {
  it('is 0 when there are no reviews at all', () => {
    expect(computeStreak([], NOW)).toBe(0);
  });

  it('is 1 when the only reviews happened today', () => {
    expect(computeStreak([localDaysAgo(NOW, 0)], NOW)).toBe(1);
  });

  it('is 2 for yesterday plus today', () => {
    const logs = [localDaysAgo(NOW, 0), localDaysAgo(NOW, 1)];
    expect(computeStreak(logs, NOW)).toBe(2);
  });

  it('is 1 when the last review was yesterday and today is still empty', () => {
    expect(computeStreak([localDaysAgo(NOW, 1)], NOW)).toBe(1);
  });

  it('resets at the first missing day', () => {
    // today, yesterday, then a hole at 2 days ago, then more history.
    const logs = [
      localDaysAgo(NOW, 0),
      localDaysAgo(NOW, 1),
      localDaysAgo(NOW, 3),
      localDaysAgo(NOW, 4),
    ];
    expect(computeStreak(logs, NOW)).toBe(2);
  });

  it('is 0 when the most recent review is older than yesterday', () => {
    const logs = [localDaysAgo(NOW, 2), localDaysAgo(NOW, 3)];
    expect(computeStreak(logs, NOW)).toBe(0);
  });

  it('counts many reviews on one day only once', () => {
    const logs = [
      localDaysAgo(NOW, 0, 8),
      localDaysAgo(NOW, 0, 12),
      localDaysAgo(NOW, 0, 22),
      localDaysAgo(NOW, 1, 9),
    ];
    expect(computeStreak(logs, NOW)).toBe(2);
  });

  it('counts a long unbroken run', () => {
    const logs = Array.from({ length: 30 }, (_, i) => localDaysAgo(NOW, i));
    expect(computeStreak(logs, NOW)).toBe(30);
  });

  it('ignores order and duplicate timestamps', () => {
    const logs = [
      localDaysAgo(NOW, 2),
      localDaysAgo(NOW, 0),
      localDaysAgo(NOW, 2),
      localDaysAgo(NOW, 1),
    ];
    expect(computeStreak(logs, NOW)).toBe(3);
  });

  it('ignores nulls and unparseable timestamps', () => {
    const logs = [null, 'not a date', localDaysAgo(NOW, 0)];
    expect(computeStreak(logs, NOW)).toBe(1);
  });

  it('buckets by LOCAL calendar day, not UTC day', () => {
    // A review just after local midnight today. In any timezone east of UTC
    // this instant belongs to *yesterday* in UTC, so a UTC-bucketing
    // implementation would call the streak 1-ending-yesterday rather than
    // 1-ending-today -- and would then break tomorrow. The assertion below is
    // about today's bucket either way.
    const justAfterMidnight = localDaysAgo(NOW, 0, 0);
    expect(computeStreak([justAfterMidnight], NOW)).toBe(1);

    // ...and the day before it must chain onto it.
    const lateYesterday = localDaysAgo(NOW, 1, 23);
    expect(computeStreak([justAfterMidnight, lateYesterday], NOW)).toBe(2);
  });

  it('spans a month boundary', () => {
    const now = new Date(2026, 8, 2, 9, 0, 0, 0); // 2 Sep 2026
    const logs = [
      localDaysAgo(now, 0),
      localDaysAgo(now, 1), // 1 Sep
      localDaysAgo(now, 2), // 31 Aug
      localDaysAgo(now, 3), // 30 Aug
    ];
    expect(computeStreak(logs, now)).toBe(4);
  });
});
