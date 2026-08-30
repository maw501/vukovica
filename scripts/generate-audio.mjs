#!/usr/bin/env node
/**
 * Generate the pronunciation clip for every card, once, offline.
 *
 * Phase 3 deleted the `tts` Edge Function and with it the last runtime AI call.
 * Audio is now a build artefact: this script speaks each card with a local
 * neural TTS, uploads the clip to the public `audio` bucket at
 * `cards/<card_id>.mp3`, and writes that key back to `cards.audio_path`. The
 * app only ever reads the column (`lib/audio.ts`), so a card with a clip gets a
 * speaker button and one without gets no button at all — never a button that
 * does nothing.
 *
 * What each clip says:
 *   letter cards  the letter's *sound*, a beat, then its example word
 *                 ("б, беба"). espeak's Serbian voice renders an isolated
 *                 consonant as consonant+schwa, which is how you say a Serbian
 *                 letter aloud, so the pair reads as "buh — beba".
 *   word cards    the headword alone (`sr_cyr`), nothing else.
 *
 * Engine: Piper (https://github.com/OHF-voice/piper1-gpl), voice
 * `sr_RS-serbski_institut-medium`. Both are free, run entirely offline, and are
 * *not* npm dependencies — see docs/plans/audio-batch.md for the one-time
 * install, the voice download, and the espeak path gotcha this script works
 * around.
 *
 * Usage:
 *   node --env-file=.env.local scripts/generate-audio.mjs          # local
 *   node scripts/generate-audio.mjs --hosted                       # production
 *
 * Flags:
 *   --hosted        read `.env.hosted` instead of relying on --env-file. Nothing
 *                   else changes: same bucket, same column, same clips.
 *   --force         re-speak and re-upload cards that already have an
 *                   `audio_path`. Without it those are skipped, which is what
 *                   makes a re-run after adding cards cheap.
 *   --kind=letter   restrict to one deck (`letter` or `word`).
 *   --limit=N       stop after N cards. Handy for a smoke run.
 *   --dry-run       synthesise and check, but upload nothing and write nothing.
 *
 * Environment:
 *   SUPABASE_URL               e.g. http://127.0.0.1:54321
 *   SUPABASE_SERVICE_ROLE_KEY  service-role key; bypasses RLS. Never ship this
 *                              to the client bundle.
 *   PIPER_BIN                  optional; the `piper` executable, if it is not
 *                              on PATH.
 *   PIPER_VOICE                optional; the `.onnx` voice file, if it is not
 *                              in one of the usual places.
 *   ESPEAK_DATA_PATH           optional; overrides the shim described below.
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, symlinkSync, rmSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(scriptDir, '..');

/** Storage bucket and key prefix. Public-read; created by the first migration. */
const AUDIO_BUCKET = 'audio';
const KEY_PREFIX = 'cards';

/**
 * Anything shorter than this is silence, not speech. The shortest real clip
 * measured on this voice is ~0.6s ("беба"), so the gate is generous — it exists
 * to catch a card whose text phonemised to nothing, not to judge pace.
 */
const MIN_CLIP_SECONDS = 0.2;

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
// Arguments and environment
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(`--${name}`);
const flagValue = (name) => {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const options = {
  hosted: hasFlag('hosted'),
  force: hasFlag('force'),
  dryRun: hasFlag('dry-run'),
  kind: flagValue('kind'),
  limit: flagValue('limit') ? Number(flagValue('limit')) : null,
};

if (options.kind && options.kind !== 'letter' && options.kind !== 'word') {
  fail(`--kind must be 'letter' or 'word', not '${options.kind}'.`);
}
if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 1)) {
  fail('--limit must be a positive whole number.');
}

if (options.hosted) {
  const hostedEnv = path.join(repoRoot, '.env.hosted');
  if (!existsSync(hostedEnv)) {
    fail('--hosted needs a .env.hosted file at the repo root (ship-runbook.md step 1).');
  }
  process.loadEnvFile(hostedEnv);
}

