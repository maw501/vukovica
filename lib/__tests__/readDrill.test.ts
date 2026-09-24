import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildRun,
  buildThemes,
  isSolid,
  MINE_THEME,
  RATE_READ_FN,
  rateReadParams,
  READ_RUN_SIZE,
  READ_SOLID_STREAK,
  remainingCount,
  runSummary,
  solidCount,
  statFor,
  parseDrillWay,
  statsByCard,
  themeCards,
  themeLabel,
  UNRATED_READ,
  type ReadStat,
} from "@/lib/readDrill";
import type { CardRow, ReadStatRow } from "@/lib/types";
import { XP_AWARDS } from "@/lib/xp";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

function wordCard(
  id: string,
  domain = "family",
  overrides: Partial<CardRow> = {},
): CardRow {
  return {
    id,
    sr_cyr: `реч-${id}`,
    en: `word ${id}`,
    pos: "noun",
    gender: null,
    aspect: null,
    example_cyr: "",
    example_en: "",
    domain,
    audio_path: null,
    kind: "word",
    created_by: null,
    created_at: null,
    ...overrides,
  };
}

function statRow(cardId: string, stat: Partial<ReadStatRow>): ReadStatRow {
  return {
    user_id: "u1",
    card_id: cardId,
    easy: 0,
    hard: 0,
    streak: 0,
    last_seen: "2026-09-18T08:00:00Z",
    ...stat,
  };
}

/** A tally map from plain literals, for the ordering tests. */
function tallies(
  entries: Record<string, Partial<ReadStat>>,
): Map<string, ReadStat> {
  return new Map(
    Object.entries(entries).map(([id, stat]) => [
      id,
      { ...UNRATED_READ, ...stat },
    ]),
  );
}

/**
 * A generator that walks a fixed cycle, so a shuffle is reproducible without
 * pinning it to one implementation's exact call pattern.
 */
function cyclingRng(values: readonly number[]) {
  let index = 0;
  return () => values[index++ % values.length];
}

describe("statsByCard", () => {
  it("indexes the rows by card, not by headword", () => {
    // A word can be edited; its id cannot. That is why the tally is keyed here
    // and not on `sr_cyr` the way the letters drill keys its own.
    const stats = statsByCard([
      statRow("c1", { easy: 3, hard: 1, streak: 2 }),
      statRow("c2", { easy: 1, hard: 0, streak: 1 }),
    ]);
    expect(stats.get("c1")).toEqual({ easy: 3, hard: 1, streak: 2 });
    expect(stats.get("c2")).toEqual({ easy: 1, hard: 0, streak: 1 });
  });

  it("reads a null count as zero", () => {
    const stats = statsByCard([
      statRow("c1", { easy: null, hard: null, streak: null }),
    ]);
    expect(stats.get("c1")).toEqual(UNRATED_READ);
  });

  it("refuses to believe a negative count", () => {
    const stats = statsByCard([
      statRow("c1", { easy: -4, hard: -1, streak: -9 }),
    ]);
    expect(stats.get("c1")).toEqual(UNRATED_READ);
  });

  it("is empty for a user who has never read anything here", () => {
    expect(statsByCard([]).size).toBe(0);
  });

  it("keeps Read aloud's and Meaning's tallies apart", () => {
    const rows = [
      statRow("c1", { way: "read", easy: 3, streak: 3 }),
      statRow("c1", { way: "meaning", hard: 1, streak: 0 }),
    ];
    expect(statsByCard(rows, "read").get("c1")).toEqual({
      easy: 3,
      hard: 0,
      streak: 3,
    });
    expect(statsByCard(rows, "meaning").get("c1")).toEqual({
      easy: 0,
      hard: 1,
      streak: 0,
    });
  });

  it("counts a row with no way as a reading, the column's default", () => {
    const rows = [statRow("c1", { easy: 2, streak: 2 })];
    expect(statsByCard(rows).get("c1")?.easy).toBe(2);
    expect(statsByCard(rows, "meaning").size).toBe(0);
  });
});

