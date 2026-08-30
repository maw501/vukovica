/**
 * The XP layer: what each activity is worth, the level ladder, and the maths
 * behind today's ring.
 *
 * Pure and dependency-free, for the same reason `lib/streak.ts` is: `lib/api.ts`
 * reaches `lib/supabase.ts` (and therefore `react-native`), which the Node-based
 * vitest environment cannot load. Everything here is arithmetic over rows the
 * caller has already fetched.
 *
 * There are no stored counters anywhere. `xp_events` is an append-only ledger
 * and the total, the level and today's ring are all sums over it, so an award
 * that fails to insert costs exactly the XP it was worth and nothing else.
 */

import { localDayKey } from '@/lib/streak';
import type { XpKind } from '@/lib/types';

/**
 * What each kind of work earns, verbatim from §10 of the phase-3 spec.
 *
 * `book_page` and `request` are deliberately zero: turning a page and filing a
 * word are worth *doing*, not worth points, and paying for them would make the
 * daily goal reachable without any studying at all. They keep their entry here
 * (rather than being absent) because `xp_events.kind` accepts them, so the table
 * stays the one place that says what a kind is worth — including "nothing".
 */
export const XP_AWARDS = {
  review: 2,
  drill: 10,
  grammar: 15,
  story: 20,
  book_page: 0,
  book_finish: 50,
  request: 0,
} as const satisfies Record<XpKind, number>;

/** XP per level. Level = 1 + floor(total / 150). */
export const LEVEL_XP = 150;

/** XP a day, the ring on the dashboard fills towards this. */
export const DAILY_GOAL = 30;

/** A finite number, or `fallback` for NaN / Infinity / a missing value. */
function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * The level a lifetime total buys. Never below 1: every award is positive and
 * the ledger only grows, so a negative total means something upstream is wrong —
 * but "Level 0" on the progress screen would be a second, louder wrong thing.
 */
export function levelFor(total: number): number {
  return 1 + Math.floor(Math.max(0, finite(total)) / LEVEL_XP);
}

/** A total split into its level and how far into that level it has got. */
export interface LevelProgress {
  level: number;
  /** XP earned inside the current level, 0..149. */
  into: number;
  /** XP one level costs. Constant, but returned so callers need no second import. */
  needed: number;
}

/** `levelFor`, plus the numerator and denominator of the level bar. */
export function levelProgress(total: number): LevelProgress {
  const safe = Math.max(0, finite(total));
  return { level: levelFor(safe), into: safe % LEVEL_XP, needed: LEVEL_XP };
}

/** The shape `todayXp` needs from an `xp_events` row. */
export interface XpAmountAt {
  amount: number;
  /** ISO-8601, as PostgREST returns `timestamptz`. Nullable, as the column is. */
  created_at: string | null;
}

/**
 * XP earned on the *device's local* calendar day containing `now`.
 *
 * Day boundaries come from `lib/streak.ts`, deliberately: the ring and the
 * streak have to agree about when a day starts, or an evening session in
 * Belgrade would tick one over and not the other.
 *
 * Total and defensive — a null, unparseable or future-dated timestamp and a
 * non-numeric amount are all simply not today's XP.
 */
export function todayXp(events: readonly XpAmountAt[], now: Date = new Date()): number {
  const today = localDayKey(now);
  let sum = 0;
  for (const event of events) {
    if (!event.created_at) continue;
    const at = new Date(event.created_at);
    if (Number.isNaN(at.getTime())) continue;
    if (localDayKey(at) !== today) continue;
    sum += Math.max(0, finite(event.amount));
  }
  return sum;
}

/** How full the daily ring is: today's XP over the goal, clamped to 0..1. */
export function goalFraction(today: number, goal: number = DAILY_GOAL): number {
  if (goal <= 0) return 1;
  return Math.min(1, Math.max(0, finite(today)) / goal);
}

/** The two rotations that draw a ring `fraction` of the way round. */
export interface RingSweep {
  /** Degrees to rotate the right-hand half-circle by. */
  right: number;
  /** ...and the left-hand one. */
  left: number;
}

/**
 * The geometry of a progress ring drawn without SVG (there is no SVG dependency
 * in this app, and a ring is what §10 asks for).
 *
 * The ring is two half-circles, each clipped to its own side of the circle and
 * rotated clockwise from twelve o'clock. A half-circle at rest covers its whole
 * side; rotating it *back* pushes the part that has not been earned yet out of
 * its clip, where it is invisible. So the right half draws the first 180° of
 * the sweep and the left half everything past it, and at zero both sit a full
 * half-turn back and nothing shows.
 */
export function ringSweep(fraction: number): RingSweep {
  const degrees = Math.min(1, Math.max(0, finite(fraction))) * 360;
  return {
    right: Math.min(degrees, 180) - 180,
    left: Math.max(Math.min(degrees, 360), 180) - 360,
  };
}
