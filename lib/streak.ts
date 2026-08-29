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
 */
function localDayKey(date: Date): string {
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

/** The start of the local calendar day containing `now`. */
export function startOfLocalDay(now: Date = new Date()): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}