describe("statFor", () => {
  it("gives a never-read word a blank tally rather than undefined", () => {
    expect(statFor(wordCard("c1"), new Map())).toEqual(UNRATED_READ);
  });

  it("finds the word’s own tally by card id", () => {
    const stats = tallies({
      c1: { easy: 2, hard: 1, streak: 2 },
      c2: { easy: 9, streak: 9 },
    });
    expect(statFor(wordCard("c1"), stats)).toEqual({
      easy: 2,
      hard: 1,
      streak: 2,
    });
  });
});

describe("isSolid", () => {
  it("needs three right in a row", () => {
    expect(READ_SOLID_STREAK).toBe(3);
    expect(isSolid({ easy: 9, hard: 0, streak: 2 })).toBe(false);
    expect(isSolid({ easy: 3, hard: 5, streak: 3 })).toBe(true);
    expect(isSolid({ easy: 30, hard: 0, streak: 12 })).toBe(true);
  });

  it("does not care how many times the word was read right in total", () => {
    expect(isSolid({ easy: 9, hard: 1, streak: 0 })).toBe(false);
  });
});

describe("solidCount", () => {
  it("counts the solid ones", () => {
    const cards = ["c1", "c2", "c3"].map((id) => wordCard(id));
    const stats = tallies({
      c1: { easy: 4, streak: 4 },
      c2: { easy: 1, hard: 2, streak: 0 },
    });
    expect(solidCount(cards, stats)).toBe(1);
    expect(solidCount([], stats)).toBe(0);
  });
});

describe("buildRun", () => {
  const cards = ["c1", "c2", "c3", "c4", "c5"].map((id) => wordCard(id));

  it("has every word in it when the theme is smaller than a run", () => {
    // Nothing is ever withheld, whatever the tallies say: no allowance, no
    // "due", no waiting until tomorrow.
    const run = buildRun({
      cards,
      stats: tallies({ c1: { easy: 50, streak: 50 } }),
    });
    expect(run).toHaveLength(cards.length);
    expect(new Set(run.map((card) => card.id))).toEqual(
      new Set(cards.map((card) => card.id)),
    );
  });

  it("leads with the words missed last time, then the unseen ones, then the rest", () => {
    const stats = tallies({
      c1: { easy: 6, streak: 6 }, // solid, so last
      c2: { easy: 1, hard: 3, streak: 0 }, // missed last time -> first
      c3: { easy: 2, hard: 0, streak: 2 }, // going well, but not solid
      c4: { easy: 0, hard: 1, streak: 0 }, // missed last time -> first
      // c5 has no row at all -> never read
    });
    const run = buildRun({ cards, stats, random: () => 0 }).map(
      (card) => card.id,
    );

    expect(new Set(run.slice(0, 2))).toEqual(new Set(["c2", "c4"]));
    expect(run[2]).toBe("c5");
    expect(run.slice(3)).toEqual(["c3", "c1"]);
  });

  it("orders the rest by the shortest run of right answers first", () => {
    const stats = tallies({
      c1: { easy: 5, hard: 1, streak: 5 },
      c2: { easy: 1, hard: 1, streak: 1 },
      c3: { easy: 3, hard: 1, streak: 3 },
      c4: { easy: 2, hard: 1, streak: 2 },
      c5: { easy: 4, hard: 1, streak: 4 },
    });
    expect(
      buildRun({ cards, stats, random: () => 0 }).map((card) => card.id),
    ).toEqual(["c2", "c4", "c3", "c5", "c1"]);
  });

  it("caps a run at twenty words", () => {
    expect(READ_RUN_SIZE).toBe(20);
    const many = Array.from({ length: 57 }, (_, index) =>
      wordCard(`w${index}`),
    );
    expect(buildRun({ cards: many, stats: tallies({}) })).toHaveLength(
      READ_RUN_SIZE,
    );
  });

  it("builds the next run from the words the sitting has not reached", () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      wordCard(`w${index}`),
    );
    const first = buildRun({
      cards: many,
      stats: tallies({}),
      random: () => 0,
    });
    const seen = new Set(first.map((card) => card.id));

    const second = buildRun({
      cards: many,
      stats: tallies({}),
      seen,
      random: () => 0,
    });
    expect(second).toHaveLength(10);
    for (const card of second) expect(seen.has(card.id)).toBe(false);
    expect(remainingCount(many, seen)).toBe(10);
  });

  it("still leads the next run with what was just missed", () => {
    const many = Array.from({ length: 25 }, (_, index) =>
      wordCard(`w${index}`),
    );
    const seen = new Set(many.slice(0, 20).map((card) => card.id));
    // w22 was answered wrong in an earlier sitting; it is still in the pool.
    const stats = tallies({ w22: { easy: 1, hard: 2, streak: 0 } });

    const next = buildRun({ cards: many, stats, seen, random: () => 0 });
    expect(next[0]?.id).toBe("w22");
  });

  it("shuffles inside a band, so two runs are not the same run", () => {
    const stats = tallies({});
    const first = buildRun({
      cards,
      stats,
      random: cyclingRng([0.99, 0.05, 0.6, 0.2]),
    });
    const second = buildRun({
      cards,
      stats,
      random: cyclingRng([0.1, 0.8, 0.3, 0.95]),
    });

    expect(first.map((card) => card.id)).not.toEqual(
      second.map((card) => card.id),
    );
    for (const run of [first, second]) {
      expect(new Set(run.map((card) => card.id)).size).toBe(cards.length);
    }
  });

  it("never shuffles a word out of its band", () => {
    const stats = tallies({
      c1: { easy: 1, hard: 1, streak: 0 },
      c2: { easy: 1, hard: 1, streak: 0 },
      c3: { easy: 9, streak: 9 },
      c4: { easy: 9, streak: 9 },
    });
    const run = buildRun({
      cards: cards.slice(0, 4),
      stats,
      random: cyclingRng([0.99, 0.01, 0.5]),
    }).map((card) => card.id);

    expect(new Set(run.slice(0, 2))).toEqual(new Set(["c1", "c2"]));
    expect(new Set(run.slice(2))).toEqual(new Set(["c3", "c4"]));
  });

  it("does not mutate the cards it was given", () => {
    const input = [...cards];
    buildRun({
      cards: input,
      stats: tallies({}),
      random: cyclingRng([0.9, 0.1]),
    });
    expect(input.map((card) => card.id)).toEqual(cards.map((card) => card.id));
  });

  it("copes with a theme that has not loaded yet, and with one that is finished", () => {
    expect(buildRun({ cards: [], stats: tallies({}) })).toEqual([]);
    const seen = new Set(cards.map((card) => card.id));
    expect(buildRun({ cards, stats: tallies({}), seen })).toEqual([]);
  });
});