const supabaseUrl = requireEnv('SUPABASE_URL');
const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function fail(message) {
  console.error(message);
  process.exit(1);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    fail(
      `Missing ${name}. Run with --env-file=.env.local (or pass --hosted to read\n` +
        '.env.hosted). Local values come from `npx supabase status`.',
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Locating Piper, its voice, and its phoneme data
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
        'set PIPER_BIN. See docs/plans/audio-batch.md ("Installing the engine").',
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

// ---------------------------------------------------------------------------
// What each card says
// ---------------------------------------------------------------------------

/**
 * The line of Serbian to speak for a card.
 *
 * A letter card's `sr_cyr` is the pair as printed ("Б б"), so the lowercase form
 * is the second half; speaking the pair verbatim would say the letter twice.
 * The comma is doing real work — it makes espeak insert a clause break, which is
 * the pause between the sound and the example word.
 */
function clipText(card) {
  if (card.kind !== 'letter') return card.sr_cyr.trim();

  const parts = card.sr_cyr.trim().split(/\s+/);
  const lower = parts[parts.length - 1];
  const example = card.example_cyr?.trim();
  return example ? `${lower}, ${example}` : lower;
}

// ---------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------

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

async function synthesise(jobs, tools, workDir) {
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
  return failures;
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

/**
 * A clip's duration in seconds, or 0 when the file is not audio at all.
 *
 * This is the quality gate that can be automated. It catches the failure that
 * actually happens — a phonemiser that produced nothing, leaving a silent or
 * zero-byte file — which is otherwise invisible until someone presses play.
 */
async function durationOf(filePath) {
  const result = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  const seconds = Number.parseFloat(result.stdout.trim());
  return Number.isFinite(seconds) ? seconds : 0;
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
 * Every card that needs a clip.
 *
 * Letters first, deliberately: they are the deck being learned first, so if the
 * run is cut short (`--limit`, a laptop lid) the alphabet is the part that is
 * finished. Within a deck, `sort` then `created_at` is seeding order, which is
 * also queue order.
 */
async function cardsNeedingAudio() {
  const rows = [];
  for (const kind of options.kind ? [options.kind] : ['letter', 'word']) {
    for (let from = 0; ; from += BATCH_SIZE) {
      let query = supabase
        .from('cards')
        .select('id, kind, sr_cyr, example_cyr, audio_path')
        .eq('kind', kind)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + BATCH_SIZE - 1);
      if (!options.force) query = query.is('audio_path', null);

      const { data, error } = await query;
      if (error) fail(`Could not read cards: ${error.message}`);
      const page = data ?? [];
      rows.push(...page);
      if (page.length < BATCH_SIZE) break;
    }
  }
  return options.limit ? rows.slice(0, options.limit) : rows;
}

const tools = { ...resolvePiper(), voice: resolveVoice() };
tools.espeakData = resolveEspeakData(tools.python);

console.log(`Piper:  ${tools.bin}`);
console.log(`Voice:  ${tools.voice}`);
console.log(`Target: ${supabaseUrl}${options.dryRun ? '  (dry run)' : ''}`);

const cards = await cardsNeedingAudio();
if (cards.length === 0) {
  console.log('Every card already has a clip. Pass --force to regenerate.');
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

for (let start = 0; start < cards.length; start += BATCH_SIZE) {
  const batch = cards.slice(start, start + BATCH_SIZE);
  const jobs = batch.map((card) => ({
    id: card.id,
    text: clipText(card),
    out: path.join(workDir, `${card.id}.wav`),
  }));

  const synthFailures = await synthesise(jobs, tools, workDir);

  for (const card of batch) {
    const wavPath = path.join(workDir, `${card.id}.wav`);
    const mp3Path = path.join(workDir, `${card.id}.mp3`);
    const label = `${card.sr_cyr} (${card.kind})`;

    if (synthFailures.has(card.id)) {
      problems.push(`${label}: piper said ${synthFailures.get(card.id)}`);
      continue;
    }

    try {
      await toMp3(wavPath, mp3Path);
      const seconds = await durationOf(mp3Path);
      if (seconds < MIN_CLIP_SECONDS) {
        problems.push(`${label}: clip is ${seconds.toFixed(2)}s, which is silence not speech`);
        continue;
      }

      if (options.dryRun) {
        done += 1;
        continue;
      }

      const key = `${KEY_PREFIX}/${card.id}.mp3`;
      const body = await readFile(mp3Path);
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

  console.log(`  ...${Math.min(start + BATCH_SIZE, cards.length)}/${cards.length}`);
}

rmSync(workDir, { recursive: true, force: true });

console.log(
  options.dryRun
    ? `Dry run: ${done} clips synthesised and checked, nothing uploaded.`
    : `Done. ${done} cards now have a clip in ${AUDIO_BUCKET}/${KEY_PREFIX}/.`,
);

if (problems.length > 0) {
  console.error(`\n${problems.length} card(s) failed:`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
