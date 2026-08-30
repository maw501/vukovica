import { describe, expect, it, vi } from 'vitest';

/**
 * `lib/api.ts` reaches `lib/supabase.ts`, which imports `react-native` and
 * `expo-secure-store` — neither of which loads under vitest's node environment.
 * Stubbing the client module at the boundary is what makes the pure helpers in
 * `lib/api.ts` importable at all; nothing here touches the network, and no test
 * in this file calls a function that would use the stub.
 */
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

const { isMissingStoriesTable, pickCard } = await import('@/lib/api');
type CardRow = Parameters<typeof pickCard>[0][number];

/** A card row with only the fields `pickCard` looks at filled in. */
const card = (sr_cyr: string, en: string): CardRow =>
  ({ id: sr_cyr, sr_cyr, en }) as CardRow;

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

/**
 * Which card a tapped word resolves to, once `ilike` has handed back everything
 * that matches case-insensitively. Pure, so the preference is pinned here
 * rather than left to whichever row Postgres happened to return first.
 */
describe('pickCard', () => {
  it('prefers the exactly-cased card — Месец the moon over месец the month', () => {
    const rows = [card('месец', 'month'), card('Месец', 'moon')];

    expect(pickCard(rows, 'Месец')?.en).toBe('moon');
    expect(pickCard(rows, 'месец')?.en).toBe('month');

    // Order of the rows must not decide it, either way round.
    const flipped = [...rows].reverse();
    expect(pickCard(flipped, 'Месец')?.en).toBe('moon');
    expect(pickCard(flipped, 'месец')?.en).toBe('month');
  });

  it('falls back to a differently-cased card — Мама at the start of a sentence', () => {
    // The deck stores the headword lowercase; the story capitalises it because
    // it opens the line. Same word, and the tap has to find it.
    const rows = [card('мама', 'mum')];
    expect(pickCard(rows, 'Мама')?.en).toBe('mum');
  });

  it('ignores surrounding whitespace on both sides of the comparison', () => {
    expect(pickCard([card('  кућа ', 'house')], ' кућа ')?.en).toBe('house');
  });

  it('is null when nothing actually matches', () => {
    // `ilike` treats `%` and `_` as wildcards, so a row can come back that is
    // not the word at all. That is exactly what this rejects.
    expect(pickCard([card('мама', 'mum')], 'тата')).toBeNull();
    expect(pickCard([], 'мама')).toBeNull();
  });
});
