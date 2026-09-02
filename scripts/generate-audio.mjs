#!/usr/bin/env node
/**
 * Generate the pronunciation clip for every card, once, offline.
 *
 * Phase 3 deleted the `tts` Edge Function and with it the last runtime AI call.
 * Audio is now a build artefact: this script speaks each card, uploads the clip
 * to the public `audio` bucket under `cards/`, and writes that key back to
 * `cards.audio_path`. The app only ever reads the column (`lib/audio.ts`), so a
 * card with a clip gets a speaker button and one without gets no button at all
 * — never a button that does nothing.
 *
 * THE LETTER DECK IS NOT THIS SCRIPT'S TO SPEAK. The 30 letter clips are Mark's
 * wife reading the alphabet, stored at `cards/<id>-w1.mp3`. They are
 * irreplaceable — no engine here can regenerate them — so every engine skips
 * `kind='letter'` unless `--letters` is passed, and passing it prints a warning
 * loud enough that nobody does it by accident. See the README's "The letter
 * cards' audio is human, not TTS" note.
 *
 * Engines:
 *   azure (default)  Azure Cognitive Services neural TTS, voices
 *                    `sr-RS-SophieNeural` and `sr-RS-NicholasNeural`, split per
 *                    card by a hash of its id so the deck has two speakers and
 *                    a re-run gives a card the same one. Writes `-a1.mp3`.
 *   piper            Piper (https://github.com/OHF-voice/piper1-gpl), voice
 *                    `sr_RS-serbski_institut-medium`. Free, entirely offline,
 *                    no account. The fallback when there is no Azure key.
 *                    Writes `<id>.mp3`, as it always did.
 *
 * Neither engine is an npm dependency — see docs/plans/audio-batch.md for the
 * Azure key, the one-time Piper install, and the espeak path gotcha this script
 * works around.
 *
 * What each clip says:
 *   letter cards  the letter's *sound*, a beat, then its example word
 *                 ("б, беба") — only ever reachable with `--letters`.
 *   word cards    the headword alone (`sr_cyr`), nothing else.
 *
 * Usage:
 *   node --env-file=.env.hosted scripts/generate-audio.mjs        # azure, local db
 *   node scripts/generate-audio.mjs --hosted                      # azure, production
 *   node --env-file=.env.local scripts/generate-audio.mjs --engine=piper
 *
 * Flags:
 *   --engine=azure  which voice to speak with: `azure` (default) or `piper`.
 *   --letters       include the letter deck. Overwrites Mark's wife's
 *                   recordings with a synthetic voice. Almost never right.
 *   --hosted        read `.env.hosted` instead of relying on --env-file. Nothing
 *                   else changes: same bucket, same column, same clips.
 *   --force         re-speak and re-upload cards whose `audio_path` already
 *                   points at this engine's clip. Without it those are skipped,
 *                   which is what makes a re-run after adding cards cheap.
 *   --kind=word     restrict to one deck (`letter` or `word`).
 *   --limit=N       stop after N cards. Handy for a smoke run.
 *   --dry-run       synthesise and check, but upload nothing and write nothing.
 *                   Azure still spends the API calls, so pair it with --limit.
 *
 * Environment:
 *   SUPABASE_URL               e.g. http://127.0.0.1:54321
 *   SUPABASE_SERVICE_ROLE_KEY  service-role key; bypasses RLS. Never ship this
 *                              to the client bundle.
 *   AZURE_SPEECH_KEY           azure engine only. Export it, put it in the file
 *   AZURE_SPEECH_REGION        passed to --env-file, or use --hosted (which
 *                              loads .env.hosted, where both already live).
 *   PIPER_BIN                  piper engine only; the `piper` executable, if it
 *                              is not on PATH.
 *   PIPER_VOICE                piper engine only; the `.onnx` voice file, if it
 *                              is not in one of the usual places.
 *   ESPEAK_DATA_PATH           piper engine only; overrides the shim below.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, symlinkSync, rmSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(scriptDir, '..');

/** Storage bucket and key prefix. Public-read; created by the first migration. */
const AUDIO_BUCKET = 'audio';
const KEY_PREFIX = 'cards';

/**
 * The suffix each engine puts on its key, so a card's clips from different
 * engines never collide and `audio_path` says which one the app is playing.
 *
 * `-w1` is the odd one out: it is *Mark's wife*, recorded once, and nothing in
 * this file ever writes it. It is here so the guard below can name what it is
 * protecting.
 */
