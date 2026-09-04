/**
 * Study-streak arithmetic.
 *
 * Split out of `lib/api.ts` so it stays a pure, dependency-free module: `api.ts`
 * pulls in `lib/supabase.ts` (and therefore `react-native`), which the Node-based
 * vitest environment cannot load. `api.ts` re-exports `computeStreak` so callers
 * still see one surface.
 *
 * Day boundaries are the *device's local* calendar days, deliberately: a streak
 * is a human, felt-in-the-evening thing, and a UTC boundary would end the day at
 * 01:00 for a user in Belgrade.
 */

/**
 * A stable key for the local calendar day an instant falls in. Not a date
 * format anyone reads -- it only ever gets compared to another key.
 *
 * Exported so `lib/xp.ts` can bucket today's XP by exactly the same rule the
 * streak uses. Two definitions of "today" in one app is one too many.
 */
export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * The set of local calendar days that `timestamps` touch. Duplicates, nulls and
 * unparseable values are dropped (PostgREST types `reviewed_at` as nullable).
 *
 * Pass `into` to accumulate across several pages of rows.
 */
export function collectLocalDays(
  timestamps: readonly (string | null | undefined)[],
  into: Set<string> = new Set(),
): Set<string> {
  for (const timestamp of timestamps) {
    if (!timestamp) continue;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) continue;
    into.add(localDayKey(date));
  }
  return into;
}

/**
 * The number of consecutive local calendar days, ending today or yesterday, on
 * which at least one review happened.
 *
 * Yesterday counts as an ending day so that the streak does not visibly die at
 * midnight while the user is still going to study later today.
 *
 * @param timestamps `review_logs.reviewed_at` values, in any order.
 * @param now The instant to measure back from. Injected for testability.
 */
export function computeStreak(
  timestamps: readonly (string | null | undefined)[],
  now: Date = new Date(),
): number {
  return streakFromLocalDays(collectLocalDays(timestamps), now);
}