describe("runSummary", () => {
  it("says what the run came to, in plain English", () => {
    expect(runSummary({ gotIt: 16, notYet: 4 })).toBe(
      "20 words · 16 got it · 4 not yet",
    );
  });

  it("counts one word as one word", () => {
    expect(runSummary({ gotIt: 1, notYet: 0 })).toBe(
      "1 word · 1 got it · 0 not yet",
    );
  });

  it('has no jargon in it — no grades, no intervals, no "due"', () => {
    const line = runSummary({ gotIt: 3, notYet: 2 });
    for (const word of ["due", "again", "hard", "easy", "interval", "card"]) {
      expect(line.toLowerCase()).not.toContain(word);
    }
  });
});

describe("buildThemes", () => {
  const cards = [
    wordCard("c1", "family"),
    wordCard("c2", "family"),
    wordCard("c3", "baby"),
    wordCard("c4", "verbs-core"),
  ];
  const stats = tallies({
    c1: { easy: 3, streak: 3 },
    c4: { easy: 9, streak: 9 },
  });

  it("leads with My words, then names every domain the deck has", () => {
    const themes = buildThemes({
      cards,
      stats,
      knownIds: new Set(["c1", "c3"]),
    });
    expect(themes.map((theme) => theme.label)).toEqual([
      "My words",
      "Baby",
      "Everyday verbs",
      "Family",
    ]);
    expect(themes[0]).toEqual({
      domain: MINE_THEME,
      label: "My words",
      total: 2,
      solid: 1,
    });
  });

  it("counts each theme’s words and how many are solid", () => {
    const themes = buildThemes({ cards, stats });
    expect(themes.find((theme) => theme.domain === "family")).toEqual({
      domain: "family",
      label: "Family",
      total: 2,
      solid: 1,
    });
    expect(themes.find((theme) => theme.domain === "baby")?.solid).toBe(0);
  });

  it("offers a domain nobody has named yet, under its own slug", () => {
    // Content arrives as rows between sessions; the picker must not wait for
    // `DOMAIN_LABELS` to catch up.
    const themes = buildThemes({
      cards: [wordCard("c9", "winter-clothes")],
      stats: tallies({}),
    });
    expect(themes.map((theme) => theme.label)).toEqual([
      "My words",
      "Winter clothes",
    ]);
  });

  it("does not list the quick-add domain as a theme of its own", () => {
    // Quick-added words live under `my-words` and are known by construction,
    // so they are already counted in My words. A second row would say
    // "My words" twice with two different numbers.
    const themes = buildThemes({
      cards: [wordCard("c1", "family"), wordCard("q1", "my-words")],
      stats: tallies({}),
      knownIds: new Set(["q1"]),
    });
    expect(themes.map((theme) => theme.label)).toEqual(["My words", "Family"]);
    expect(themes[0].total).toBe(1);
  });

  it("offers My words even when there are none yet", () => {
    const themes = buildThemes({ cards, stats: tallies({}) });
    expect(themes[0]).toEqual({
      domain: MINE_THEME,
      label: "My words",
      total: 0,
      solid: 0,
    });
  });

  it("leaves out a card with no domain on it at all", () => {
    // A quick-added card can have an empty domain; it still belongs to My words
    // once it is known, but it is not a theme of its own.
    const themes = buildThemes({
      cards: [wordCard("c9", "")],
      stats: tallies({}),
      knownIds: new Set(["c9"]),
    });
    expect(themes).toHaveLength(1);
    expect(themes[0].total).toBe(1);
  });
});