const ENGINE_SUFFIX = { piper: '', azure: '-a1' };
const HUMAN_SUFFIX = '-w1';

/** The two Serbian neural voices the word deck is split between. */
const AZURE_VOICES = ['sr-RS-SophieNeural', 'sr-RS-NicholasNeural'];

/** Azure's mp3 profile: 24 kHz mono, 96 kbit. Small, and no conversion step. */
const AZURE_FORMAT = 'audio-24khz-96kbitrate-mono-mp3';

/** How many times a throttled (429) or wobbling (5xx) request is retried. */
const AZURE_MAX_ATTEMPTS = 6;

/**
 * Anything shorter than this is silence, not speech. The shortest real clip
 * measured is ~0.5s ("брз"), so the gate is generous — it exists to catch a
 * card whose text synthesised to nothing, not to judge pace.
 */
const MIN_CLIP_SECONDS = 0.2;

/** The same gate for when ffprobe is not installed: no mp3 this short is speech. */
const MIN_CLIP_BYTES = 1024;

/** Cards fetched per request, and clips synthesised per Piper process. */
const BATCH_SIZE = 200;

/**
 * espeak-ng truncates its data path at 160 characters and then silently falls
 * back to the path baked in at *its* build time — which, for a wheel built on
 * CI, is a directory on someone else's machine. The failure looks like
 * "Error processing file '/Users/runner/.../phontab'" and produces a 0-byte
 * WAV. Piper ships the data inside its site-packages, which is comfortably over
 * the limit in any virtualenv with a long path, so short-circuit it with a
 * symlink somewhere short. See docs/plans/audio-batch.md.
 */
const ESPEAK_PATH_LIMIT = 150;

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(`--${name}`);
const flagValue = (name) => {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const options = {
  engine: flagValue('engine') ?? 'azure',
  letters: hasFlag('letters'),
  hosted: hasFlag('hosted'),
  force: hasFlag('force'),
  dryRun: hasFlag('dry-run'),
  kind: flagValue('kind'),
  limit: flagValue('limit') ? Number(flagValue('limit')) : null,
};

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!Object.hasOwn(ENGINE_SUFFIX, options.engine)) {
  fail(`--engine must be 'azure' or 'piper', not '${options.engine}'.`);
}
if (options.kind && options.kind !== 'letter' && options.kind !== 'word') {
  fail(`--kind must be 'letter' or 'word', not '${options.kind}'.`);
}
if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 1)) {
  fail('--limit must be a positive whole number.');
}

// ---------------------------------------------------------------------------
// The letter guard
// ---------------------------------------------------------------------------

/**
 * The 30 letter clips are a person, not an engine. They were recorded once, in
 * a kitchen, by the mother of the child this app exists for; the files live in
 * `recordings/letter-clips/` (git-ignored, one machine) and in the bucket at
 * `cards/<id>-w1.mp3`. There is no way to regenerate them and no TTS that
 * substitutes for them.
 *
 * So the letter deck is opt-in under *every* engine, and opting in says so out
 * loud. Refusing `--kind=letter` without `--letters` rather than silently
 * speaking nothing is deliberate: a flag that quietly does nothing is worse
 * than one that explains itself.
 */
if (options.kind === 'letter' && !options.letters) {
  fail(
    "--kind=letter alone is refused: the letter clips are Mark's wife's voice\n" +
      `(${KEY_PREFIX}/<id>${HUMAN_SUFFIX}.mp3), not something a TTS can regenerate. Pass\n` +
      '--letters as well if you genuinely mean to replace them with a synthetic voice.',
  );
}

if (options.letters) {
  console.warn('');
  console.warn('  !!  --letters: ABOUT TO SPEAK THE LETTER DECK WITH A SYNTHETIC VOICE  !!');
  console.warn('');
  console.warn("  The 30 letter clips are Mark's wife reading the alphabet, recorded once.");
  console.warn(`  They live at ${KEY_PREFIX}/<id>${HUMAN_SUFFIX}.mp3 and in recordings/letter-clips/.`);
  console.warn('  They CANNOT be regenerated. This run will point cards.audio_path at a');
  console.warn(`  ${options.engine} clip instead, and the app will play a machine to a toddler.`);
  console.warn('');
  console.warn('  If that is not what you want, stop now (ctrl-C) and drop --letters.');
  console.warn('');
}

/** The decks this run may touch, after the guard has had its say. */
const kinds = options.kind ? [options.kind] : options.letters ? ['letter', 'word'] : ['word'];

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

