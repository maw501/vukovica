import { describe, expect, it } from 'vitest';

import { formatInterval } from '@/lib/format';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatInterval', () => {
  it('shows sub-minute and past intervals as "now"', () => {
    expect(formatInterval(0)).toBe('now');
    expect(formatInterval(-5 * MIN)).toBe('now');
    expect(formatInterval(30_000)).toBe('now');
  });

  it('shows minutes under an hour', () => {
    expect(formatInterval(10 * MIN)).toBe('10m');
    expect(formatInterval(59 * MIN)).toBe('59m');
  });

  it('shows hours under a day', () => {
    expect(formatInterval(HOUR)).toBe('1h');
    expect(formatInterval(23 * HOUR)).toBe('23h');
  });

  it('shows days under a month', () => {
    expect(formatInterval(DAY)).toBe('1d');
    expect(formatInterval(29 * DAY)).toBe('29d');
  });

  it('shows months under a year', () => {
    expect(formatInterval(31 * DAY)).toBe('1mo');
    expect(formatInterval(200 * DAY)).toBe('7mo');
  });

  it('shows years beyond that', () => {
    expect(formatInterval(365 * DAY)).toBe('1y');
    expect(formatInterval(3 * 365 * DAY)).toBe('3y');
  });

  it('rounds to the nearest unit rather than truncating', () => {
    expect(formatInterval(90 * MIN)).toBe('2h');
    expect(formatInterval(Math.round(1.6 * DAY))).toBe('2d');
  });
});