describe("themeCards and themeLabel", () => {
  const cards = [
    wordCard("c1", "family"),
    wordCard("c2", "baby"),
    wordCard("c3", "family"),
  ];

  it("runs one domain’s words", () => {
    expect(
      themeCards({ theme: "family", cards }).map((card) => card.id),
    ).toEqual(["c1", "c3"]);
  });

  it("runs the words he knows for the My words theme", () => {
    expect(
      themeCards({ theme: MINE_THEME, cards, knownIds: new Set(["c2"]) }).map(
        (card) => card.id,
      ),
    ).toEqual(["c2"]);
  });

  it("is empty for a theme with nothing in it", () => {
    expect(themeCards({ theme: "weather", cards })).toEqual([]);
    expect(themeCards({ theme: MINE_THEME, cards })).toEqual([]);
  });

  it("names the theme for the top of the drill", () => {
    expect(themeLabel(MINE_THEME)).toBe("My words");
    expect(themeLabel("greetings-courtesy")).toBe("Greetings and manners");
  });

  it("reads a domain the same way the picker does", () => {
    // The picker keyed on a trimmed domain and the run matched the raw column,
    // so a row stored as "family " was offered with a count and then opened an
    // empty run. One rule, checked from both ends.
    const padded = [wordCard("c1", "family "), wordCard("c2", " family")];
    const themes = buildThemes({ cards: padded, stats: tallies({}) });
    const family = themes.find((entry) => entry.domain === "family");

    expect(family?.total).toBe(2);
    expect(
      themeCards({ theme: family!.domain, cards: padded }).map(
        (card) => card.id,
      ),
    ).toEqual(["c1", "c2"]);
  });
});

describe("rateReadParams", () => {
  it("sends the card, the verdict and the way, and nothing else", () => {
    expect(rateReadParams("card-1", true, "read")).toEqual({
      p_card_id: "card-1",
      p_got_it: true,
      p_way: "read",
    });
    expect(rateReadParams("card-1", false, "meaning")).toEqual({
      p_card_id: "card-1",
      p_got_it: false,
      p_way: "meaning",
    });
  });

  it("never sends a user id — the function takes that from auth.uid()", () => {
    expect(Object.keys(rateReadParams("card-1", true, "read"))).toEqual([
      "p_card_id",
      "p_got_it",
      "p_way",
    ]);
  });
});