if (options.hosted) {
  const hostedEnv = path.join(repoRoot, '.env.hosted');
  if (!existsSync(hostedEnv)) {
    fail('--hosted needs a .env.hosted file at the repo root (ship-runbook.md step 1).');
  }
  process.loadEnvFile(hostedEnv);
}

function requireEnv(name, hint) {
  const value = process.env[name];
  if (!value) {
    fail(
      hint ??
        `Missing ${name}. Run with --env-file=.env.local (or pass --hosted to read\n` +
          '.env.hosted). Local values come from `npx supabase status`.',
    );
  }
  return value;
}

const supabaseUrl = requireEnv('SUPABASE_URL');
const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------
// What each card says, and where its clip goes
// ---------------------------------------------------------------------------

/**
 * The line of Serbian to speak for a card.
 *
 * A letter card's `sr_cyr` is the pair as printed ("Б б"), so the lowercase form
 * is the second half; speaking the pair verbatim would say the letter twice.
 * The comma is doing real work — it makes the synthesiser insert a clause break,
 * which is the pause between the sound and the example word.
 */
function clipText(card) {
  if (card.kind !== 'letter') return card.sr_cyr.trim();

  const parts = card.sr_cyr.trim().split(/\s+/);
  const lower = parts[parts.length - 1];
  const example = card.example_cyr?.trim();
  return example ? `${lower}, ${example}` : lower;
}

/** Where this engine's clip for a card belongs, which is also what makes a re-run cheap. */
function targetKey(card) {
  return `${KEY_PREFIX}/${card.id}${ENGINE_SUFFIX[options.engine]}.mp3`;
}

// ---------------------------------------------------------------------------
// Engine: Azure neural TTS
// ---------------------------------------------------------------------------

/**
 * Which of the two voices speaks a card.
 *
 * A hash of the card's id rather than its position, so the split is stable: a
 * re-run, a re-seed that reorders the deck, or a `--limit` smoke test all give
 * a card the same speaker it had before. Two voices because a deck read
 * entirely by one is monotonous, and because hearing a word from a woman and a
 * man is closer to hearing it from a family.
 */
function azureVoiceFor(cardId) {
  const digest = createHash('md5').update(cardId).digest('hex');
  return AZURE_VOICES[Number(BigInt(`0x${digest}`) % 2n)];
}

function escapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function azureSsml(voice, text) {
  return `<speak version='1.0' xml:lang='sr-RS'><voice name='${voice}'>${escapeXml(text)}</voice></speak>`;
}

function azureEngine() {
  const key = requireEnv(
    'AZURE_SPEECH_KEY',
    'Missing AZURE_SPEECH_KEY. The azure engine needs it and AZURE_SPEECH_REGION:\n' +
      'export them, put them in the file you pass to --env-file, or use --hosted\n' +
      '(which loads .env.hosted, where both already live). Or run --engine=piper,\n' +
      'which needs no key at all.',
  );
  const region = requireEnv(
    'AZURE_SPEECH_REGION',
    'Missing AZURE_SPEECH_REGION (e.g. westeurope). See AZURE_SPEECH_KEY above.',
  );
  const endpoint = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;

  /** One card. Returns the mp3 bytes, or throws with something worth reading. */
  async function speakOne(card) {
    const voice = azureVoiceFor(card.id);
    const body = azureSsml(voice, clipText(card));

    for (let attempt = 1; ; attempt += 1) {
      let response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Ocp-Apim-Subscription-Key': key,
            'Content-Type': 'application/ssml+xml',
            'X-Microsoft-OutputFormat': AZURE_FORMAT,
            // Azure rejects the request without one.
            'User-Agent': 'vukovica-audio-batch',
          },
          body,
        });
      } catch (error) {
        // A dropped connection is the same kind of problem as a 503.
        if (attempt >= AZURE_MAX_ATTEMPTS) throw error;
        await sleep(backoffMs(attempt));
        continue;
      }

      if (response.ok) return Buffer.from(await response.arrayBuffer());

      // 429 is the free tier doing its job (F0 allows a couple of dozen
      // requests a minute). It is not an error, it is a pace. 5xx is Azure
      // wobbling. Everything else — a bad key, an unknown voice — will not
      // improve by asking again.
      const retriable = response.status === 429 || response.status >= 500;
      const detail = (await response.text().catch(() => '')).trim().slice(0, 200);
      if (!retriable || attempt >= AZURE_MAX_ATTEMPTS) {
        throw new Error(`azure ${response.status} ${response.statusText}${detail ? `: ${detail}` : ''}`);
      }

      const retryAfter = Number(response.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt);
      console.warn(`  [azure] ${response.status} on ${card.sr_cyr}; waiting ${Math.round(waitMs / 1000)}s`);
      await sleep(waitMs);
    }
  }

  return {
    name: 'azure',
    describe: () => `Azure ${AZURE_VOICES.join(' / ')} @ ${region}`,

    /**
     * One request per card, one at a time. Serial on purpose: the free tier
     * throttles hard, and a batch that trips 429 on every parallel request is
     * slower than one that never trips it at all.
     */
    async speak(batch, workDir, onProgress) {
      const failures = new Map();
      for (const card of batch) {
        try {
          const bytes = await speakOne(card);
          await writeFile(path.join(workDir, `${card.id}.mp3`), bytes);
        } catch (error) {
          failures.set(card.id, error.message ?? String(error));
        }
        onProgress();
      }
      return failures;
    },
  };
}

