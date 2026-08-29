/**
 * Typed helpers over supabase-js. This is the whole data layer: every call here
 * is a direct PostgREST request made as the signed-in user, protected by RLS.
 *
 * Later tasks extend this file (queue, reviews, deck CRUD, drills, chat).
 */

import {
  collectLocalDays,
  computeStreak,
  startOfLocalDay,
  streakFromLocalDays,
} from '@/lib/streak';
import { supabase } from '@/lib/supabase';
import type { SettingsRow } from '@/lib/types';

// `settings.new_per_day` is nullable in the row type (a `select` can return
// null for it), so every consumer needs a default. One definition, here.
export const DEFAULT_NEW_PER_DAY = 10;

export { computeStreak };

/** Postgres unique-violation. Thrown when two tabs race to create the settings row. */
const UNIQUE_VIOLATION = '23505';

/**
 * The signed-in user's id, read from the locally cached session (no network
 * round-trip). It is only used to scope queries and to fill `user_id` on
 * insert -- RLS, not this value, is what actually protects the data.
 */
async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const userId = data.session?.user.id;
  if (!userId) throw new Error('Not signed in.');
  return userId;
}

/** The user's settings row, creating it with the schema defaults if absent. */
async function getSettings(): Promise<SettingsRow> {
  const userId = await requireUserId();

  const existing = await supabase
    .from('settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle<SettingsRow>();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;

  // Insert bare: every other column has a database default (show_latin true,
  // new_per_day 10, tts_enabled true), so the defaults live in exactly one place.
  const created = await supabase
    .from('settings')
    .insert({ user_id: userId })
    .select()
    .single<SettingsRow>();
  if (!created.error) return created.data;

  // Lost a race with another tab -- the row exists now, so read it back.
  if (created.error.code === UNIQUE_VIOLATION) {
    const reread = await supabase
      .from('settings')
      .select('*')
      .eq('user_id', userId)
      .single<SettingsRow>();
    if (reread.error) throw reread.error;
    return reread.data;
  }
  throw created.error;
}

/** Persist a partial settings change and return the updated row. */
async function updateSettings(
  patch: Partial<Omit<SettingsRow, 'user_id'>>,
): Promise<SettingsRow> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('settings')
    .update(patch)
    .eq('user_id', userId)
    .select()
    .single<SettingsRow>();
  if (error) throw error;
  return data;
}

export interface DashboardStats {
  /** `user_cards` rows whose `due` has passed. */
  dueCount: number;
  /** Cards the user has never studied -- no `user_cards` row yet. */
  newAvailable: number;
  /** New cards already introduced today (local day), for the daily allowance. */
  newDoneToday: number;
  /** Consecutive local days with at least one review, ending today or yesterday. */
  streakDays: number;
}

/**
 * PostgREST caps a response at `max_rows` (1000 in `supabase/config.toml`), so
 * the streak walks back a page at a time. It stops as soon as the fetched
 * window is known to contain the gap that ends the streak -- which, for a daily
 * learner, is the very first page.
 */
const STREAK_PAGE_SIZE = 1000;
const STREAK_MAX_PAGES = 10;

async function fetchStreakDays(userId: string, now: Date): Promise<number> {
  const days = new Set<string>();
  let streak = 0;

  for (let page = 0; page < STREAK_MAX_PAGES; page += 1) {
    const from = page * STREAK_PAGE_SIZE;
    const { data, error } = await supabase
      .from('review_logs')
      .select('reviewed_at')
      // Redundant under RLS, but it is what lets the planner use
      // `review_logs_user_reviewed_idx`.
      .eq('user_id', userId)
      .order('reviewed_at', { ascending: false })
      .range(from, from + STREAK_PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;

    collectLocalDays(
      data.map((row) => row.reviewed_at),
      days,
    );
    streak = streakFromLocalDays(days, now);

    // Fewer rows than asked for means we have the full history.
    if (data.length < STREAK_PAGE_SIZE) break;
    // If some fetched day is *not* part of the streak, the gap that ends the
    // streak is already inside this window and older rows cannot extend it.
    if (days.size > streak) break;
  }

  return streak;
}

/** Everything the home dashboard shows, in one call. */
async function getDashboard(now: Date = new Date()): Promise<DashboardStats> {
  const userId = await requireUserId();
  const nowIso = now.toISOString();
  const dayStartIso = startOfLocalDay(now).toISOString();

  // The streak paginates, so it runs alongside the four head counts rather than
  // after them. One `Promise.all` over both, so neither can reject unobserved.
  const [[due, totalCards, studiedCards, newToday], streakDays] = await Promise.all([
    Promise.all([
      supabase
        .from('user_cards')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .lte('due', nowIso),
      supabase.from('cards').select('*', { count: 'exact', head: true }),
      // Every `user_cards` row references a card (FK), one row per card, so
      // "cards with no user_cards row" is just the difference of two counts.
      supabase
        .from('user_cards')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId),
      // Pragmatic proxy for "new cards introduced today": a card leaves the
      // `new` state exactly once, and that transition is logged.
      supabase
        .from('review_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('state_before', 'new')
        .gte('reviewed_at', dayStartIso),
    ]),
    fetchStreakDays(userId, now),
  ]);

  for (const result of [due, totalCards, studiedCards, newToday]) {
    if (result.error) throw result.error;
  }

  return {
    dueCount: due.count ?? 0,
    newAvailable: Math.max(0, (totalCards.count ?? 0) - (studiedCards.count ?? 0)),
    newDoneToday: newToday.count ?? 0,
    streakDays,
  };
}

export const api = {
  getSettings,
  updateSettings,
  getDashboard,
};