describe("parseDrillWay", () => {
  it("reads meaning, and treats anything else as Read aloud", () => {
    expect(parseDrillWay("meaning")).toBe("meaning");
    expect(parseDrillWay([" meaning "])).toBe("meaning");
    expect(parseDrillWay("read")).toBe("read");
    expect(parseDrillWay(undefined)).toBe("read");
    expect(parseDrillWay("write")).toBe("read");
  });
});

// ---------------------------------------------------------------------------
// The migration, read as text.
//
// The SQL is not TypeScript: a renamed argument, a `security definer` slipped in
// during a later edit, or a changed XP literal would all type-check perfectly
// and only fail (or quietly misbehave) at runtime.
// ---------------------------------------------------------------------------

const migration = readFileSync(
  path.join(
    repoRoot,
    "supabase",
    "migrations",
    "20260918160000_read_stats.sql",
  ),
  "utf8",
);

/**
 * The migration that holds `rate_read`'s current definition: it was dropped and
 * recreated with `p_way` when Meaning became a drill. The table tests below
 * still read the original, which is where the table is created.
 */
const wayMigration = readFileSync(
  path.join(
    repoRoot,
    "supabase",
    "migrations",
    "20260924120000_read_stats_way.sql",
  ),
  "utf8",
);

/** The `p_*` argument names the current function declares, in declaration order. */
function migrationParameterNames(): string[] {
  const signature = wayMigration.slice(
    wayMigration.indexOf(`create function public.${RATE_READ_FN}(`),
    wayMigration.indexOf("returns public.read_stats"),
  );
  return [...signature.matchAll(/^\s*(p_[a-z_]+)\s+/gm)].map(
    (match) => match[1],
  );
}