function backoffMs(attempt) {
  // 2s, 4s, 8s, 16s, 32s, plus a little jitter so a retry storm decorrelates.
  return 2 ** attempt * 1000 + Math.floor(Math.random() * 500);
}

// ---------------------------------------------------------------------------
// Engine: Piper — locating the binary, its voice, and its phoneme data
// ---------------------------------------------------------------------------

/** `piper` lives in a virtualenv; its Python is the sibling that loads the model. */
function resolvePiper() {
  const candidates = [
    process.env.PIPER_BIN,
    ...pathDirs().map((dir) => path.join(dir, 'piper')),
    path.join(os.homedir(), '.venvs', 'piper', 'bin', 'piper'),
  ].filter(Boolean);

  const bin = candidates.find((candidate) => existsSync(candidate));
  if (!bin) {
    fail(
      'Piper not found. Install it into a virtualenv and either put it on PATH or\n' +
        'set PIPER_BIN. See docs/plans/audio-batch.md ("Installing Piper").',
    );
  }

  const python = ['python3', 'python'].map((name) => path.join(path.dirname(bin), name));
  const interpreter = process.env.PIPER_PYTHON ?? python.find((p) => existsSync(p));
  if (!interpreter) {
    fail(`Found ${bin} but no Python beside it. Set PIPER_PYTHON to the one that has piper installed.`);
  }
  return { bin, python: interpreter };
}