/** `computeStreak` over an already-collected day set. */
export function streakFromLocalDays(days: ReadonlySet<string>, now: Date = new Date()): number {
  if (days.size === 0) return 0;

  // Start at today; if today is empty, allow the streak to end yesterday.
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  if (!days.has(localDayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!days.has(localDayKey(cursor))) return 0;
  }

  // Walk backwards a local day at a time. `setDate` (rather than subtracting
  // 86_400_000 ms) is what keeps this correct across month ends and DST shifts.
  let streak = 0;
  while (days.has(localDayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** The local calendar day a `localDayKey` names, or null if it is not one. */
function dayFromKey(key: string): Date | null {
  const parts = key.split('-').map(Number);
  if (parts.length !== 3 || !parts.every((part) => Number.isInteger(part))) return null;
  const [year, month, day] = parts;
  return new Date(year, month, day);
}

/**
 * The longest unbroken run of local days in `days`, anywhere in the history —
 * the record the progress screen shows beside the current streak.
 *
 * Unlike `streakFromLocalDays` this cannot stop early: a run from two years ago
 * may still be the longest, so it needs the whole set. That is why the progress
 * screen walks the full review history and the dashboard does not.
 */
export function longestStreakFromLocalDays(days: ReadonlySet<string>): number {
  const dates = [...days]
    .map(dayFromKey)
    .filter((date): date is Date => date !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  let longest = 0;
  let run = 0;
  let previous: Date | null = null;
  for (const date of dates) {
    if (previous === null) {
      run = 1;
    } else {
      // `setDate` rather than +86_400_000 ms, for the same reason as above: DST
      // shifts and month ends.
      const next = new Date(previous);
      next.setDate(next.getDate() + 1);
      run = localDayKey(next) === localDayKey(date) ? run + 1 : 1;
    }
    if (run > longest) longest = run;
    previous = date;
  }
  return longest;
}

/** `longestStreakFromLocalDays` over raw `reviewed_at` values. */
export function longestStreak(
  timestamps: readonly (string | null | undefined)[],
): number {
  return longestStreakFromLocalDays(collectLocalDays(timestamps));
}

/** The start of the local calendar day containing `now`. */
export function startOfLocalDay(now: Date = new Date()): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

// ---------------------------------------------------------------------------
// Two ledgers, one streak
// ---------------------------------------------------------------------------

/**
 * A day of study is recorded in two places, and the streak is their union.
 *
 * A word review writes `review_logs`. A letter rating writes no such row — the
 * drill schedules nothing, so it has no grade, no interval and no state to log —
 * but it does write its XP, one `xp_events` row of kind `review`, in the same
 * transaction as the tally. So the caller pages both ledgers newest-first and
 * hands each page here.
 *
 * Pure on purpose: vitest cannot import `api.ts` (it reaches `lib/supabase.ts`
 * and therefore `react-native`), and the rule below — in particular *when it is
 * safe to stop paging* — is the only genuinely fiddly part of a two-ledger
 * streak.
 */
export interface StudyDayPage {
  /** Both ledgers' timestamps for this page, unordered and possibly null. */
  timestamps: (string | null | undefined)[];
  /** True when neither ledger has an older row left to give. */
  exhausted: boolean;
}

/**
 * One page of each ledger, merged.
 *
 * The order of the merged array does not matter: every consumer turns it
 * straight into a set of local day keys, through the same `localDayKey`, so the
 * two ledgers cannot disagree about where a day begins. What does matter is
 * `exhausted`, and it needs **both** sides to be short: a full page from either
 * ledger means that ledger has older rows, and those rows could still extend the
 * streak.
 */
export function mergeStudyDayPage(
  reviewed: readonly (string | null | undefined)[],
  studied: readonly (string | null | undefined)[],
  pageSize: number,
): StudyDayPage {
  return {
    timestamps: [...reviewed, ...studied],
    exhausted: reviewed.length < pageSize && studied.length < pageSize,
  };
}

/** Fetches page `page` (0-based) of both ledgers, newest first. */
export type StudyDayPageFetcher = (page: number) => Promise<StudyDayPage>;

/**
 * The current streak, walking back a page at a time until the answer is settled.
 *
 * Two ways to stop early. The first is always sound; the second is sound for
 * one ledger and, with two ledgers paging in lockstep, only while a page of
 * each spans more days than the streak — a full 1000-row page of one ledger
 * over a few days beside a short page of the other could stop a page early.
 * Unreachable at this deck's size; if it ever matters, make the merge report
 * each ledger's oldest timestamp and exit only once both pass the break day.
 *
 *  - `exhausted` — there is no more history, in either ledger.
 *  - `days.size > streak` — some day already fetched is *not* part of the
 *    streak, so the gap that ends the streak is inside this window. Everything
 *    still unfetched is older than that gap, whichever ledger it would come
 *    from, so it cannot lengthen the streak.
 *
 * `maxPages` is the backstop against a pathological history; a daily learner
 * settles on page 0.
 */
export async function streakFromPages(
  fetchPage: StudyDayPageFetcher,
  now: Date = new Date(),
  maxPages = 10,
): Promise<number> {
  const days = new Set<string>();
  let streak = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const { timestamps, exhausted } = await fetchPage(page);
    if (timestamps.length === 0) break;

    collectLocalDays(timestamps, days);
    streak = streakFromLocalDays(days, now);

    if (exhausted) break;
    if (days.size > streak) break;
  }

  return streak;
}

/**
 * Every local day the user has ever studied on, from both ledgers.
 *
 * No early exit is possible here: the *longest* streak can be anywhere in the
 * history, so no window settles it. That is why only the progress screen —
 * opened deliberately, not painted on every dashboard visit — asks for this.
 */
export async function studyDaysFromPages(
  fetchPage: StudyDayPageFetcher,
  maxPages = 10,
): Promise<Set<string>> {
  const days = new Set<string>();
  for (let page = 0; page < maxPages; page += 1) {
    const { timestamps, exhausted } = await fetchPage(page);
    collectLocalDays(timestamps, days);
    if (exhausted) break;
  }
  return days;
}
