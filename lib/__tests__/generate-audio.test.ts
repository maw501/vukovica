/**
 * Checks for `scripts/generate-audio.mjs`.
 *
 * The script talks to a TTS vendor and to storage, so there is nothing here to
 * import and run — as with `seed-user-content.test.ts`, it is read as text and
 * asserted on. That is weak evidence about behaviour and strong evidence about
 * *decisions*, which is what matters for this file: the decision it exists to
 * protect is that the 30 letter clips are Mark's wife's voice, recorded once,
 * and no engine may quietly overwrite them.
 *
 * The other assertions pin the conventions the one-off Azure batch already ran
 * with. A drift in the voice split or the key suffix would not fail anything at
 * runtime — it would just re-voice half the deck in a different speaker on the
 * next run, silently.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts: string[]) => readFileSync(path.join(repoRoot, ...parts), 'utf8');

const script = read('scripts', 'generate-audio.mjs');
const readme = read('README.md');
const plan = read('docs', 'plans', 'audio-batch.md');

describe('the letter guard', () => {
  it('leaves the letter deck out of every run unless --letters is passed', () => {
    // The one assertion in this file that is load-bearing. Not "the azure
    // engine skips letters" -- the deck selection happens once, above the
    // engines, so a new engine inherits the guard rather than having to
    // remember it.
    expect(script).toContain("options.letters ? ['letter', 'word'] : ['word']");
    expect(script).toContain("letters: hasFlag('letters')");
  });

  it('refuses --kind=letter on its own rather than silently speaking nothing', () => {
    expect(script).toContain("if (options.kind === 'letter' && !options.letters)");
  });

  it('says out loud what --letters is about to destroy', () => {
    expect(script).toContain('ABOUT TO SPEAK THE LETTER DECK WITH A SYNTHETIC VOICE');
    expect(script).toContain('CANNOT be regenerated');
    expect(script).toContain('recordings/letter-clips/');
  });

  it("never writes the wife's key itself", () => {
    // `-w1` appears only as the thing being protected: it is not a value in
    // ENGINE_SUFFIX, so no code path can produce a key ending in it.
    expect(script).toContain("const HUMAN_SUFFIX = '-w1'");
    expect(script).toContain("const ENGINE_SUFFIX = { piper: '', azure: '-a1' }");
    expect(script).not.toContain('${HUMAN_SUFFIX}.mp3`;');
  });

  it('tells the same story the README does', () => {
    // The README's reset recipe is where someone reads this before wiping a
    // database; the script is where they read it before running the batch.
    expect(readme).toContain("The letter cards' audio is human, not TTS.");
    expect(readme).toContain('cards/<id>-w1.mp3');
    expect(plan).toContain('-w1.mp3');
    expect(plan).toContain('--letters');
  });
});

describe('the azure engine', () => {
  it('is the default, with piper still reachable', () => {
    expect(script).toContain("engine: flagValue('engine') ?? 'azure'");
    expect(script).toContain("options.engine === 'azure' ? azureEngine() : piperEngine()");
    expect(plan).toContain('--engine=piper');
  });

  it('speaks the word deck in the two Serbian neural voices', () => {
    expect(script).toContain("const AZURE_VOICES = ['sr-RS-SophieNeural', 'sr-RS-NicholasNeural']");
  });

  it('picks a voice by hashing the card id, so a re-run keeps the same speaker', () => {
    // Order matters as much as the hash: `% 2` indexes AZURE_VOICES, so
    // swapping the two entries would re-voice half the deck on the next run.
    expect(script).toContain("createHash('md5').update(cardId).digest('hex')");
    expect(script).toContain('AZURE_VOICES[Number(BigInt(`0x${digest}`) % 2n)]');
  });

  it('asks for the mp3 profile and the SSML the batch already ran with', () => {
    expect(script).toContain("const AZURE_FORMAT = 'audio-24khz-96kbitrate-mono-mp3'");
    expect(script).toContain("'X-Microsoft-OutputFormat': AZURE_FORMAT");
    expect(script).toContain(
      "`<speak version='1.0' xml:lang='sr-RS'><voice name='${voice}'>${escapeXml(text)}</voice></speak>`",
    );
    expect(script).toContain('.tts.speech.microsoft.com/cognitiveservices/v1');
    expect(script).toContain("'Ocp-Apim-Subscription-Key': key");
    expect(script).toContain("'Content-Type': 'application/ssml+xml'");
  });

  it('waits out the free tier instead of failing on it', () => {
    // 429 is a pace, not an error. A bad key is an error, and retrying it
    // would just spend six backoffs discovering that.
    expect(script).toContain('response.status === 429 || response.status >= 500');
    expect(script).toContain("response.headers.get('retry-after')");
    expect(script).toContain('AZURE_MAX_ATTEMPTS');
  });

  it('reads its credentials from the environment, never from a literal', () => {
    expect(script).toContain("requireEnv(\n    'AZURE_SPEECH_KEY'");
    expect(script).toContain("requireEnv(\n    'AZURE_SPEECH_REGION'");
    expect(script).toContain("process.loadEnvFile(hostedEnv)");
    expect(script).not.toMatch(/AZURE_SPEECH_KEY\s*=\s*['"][^'"]/);
  });
});

describe('idempotency', () => {
  it('skips a card whose clip is already this engine’s', () => {
    // Keyed on the engine's own target, not on "has any audio_path": that is
    // what makes switching engines a re-voicing rather than a no-op, and what
    // makes a re-run after adding words cheap.
    expect(script).toContain('rows.filter((card) => card.audio_path !== targetKey(card))');
    expect(script).toContain('return `${KEY_PREFIX}/${card.id}${ENGINE_SUFFIX[options.engine]}.mp3`');
  });

  it('regenerates on --force', () => {
    expect(script).toContain('options.force ? rows :');
  });

  it('writes audio_path only after the object is uploaded', () => {
    const upload = script.indexOf('.upload(key, body');
    const update = script.indexOf("update({ audio_path: key })");
    expect(upload).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(upload);
  });
});