function pathDirs() {
  return (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
}

/** The `.onnx` voice file. The `.onnx.json` config sits beside it, by convention. */
function resolveVoice() {
  const candidates = [
    process.env.PIPER_VOICE,
    path.join(repoRoot, 'voices', 'sr_RS-serbski_institut-medium.onnx'),
    path.join(os.homedir(), '.local', 'share', 'piper-voices', 'sr_RS-serbski_institut-medium.onnx'),
    path.join(os.homedir(), '.venvs', 'piper', 'voices', 'sr_RS-serbski_institut-medium.onnx'),
  ].filter(Boolean);

  const voice = candidates.find((candidate) => existsSync(candidate));
  if (!voice) {
    fail(
      'Serbian voice not found. Download sr_RS-serbski_institut-medium and set\n' +
        'PIPER_VOICE to the .onnx file. See docs/plans/audio-batch.md.',
    );
  }
  return voice;
}

/**
 * The espeak-ng data directory Piper ships, reachable by a path espeak will not
 * truncate. Returns null when it cannot be found, in which case espeak's own
 * lookup is left alone — it may well be fine on a short install path.
 */
function resolveEspeakData(pythonBin) {
  if (process.env.ESPEAK_DATA_PATH) return process.env.ESPEAK_DATA_PATH;

  const venvRoot = path.dirname(path.dirname(pythonBin));
  const libDir = path.join(venvRoot, 'lib');
  if (!existsSync(libDir)) return null;

  for (const pythonDir of readdirSync(libDir)) {
    const data = path.join(libDir, pythonDir, 'site-packages', 'piper', 'espeak-ng-data');
    if (!existsSync(data)) continue;
    if (data.length <= ESPEAK_PATH_LIMIT) return data;

    // Too long for espeak. A symlink somewhere short is the whole fix.
    const short = path.join(os.tmpdir(), 'vukovica-espeak-data');
    try {
      rmSync(short, { force: true });
      symlinkSync(data, short);
    } catch (error) {
      console.warn(`[audio] could not shorten the espeak data path: ${error.message}`);
      return data;
    }
    return short;
  }
  return null;
}

/**
 * Speak every item in `jobs` into its `out` path, in one Piper process.
 *
 * Loading the voice costs about half a second and synthesising a word costs
 * about a hundredth of one, so the whole batch goes through a single
 * long-lived process rather than one `piper` invocation per card — 754 separate
 * invocations would spend an hour and a half loading the same 77MB model.
 *
 * There is no Node binding for Piper, so this drives its Python API directly.
 */
const SYNTH_PY = `
import json, sys, wave
from piper import PiperVoice

voice = PiperVoice.load(sys.argv[1])
jobs = json.load(open(sys.argv[2], encoding='utf-8'))

for job in jobs:
    try:
        with wave.open(job['out'], 'wb') as out:
            voice.synthesize_wav(job['text'], out)
        print('ok\\t' + job['id'], flush=True)
    except Exception as error:  # one bad card must not lose the batch
        print('fail\\t' + job['id'] + '\\t' + str(error), flush=True)
`;

function piperEngine() {
  const tools = { ...resolvePiper(), voice: resolveVoice() };
  tools.espeakData = resolveEspeakData(tools.python);

  return {
    name: 'piper',
    describe: () => `Piper ${tools.bin}\n        ${tools.voice}`,

    async speak(batch, workDir, onProgress) {
      const jobs = batch.map((card) => ({
        id: card.id,
        text: clipText(card),
        out: path.join(workDir, `${card.id}.wav`),
      }));

      const manifest = path.join(workDir, 'manifest.json');
      await writeFile(manifest, JSON.stringify(jobs), 'utf8');

      const result = await run(tools.python, ['-c', SYNTH_PY, tools.voice, manifest], {
        ...process.env,
        ...(tools.espeakData ? { ESPEAK_DATA_PATH: tools.espeakData } : {}),
      });
      if (result.code !== 0) {
        fail(`Piper failed (exit ${result.code}):\n${result.stderr.trim()}`);
      }

      const failures = new Map();
      for (const line of result.stdout.split('\n')) {
        const [status, id, message] = line.split('\t');
        if (status === 'fail') failures.set(id, message ?? 'unknown error');
      }

      // Piper speaks WAV; the bucket holds mp3.
      for (const card of batch) {
        if (!failures.has(card.id)) {
          try {
            await toMp3(path.join(workDir, `${card.id}.wav`), path.join(workDir, `${card.id}.mp3`));
          } catch (error) {
            failures.set(card.id, error.message ?? String(error));
          }
        }
        onProgress();
      }
      return failures;
    },
  };
}

/** WAV to mp3. 64 kbit mono is transparent for a one-word clip and keeps it tiny. */
async function toMp3(wavPath, mp3Path) {
  const result = await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', wavPath,
    '-codec:a', 'libmp3lame', '-b:a', '64k', '-ac', '1',
    mp3Path,
  ]);
  if (result.code !== 0) throw new Error(`ffmpeg failed: ${result.stderr.trim()}`);
}

// ---------------------------------------------------------------------------
// The quality gate
// ---------------------------------------------------------------------------

/**
 * A clip's duration in seconds, or 0 when the file is not audio at all; null
 * when there is no ffprobe to ask.
 *
 * This is the quality gate that can be automated. It catches the failure that
 * actually happens — a synthesiser that produced nothing, leaving a silent or
 * zero-byte file — which is otherwise invisible until someone presses play.
 * Piper needs ffmpeg anyway, but the azure engine needs nothing installed, so a
 * missing ffprobe falls back to a byte floor rather than blocking the run.
 */
async function durationOf(filePath) {
  if (!(await haveFfprobe())) return null;
  const result = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  const seconds = Number.parseFloat(result.stdout.trim());
  return Number.isFinite(seconds) ? seconds : 0;
}

let ffprobePresent = null;
async function haveFfprobe() {
  if (ffprobePresent === null) {
    ffprobePresent = await run('ffprobe', ['-version'])
      .then((result) => result.code === 0)
      .catch(() => false);
    if (!ffprobePresent) {
      console.warn('[audio] no ffprobe: clips are checked by size only (brew install ffmpeg).');
    }
  }
  return ffprobePresent;
}

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

// ---------------------------------------------------------------------------
// The batch
// ---------------------------------------------------------------------------

