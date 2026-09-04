import { describe, expect, it } from 'vitest';

import {
  computeStreak,
  longestStreak,
  mergeStudyDayPage,
  streakFromPages,
  studyDaysFromPages,
  type StudyDayPage,
} from '@/lib/streak';

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

describe('longestStreak', () => {
  it('is 0 when there are no reviews at all', () => {
    expect(longestStreak([])).toBe(0);
  });

  it('is 1 for a single day', () => {
    expect(longestStreak([localDaysAgo(NOW, 3)])).toBe(1);
  });

  it('finds the best run even when it is long over', () => {
    const logs = [
      // A four-day run a fortnight ago...
      localDaysAgo(NOW, 14),
      localDaysAgo(NOW, 13),
      localDaysAgo(NOW, 12),
      localDaysAgo(NOW, 11),
      // ...and a two-day one ending today.
      localDaysAgo(NOW, 1),
      localDaysAgo(NOW, 0),
    ];
    expect(longestStreak(logs)).toBe(4);
    // The current streak is the shorter, live one -- the two answer different
    // questions and the progress screen shows both.
    expect(computeStreak(logs, NOW)).toBe(2);
  });

  it('is never shorter than the current streak', () => {
    const logs = Array.from({ length: 7 }, (_, i) => localDaysAgo(NOW, i));
    expect(longestStreak(logs)).toBe(7);
    expect(computeStreak(logs, NOW)).toBe(7);
  });

  it('ignores order, duplicates, nulls and unparseable timestamps', () => {
    const logs = [
      localDaysAgo(NOW, 5),
      null,
      localDaysAgo(NOW, 4),
      'not a date',
      localDaysAgo(NOW, 5),
      localDaysAgo(NOW, 6),
    ];
    expect(longestStreak(logs)).toBe(3);
  });

  it('spans a month boundary', () => {
    const now = new Date(2026, 8, 2, 9, 0, 0, 0); // 2 Sep 2026
    const logs = [
      localDaysAgo(now, 1), // 1 Sep
      localDaysAgo(now, 2), // 31 Aug
      localDaysAgo(now, 3), // 30 Aug
    ];
    expect(longestStreak(logs)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Two ledgers: words in `review_logs`, letters in `xp_events`
// ---------------------------------------------------------------------------

/** A page fetcher over fixed pages; asks past the end get an empty, exhausted page. */
function pages(...list: StudyDayPage[]) {
  const asked: number[] = [];
  const fetch = async (page: number): Promise<StudyDayPage> => {
    asked.push(page);
    return list[page] ?? { timestamps: [], exhausted: true };
  };
  return { fetch, asked };
}

describe('mergeStudyDayPage', () => {
  it('keeps every timestamp from both ledgers', () => {
    const { timestamps } = mergeStudyDayPage(['a', 'b'], ['c'], 10);
    expect(timestamps).toEqual(['a', 'b', 'c']);
  });

  it('is exhausted only when both ledgers came back short', () => {
    expect(mergeStudyDayPage(['a'], ['b'], 3).exhausted).toBe(true);
    // One ledger empty, the other short: still the end of the history.
    expect(mergeStudyDayPage([], ['b'], 3).exhausted).toBe(true);
    expect(mergeStudyDayPage([], [], 3).exhausted).toBe(true);
  });

  it('is not exhausted while EITHER ledger filled its page', () => {
    // The uneven case that matters: nothing left in `review_logs`, but the XP
    // ledger is full, so its older rows may still extend the streak.
    expect(mergeStudyDayPage([], ['a', 'b', 'c'], 3).exhausted).toBe(false);
    expect(mergeStudyDayPage(['a', 'b', 'c'], [], 3).exhausted).toBe(false);
    expect(mergeStudyDayPage(['a', 'b', 'c'], ['d', 'e', 'f'], 3).exhausted).toBe(false);
  });
});

describe('streakFromPages', () => {
  it('is 0 with no history at all', async () => {
    const { fetch } = pages({ timestamps: [], exhausted: true });
    await expect(streakFromPages(fetch, NOW)).resolves.toBe(0);
  });

  it('counts a day that only the second ledger knows about', async () => {
    // Words yesterday and the day before, a letters-only day in between: the
    // streak is unbroken only because the two ledgers are unioned.
    const { fetch } = pages({
      timestamps: [localDaysAgo(NOW, 0), localDaysAgo(NOW, 2)],
      exhausted: false,
    });
    // Words alone would stop at 1 (today), the gap at day 1 ending it.
    await expect(streakFromPages(fetch, NOW)).resolves.toBe(1);

    const both = pages({
      timestamps: [localDaysAgo(NOW, 0), localDaysAgo(NOW, 2), localDaysAgo(NOW, 1, 8)],
      exhausted: false,
    });
    await expect(streakFromPages(both.fetch, NOW)).resolves.toBe(3);
  });

  it('walks back through pages while every fetched day is in the streak', async () => {
    const { fetch, asked } = pages(
      { timestamps: [localDaysAgo(NOW, 0), localDaysAgo(NOW, 1)], exhausted: false },
      { timestamps: [localDaysAgo(NOW, 2), localDaysAgo(NOW, 3)], exhausted: false },
      { timestamps: [localDaysAgo(NOW, 4), localDaysAgo(NOW, 9)], exhausted: false },
    );
    // Page 2 brings a day outside the streak, so page 3 is never asked for.
    await expect(streakFromPages(fetch, NOW)).resolves.toBe(5);
    expect(asked).toEqual([0, 1, 2]);
  });

  it('stops as soon as a page is exhausted, even if it filled one ledger', async () => {
    const { fetch, asked } = pages({
      timestamps: [localDaysAgo(NOW, 0), localDaysAgo(NOW, 1)],
      exhausted: true,
    });
    await expect(streakFromPages(fetch, NOW)).resolves.toBe(2);
    expect(asked).toEqual([0]);
  });

  it('keeps paging when one ledger is much longer than the other', async () => {
    // Only the XP ledger has anything left after page 0, and it fills its page
    // every time — `exhausted` must stay false or the streak is cut short.
    const { fetch, asked } = pages(
      { timestamps: [localDaysAgo(NOW, 0)], exhausted: false },
      { timestamps: [localDaysAgo(NOW, 1)], exhausted: false },
      { timestamps: [localDaysAgo(NOW, 2)], exhausted: true },
    );
    await expect(streakFromPages(fetch, NOW)).resolves.toBe(3);
    expect(asked).toEqual([0, 1, 2]);
  });

  it('gives up at maxPages rather than paging for ever', async () => {
    let page = 0;
    const fetch = async (): Promise<StudyDayPage> => {
      const stamps = [localDaysAgo(NOW, page)];
      page += 1;
      return { timestamps: stamps, exhausted: false };
    };
    await expect(streakFromPages(fetch, NOW, 3)).resolves.toBe(3);
  });

  it('stops on an empty page even when it is not flagged exhausted', async () => {
    const { fetch, asked } = pages(
      { timestamps: [localDaysAgo(NOW, 0)], exhausted: false },
      { timestamps: [], exhausted: false },
    );
    await expect(streakFromPages(fetch, NOW)).resolves.toBe(1);
    expect(asked).toEqual([0, 1]);
  });
});

describe('studyDaysFromPages', () => {
  it('collects both ledgers with no early exit', async () => {
    const { fetch, asked } = pages(
      { timestamps: [localDaysAgo(NOW, 0), localDaysAgo(NOW, 40)], exhausted: false },
      { timestamps: [localDaysAgo(NOW, 41)], exhausted: true },
    );
    const days = await studyDaysFromPages(fetch);
    // A day far outside the current streak is still collected: the *longest*
    // streak can be anywhere in the history.
    expect(days.size).toBe(3);
    expect(asked).toEqual([0, 1]);
  });

  it('dedupes a day both ledgers recorded', async () => {
    const { fetch } = pages({
      timestamps: [localDaysAgo(NOW, 1, 9), localDaysAgo(NOW, 1, 21)],
      exhausted: true,
    });
    await expect(studyDaysFromPages(fetch)).resolves.toHaveProperty('size', 1);
  });

  it('honours maxPages', async () => {
    const { fetch, asked } = pages(
      { timestamps: [localDaysAgo(NOW, 0)], exhausted: false },
      { timestamps: [localDaysAgo(NOW, 1)], exhausted: false },
      { timestamps: [localDaysAgo(NOW, 2)], exhausted: false },
    );
    const days = await studyDaysFromPages(fetch, 2);
    expect(days.size).toBe(2);
    expect(asked).toEqual([0, 1]);
  });
});
