/**
 * Serbian Cyrillic <-> Latin transliteration.
 *
 * The app stores Cyrillic only; Latin is derived at render time. Both
 * functions are pure, dependency free, and total: anything outside the
 * Serbian alphabet passes through untouched.
 *
 * The two scripts map one-to-one letter-wise, except that љ, њ and џ are
 * written as Latin digraphs (lj, nj, dž), which is where all of the
 * casing and parsing subtlety lives.
 */

/** Serbian Cyrillic letter -> Serbian Latin letter, in Vuk's order. */
const CYR_TO_LAT: Readonly<Record<string, string>> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  ђ: 'đ',
  е: 'e',
  ж: 'ž',
  з: 'z',
  и: 'i',
  ј: 'j',
  к: 'k',
  л: 'l',
  љ: 'lj',
  м: 'm',
  н: 'n',
  њ: 'nj',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  ћ: 'ć',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'c',
  ч: 'č',
  џ: 'dž',
  ш: 'š',
};

/** Serbian Latin letter -> Serbian Cyrillic letter, digraphs included. */
const LAT_TO_CYR: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(CYR_TO_LAT).map(([cyr, lat]) => [lat, cyr]),
);

/** Length of the longest Latin letter ("lj", "nj", "dž"). */
const MAX_LAT_LETTER_LENGTH = 2;

function isUpper(char: string | undefined): boolean {
  return char !== undefined && char !== char.toLowerCase() && char === char.toUpperCase();
}

function isLower(char: string | undefined): boolean {
  return char !== undefined && char !== char.toUpperCase() && char === char.toLowerCase();
}

/**
 * Decide how to case an uppercase Cyrillic digraph letter at `index`.
 *
 * `Њ` is `Nj` in a title-case word (Његош -> Njegoš) but `NJ` in an
 * all-caps one (ЊЕГОШ -> NJEGOŠ). The neighbouring letters tell us which:
 * the next one if there is one, otherwise the previous (КРАЉ -> KRALJ).
 * With no letter on either side we assume all caps.
 */
function digraphIsAllCaps(input: string, index: number): boolean {
  for (const neighbour of [input[index + 1], input[index - 1]]) {
    if (isLower(neighbour)) return false;
    if (isUpper(neighbour)) return true;
  }
  return true;
}

/** Transliterate Serbian Cyrillic to Serbian Latin. */
export function cyrToLat(input: string): string {
  let output = '';

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const lower = char.toLowerCase();
    const lat = CYR_TO_LAT[lower];

    if (lat === undefined) {
      output += char;
    } else if (char === lower) {
      output += lat;
    } else if (lat.length === 1 || digraphIsAllCaps(input, i)) {
      output += lat.toUpperCase();
    } else {
      output += lat[0].toUpperCase() + lat.slice(1);
    }
  }

  return output;
}

/** Transliterate Serbian Latin to Serbian Cyrillic. */
export function latToCyr(input: string): string {
  let output = '';
  let i = 0;

  while (i < input.length) {
    let matched = false;

    // Longest match first, so digraphs win over their first letter.
    for (let length = MAX_LAT_LETTER_LENGTH; length >= 1; length -= 1) {
      const slice = input.slice(i, i + length);
      if (slice.length < length) continue;

      const cyr = LAT_TO_CYR[slice.toLowerCase()];
      if (cyr === undefined) continue;

      output += isUpper(slice[0]) ? cyr.toUpperCase() : cyr;
      i += length;
      matched = true;
      break;
    }

    if (!matched) {
      output += input[i];
      i += 1;
    }
  }

  return output;
}