/**
 * Every card this run should speak.
 *
 * Letters first when they are in scope at all: they are the deck being learned
 * first, so if the run is cut short (`--limit`, a laptop lid) the alphabet is
 * the part that is finished. Within a deck, `created_at` then `id` is seeding
 * order, which is also queue order.
 *
 * A card is skipped when `audio_path` already points at *this engine's* key.
 * That is what makes a re-run after adding words cheap, and it is also what
 * makes switching engines a re-voicing: a word still holding its Piper clip
 * does not match the azure target, so azure speaks it.
 */
async function cardsNeedingAudio() {
  const rows = [];
  for (const kind of kinds) {
    for (let from = 0; ; from += BATCH_SIZE) {
      const { data, error } = await supabase
        .from('cards')
        .select('id, kind, sr_cyr, example_cyr, audio_path')
        .eq('kind', kind)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + BATCH_SIZE - 1);
      if (error) fail(`Could not read cards: ${error.message}`);
      const page = data ?? [];
      rows.push(...page);
      if (page.length < BATCH_SIZE) break;
    }
  }

  const wanted = options.force ? rows : rows.filter((card) => card.audio_path !== targetKey(card));
  return options.limit ? wanted.slice(0, options.limit) : wanted;
}

const engine = options.engine === 'azure' ? azureEngine() : piperEngine();

console.log(`Engine: ${engine.describe()}`);
console.log(`Decks:  ${kinds.join(', ')}${options.letters ? '  (letters INCLUDED)' : ''}`);
console.log(`Target: ${supabaseUrl}${options.dryRun ? '  (dry run)' : ''}`);
if (!kinds.includes('letter')) {
  console.log("Letters: skipped — those clips are Mark's wife's voice, not TTS.");
}

const cards = await cardsNeedingAudio();
if (cards.length === 0) {
  console.log(`Every card already has a ${engine.name} clip. Pass --force to regenerate.`);
  process.exit(0);
}

const byKind = cards.reduce((counts, card) => {
  counts[card.kind] = (counts[card.kind] ?? 0) + 1;
  return counts;
}, {});
console.log(
  `Speaking ${cards.length} cards (${Object.entries(byKind)
    .map(([kind, count]) => `${count} ${kind}`)
    .join(', ')}) ...`,
);

const workDir = await mkdtemp(path.join(os.tmpdir(), 'vukovica-audio-'));
await mkdir(workDir, { recursive: true });

const problems = [];
let done = 0;
let spoken = 0;
const onProgress = () => {
  spoken += 1;
  if (spoken % 25 === 0 || spoken === cards.length) console.log(`  ...${spoken}/${cards.length}`);
};

for (let start = 0; start < cards.length; start += BATCH_SIZE) {
  const batch = cards.slice(start, start + BATCH_SIZE);
  const failures = await engine.speak(batch, workDir, onProgress);

  for (const card of batch) {
    const mp3Path = path.join(workDir, `${card.id}.mp3`);
    const label = `${card.sr_cyr} (${card.kind})`;

    if (failures.has(card.id)) {
      problems.push(`${label}: ${failures.get(card.id)}`);
      continue;
    }

    try {
      const body = await readFile(mp3Path);
      const seconds = await durationOf(mp3Path);
      if (seconds !== null && seconds < MIN_CLIP_SECONDS) {
        problems.push(`${label}: clip is ${seconds.toFixed(2)}s, which is silence not speech`);
        continue;
      }
      if (seconds === null && body.length < MIN_CLIP_BYTES) {
        problems.push(`${label}: clip is ${body.length} bytes, which is not speech`);
        continue;
      }

      if (options.dryRun) {
        done += 1;
        continue;
      }

      const key = targetKey(card);
      const upload = await supabase.storage
        .from(AUDIO_BUCKET)
        .upload(key, body, { contentType: 'audio/mpeg', upsert: true });
      if (upload.error) throw upload.error;

      // Written last, and only after the object is really there: the column is
      // what the app trusts, so it must never point at a clip that failed to
      // upload. A crash between the two leaves an unreferenced object, which
      // the next run overwrites.
      const { error } = await supabase
        .from('cards')
        .update({ audio_path: key })
        .eq('id', card.id);
      if (error) throw error;

      done += 1;
    } catch (error) {
      problems.push(`${label}: ${error.message ?? error}`);
    }
  }
}

rmSync(workDir, { recursive: true, force: true });

console.log(
  options.dryRun
    ? `Dry run: ${done} clips synthesised and checked, nothing uploaded.`
    : `Done. ${done} cards now have a ${engine.name} clip in ${AUDIO_BUCKET}/${KEY_PREFIX}/.`,
);

if (problems.length > 0) {
  console.error(`\n${problems.length} card(s) failed:`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