describe("the read_stats migration keeps its contract", () => {
  it("creates the table with the columns the drill tallies", () => {
    // Sliced to the `create table` statement itself, not searched over the
    // whole file: every one of these words also appears in a policy, in the
    // function body or in a comment, so a file-wide `toContain` would pass just
    // as happily with a column missing from the table.
    const start = migration.indexOf("create table public.read_stats");
    expect(start).toBeGreaterThan(-1);
    const table = migration.slice(start, migration.indexOf(");", start));

    for (const column of [
      /user_id\s+uuid not null/,
      /card_id\s+uuid not null/,
      /easy\s+int not null default 0/,
      /hard\s+int not null default 0/,
      /streak\s+int not null default 0/,
      // Stricter than `letter_stats`, whose `last_seen` is nullable; `ReadStatRow`
      // types it as always present on the strength of this.
      /last_seen\s+timestamptz not null default now\(\)/,
    ]) {
      expect(table, String(column)).toMatch(column);
    }
    expect(table).toContain("primary key (user_id, card_id)");
    expect(table).toContain("references auth.users (id) on delete cascade");
    // The tally goes when the card does: nothing should be left pointing at a
    // word that is no longer in the deck.
    expect(table).toContain("references public.cards (id) on delete cascade");
  });

  it("locks the table to its owner, and lets nobody delete a tally", () => {
    expect(migration).toContain(
      "alter table public.read_stats enable row level security",
    );
    for (const action of ["select", "insert", "update"]) {
      expect(migration).toContain(`create policy read_stats_${action}_own`);
    }
    expect(migration).not.toContain("create policy read_stats_delete_own");
    expect(migration).toContain(
      "revoke all on public.read_stats from authenticated, anon;",
    );
    expect(migration).toContain(
      "grant select, insert, update on public.read_stats to authenticated;",
    );
  });

  it("creates the rating function at all (guards every assertion below)", () => {
    expect(wayMigration).toContain(`create function public.${RATE_READ_FN}(`);
  });

  it("declares exactly the arguments the client sends", () => {
    expect(migrationParameterNames()).toEqual(
      Object.keys(rateReadParams("card-1", true, "read")),
    );
  });

  it("keeps the function under the caller’s RLS, not the definer’s", () => {
    expect(wayMigration).toContain("security invoker");
    expect(wayMigration).toContain("set search_path = public, pg_temp");
    expect(wayMigration).not.toContain("security definer");
    expect(migration).not.toContain("security definer");
  });

  it("fills user_id from auth.uid() rather than trusting an argument", () => {
    expect(wayMigration).toContain("auth.uid()");
    expect(migrationParameterNames()).not.toContain("p_user_id");
  });

  it("refuses a card that is not a word", () => {
    // A letter card's `sr_cyr` is a pair, not something to read aloud and
    // translate — the letters have their own drill and their own tally.
    expect(wayMigration).toMatch(
      /if not exists \(\s*select 1 from public\.cards\s*where cards\.id = p_card_id and cards\.kind = 'word'\s*\)/,
    );
    // ...and it must come before the write, not after it.
    expect(wayMigration.indexOf("cards.kind = 'word'")).toBeLessThan(
      wayMigration.indexOf("insert into public.read_stats"),
    );
  });

  it("adds to the tally instead of replacing it", () => {
    // The reason the RPC exists at all: PostgREST's upsert would write
    // `excluded.easy` and silently lose every concurrent rating.
    expect(wayMigration).toMatch(/easy\s*=\s*rs\.easy\s*\+/);
    expect(wayMigration).toMatch(/hard\s*=\s*rs\.hard\s*\+/);
  });

  it('resets the streak on "Not yet" and never decrements it', () => {
    expect(wayMigration).toMatch(
      /streak\s*=\s*case when p_got_it then rs\.streak \+ 1 else 0 end/,
    );
    expect(wayMigration).not.toMatch(/streak\s*=\s*rs\.streak\s*-/);
  });

  it("pays the same XP a word review pays, in the same transaction", () => {
    const award = wayMigration.match(
      /insert into public\.xp_events \(user_id, amount, kind\)\s*values \(v_user_id, (\d+), '(\w+)'\)/,
    );
    expect(award).not.toBeNull();
    expect(Number(award?.[1])).toBe(XP_AWARDS.review);
    // 'review' is one of the kinds `xp_events`'s check constraint allows, and
    // the one the day streak already counts (20260830150000_phase3_schema.sql).
    expect(award?.[2]).toBe("review");
  });

  it("grants execute explicitly and takes the default PUBLIC and anon grants back", () => {
    expect(wayMigration).toMatch(
      /revoke execute on function public\.rate_read\([\s\S]*?\) from public;/,
    );
    expect(wayMigration).toMatch(
      /revoke execute on function public\.rate_read\([\s\S]*?\) from anon;/,
    );
    expect(wayMigration).toMatch(
      /grant execute on function public\.rate_read\([\s\S]*?\) to authenticated;/,
    );
  });

  it("leaves the review queue alone — reading a word is not answering it", () => {
    for (const sql of [migration, wayMigration]) {
      expect(sql).not.toMatch(/insert into public\.user_cards/);
      expect(sql).not.toMatch(/update public\.user_cards/);
      expect(sql).not.toMatch(/delete from public\.user_cards/);
    }
  });
});

describe("the read_stats way migration keeps the two tallies apart", () => {
  it("adds a checked way column that defaults every existing row to a reading", () => {
    expect(wayMigration).toMatch(
      /add column way text not null default 'read'\s+constraint read_stats_way_check check \(way in \('read', 'meaning'\)\)/,
    );
  });

  it("makes the way part of the key, and upserts on the same key", () => {
    expect(wayMigration).toContain("add primary key (user_id, card_id, way)");
    expect(wayMigration).toContain("on conflict (user_id, card_id, way)");
  });

  it("replaces the two-argument function rather than overloading it", () => {
    expect(wayMigration).toContain("drop function public.rate_read(uuid, boolean);");
    // A default, so a client that still sends two arguments keeps writing
    // reading tallies until it reloads.
    expect(wayMigration).toMatch(/p_way\s+text default 'read'/);
  });

  it("refuses a way it does not know before writing anything", () => {
    expect(wayMigration).toMatch(/if p_way is null or p_way not in \('read', 'meaning'\)/);
    expect(wayMigration.indexOf("p_way not in")).toBeLessThan(
      wayMigration.indexOf("insert into public.read_stats"),
    );
  });

  it("offers exactly the ways the client can send", () => {
    const allowed = [...wayMigration.matchAll(/way in \(([^)]*)\)/g)].map((m) => m[1]);
    expect(allowed.length).toBeGreaterThan(0);
    for (const list of allowed) expect(list).toBe("'read', 'meaning'");
  });
});
