/**
 * Small display formatters. Pure, so they can be unit-tested without a renderer.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * A duration in milliseconds as the short label under a grade button ("10m",
 * "3d", "2mo"). Anything under a minute — including a negative interval, which
 * FSRS never produces but a clock skew could — reads as "now".
 */
export function formatInterval(ms: number): string {
  if (ms < MINUTE) return 'now';
  if (ms < HOUR) return `${Math.round(ms / MINUTE)}m`;
  if (ms < DAY) return `${Math.round(ms / HOUR)}h`;
  if (ms < MONTH) return `${Math.round(ms / DAY)}d`;
  if (ms < YEAR) return `${Math.round(ms / MONTH)}mo`;
  return `${Math.round(ms / YEAR)}y`;
}
