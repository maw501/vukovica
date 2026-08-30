import { describe, expect, it, vi } from 'vitest';

/**
 * `lib/api.ts` reaches `lib/supabase.ts`, which imports `react-native` and
 * `expo-secure-store` — neither of which loads under vitest's node environment.
 * Stubbing the client module at the boundary is what makes the pure helpers in
 * `lib/api.ts` importable at all; nothing here touches the network, and no test
 * in this file calls a function that would use the stub.
 */
vi.mock('@/lib/supabase', () => ({
  supabase: {},
  functionsUrl: 'http://supabase.invalid/functions/v1',
}));

const { isMissingStoriesTable } = await import('@/lib/api');

/**
 * The `stories` table arrives with the graded reader later in this phase, so
 * `getProgress` reads a missing relation as "no stories finished" rather than
 * failing. That leniency has to stop at the table: a *column* error means the
 * reader migration and this query disagree, and swallowing it would report 0
 * stories forever instead of saying so.
 */
describe('isMissingStoriesTable', () => {
  it('is true for a missing relation, by code', () => {
    // Postgres, once the statement reaches it.
    expect(
      isMissingStoriesTable({
        code: '42P01',
        message: 'relation "public.stories" does not exist',
      }),
    ).toBe(true);

    // PostgREST, from its cached schema, before the statement is ever sent.
    expect(
      isMissingStoriesTable({
        code: 'PGRST205',
        message: "Could not find the table 'public.stories' in the schema cache",
      }),
    ).toBe(true);
  });

  it('is true for a relation-shaped message under an unknown code', () => {
    expect(
      isMissingStoriesTable({ message: 'relation "public.stories" does not exist' }),
    ).toBe(true);
  });

  it('is false for a missing column — that is a real mismatch to surface', () => {
    expect(
      isMissingStoriesTable({
        code: '42703',
        message: 'column stories.finished_at does not exist',
      }),
    ).toBe(false);

    expect(
      isMissingStoriesTable({
        code: 'PGRST204',
        message: "Could not find the 'finished_at' column of 'stories' in the schema cache",
      }),
    ).toBe(false);
  });

  it('is false for a permission failure', () => {
    // A missing RLS policy or grant on `stories` must not read as "no stories".
    expect(
      isMissingStoriesTable({
        code: '42501',
        message: 'permission denied for table stories',
      }),
    ).toBe(false);
  });

  it('is false for an empty or absent error shape', () => {
    expect(isMissingStoriesTable({})).toBe(false);
    expect(isMissingStoriesTable({ code: '', message: '' })).toBe(false);
  });
});
