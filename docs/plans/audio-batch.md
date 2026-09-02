# Vukovica — the audio batch

Every card's pronunciation is a **build artefact**, not a runtime call. Phase 3
deleted the `tts` Edge Function along with the rest of the AI surface, so there
is nothing left in the app that can synthesise speech. Instead
`scripts/generate-audio.mjs` speaks every card once, on a laptop; it uploads the
clip to the public `audio` bucket and writes the key back to `cards.audio_path`.

The app only ever *reads* that column (`lib/audio.ts`, `components/SpeakButton.tsx`).
A card with a clip gets a speaker button; a card without one gets no button at
all, rather than a button that does nothing. That is the whole contract, and it
is why this script can be run, re-run, or never run again without the app
needing to know.

The 754 cards are not all the same kind of thing, and the most important
sentence in this document is that distinction:

| Deck | Voice | Key | Regenerable |
| --- | --- | --- | --- |
| 30 letters | **Mark's wife**, recorded once | `cards/<id>-w1.mp3` | **No.** Never. |
| 724 words | Azure neural TTS | `cards/<id>-a1.mp3` | Yes, freely |

---

## The letter deck is not the script's to speak

The alphabet is read by Mark's wife — a real voice, recorded in one sitting on a
phone, saying each letter and its example word. It is the voice the baby will
grow up hearing say these letters. There is no engine that substitutes for it
and no way to make it again if it is lost.

So the script treats the letter deck as off-limits under **every** engine:

- `kind='letter'` cards are excluded from the run unless `--letters` is passed.
  The guard sits above the engines, in deck selection, so a future engine
  inherits it rather than having to remember it.
- `--kind=letter` on its own is **refused** with an explanation, rather than
  silently selecting nothing. A flag that quietly does nothing is worse than one
  that argues back.
- `--letters` prints a seven-line warning naming the recordings, where they
  live, and the fact that they cannot be regenerated, before doing anything.

The masters live in `recordings/letter-clips/` — git-ignored, this machine only
— and in the hosted `audio` bucket. **After a `supabase db reset --local`,
re-upload them from there. Do not re-run TTS over the letter deck.** The README's
reset recipe says the same thing; keep the two in step.

---

## What the words are spoken with

| | |
| --- | --- |
| Engine | Azure Cognitive Services, neural TTS (REST, one request per card) |
| Voices | `sr-RS-SophieNeural` and `sr-RS-NicholasNeural` |
| Split | by `md5(card_id) % 2` → `[Sophie, Nicholas]` |
| Format | mp3, mono, 24 kHz, 96 kbit — straight from the API, no conversion |
| Coverage | the 724 word cards; the 30 letters are the human recordings above |
| Cost | ~nil. The free tier covers half a million characters a month; the whole deck is about four thousand |

**Two voices, not one.** A deck read entirely by the same speaker is monotonous,
and hearing a word from a woman and from a man is closer to hearing it from a
family than from a machine. Half the deck each, by hash.

**By hash, not by position.** `md5(card_id) % 2` means a card keeps its speaker
across a re-run, a re-seed that reorders the deck, or a `--limit` smoke test. An
index-based split would reassign voices the first time a card was inserted in
the middle. The samples that decided the pairing are in
`recordings/azure-samples/` (беба, кућа, млеко, хвала, добро јутро, in both
voices).

The request is plain REST — no SDK, no npm dependency:

```
POST https://<region>.tts.speech.microsoft.com/cognitiveservices/v1
Ocp-Apim-Subscription-Key: <AZURE_SPEECH_KEY>
Content-Type: application/ssml+xml
X-Microsoft-OutputFormat: audio-24khz-96kbitrate-mono-mp3

<speak version='1.0' xml:lang='sr-RS'><voice name='sr-RS-SophieNeural'>беба</voice></speak>
```

### Throttling

The free (F0) tier allows only a couple of dozen requests a minute, so the
script sends them **one at a time** and treats `429` as a pace rather than an
error: it honours `Retry-After` when Azure sends one, otherwise backs off 2s, 4s,
8s, 16s, 32s, up to six attempts. `5xx` is retried the same way. Anything else —
a bad key, an unknown voice — fails that card immediately, because asking again
will not improve it.

Serially at the free tier the full word deck takes on the order of half an hour.
A paid (S0) key would let the same script run far faster, but the batch is a
once-ever job and this is not worth optimising.

### What each clip says

**Word cards** say the headword (`sr_cyr`) and nothing else — no example
sentence, no English.

**Letter cards**, on the rare occasion `--letters` is used, say the letter's
sound, a beat, then its example word — "б, беба". The comma is doing real work:
it makes the synthesiser insert a clause break, so the clip reads as two things
rather than one run-on.

### Quality gates

Two automated, one human.

1. **Every clip is checked before upload.** `ffprobe` reads its duration and
   anything under 0.2 s is rejected as silence rather than uploaded — the
   failure that actually happens is a synthesiser that produced nothing, leaving
   a valid-looking, entirely silent file. Where there is no `ffprobe` (the Azure
   path needs nothing else installed) the check falls back to a byte floor.
2. **Playback verified in the browser** — the speaker button renders, the click
   range-requests the mp3 (`206`), the button does not remove itself (which is
   what it does when playback fails), and the clip decodes to real speech.
3. **Ears.** Nothing above can tell you it sounds *right* — whether the stress is
   where a Serbian speaker would put it. That needs Mark, and a handful of clips
   is enough to judge a voice: `recordings/azure-samples/` is exactly that,
   listened to before the batch was run.

---

## Running it

```sh
npm run db:audio                       # azure, local database
node scripts/generate-audio.mjs --hosted   # azure, production
npm run db:audio -- --engine=piper     # the offline fallback, needs no key
```

It always reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — the service
role, because it writes to `cards`, a table no user may write. The Azure engine
also needs `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`.

**Where the Azure credentials come from.** `--hosted` loads `.env.hosted`, which
already holds both. For a local run — `npm run db:audio` is
`node --env-file=.env.local ...`, and `.env.local` holds the Supabase pair only
— either add the two Azure lines to `.env.local` (see `.env.example`) or export
them for the run:

```sh
export AZURE_SPEECH_KEY=... AZURE_SPEECH_REGION=westeurope
npm run db:audio
```

Without them the script stops before touching anything and says so, and points
at `--engine=piper`, which needs no key at all. The key lives on the laptop for
the length of the run and never goes near the app or a secret store — that is
the point of this being a script rather than a function.

**Idempotent, per engine.** A card is skipped when `audio_path` already points at
*this engine's* key. So a re-run after adding words speaks only the new ones,
and switching engines is a re-voicing rather than a no-op: a word still holding
its old Piper clip (`cards/<id>.mp3`) does not match the Azure target
(`cards/<id>-a1.mp3`), so Azure speaks it.

| Flag | Does |
| --- | --- |
| `--engine=azure` | Azure neural TTS. **The default** |
| `--engine=piper` | the free offline fallback (below) |
| `--letters` | include the letter deck — **overwrites the human recordings**. Almost never right |
| `--hosted` | reads `.env.hosted` instead of `--env-file`. Same bucket, same column — only the project differs |
| `--force` | re-speak cards that already have this engine's clip (after changing voice) |
| `--kind=word` | one deck only (`letter` or `word`; `letter` needs `--letters` too) |
| `--limit=N` | stop after N cards |
| `--dry-run` | synthesise and check, upload nothing, write nothing. Azure still spends the API calls, so pair it with `--limit` |

### Against production

```sh
node scripts/generate-audio.mjs --hosted
```

`.env.hosted` is the same file the seed scripts use (ship-runbook.md step 1).
The hosted `audio` bucket is created by the first migration, exactly as the
local one is, so there is nothing to set up in the dashboard.

Clips are not copied between projects — each run generates them fresh. The voice
split is a hash of the card id, and ids are stable across seeds, so the same
card gets the same speaker in both.

---

## The fallback: Piper

[Piper](https://github.com/OHF-voice/piper1-gpl) 1.7.0 (`piper-tts` on PyPI)
with `sr_RS-serbski_institut-medium` — the only Serbian voice Piper publishes,
~73 MB, from [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices).
It is a neural (VITS) voice, a long way from a robot, and it runs **entirely
offline**: no key, no account, no vendor. It is what the deck was first spoken
with, and it is what to reach for if the Azure key lapses or the free tier
changes shape.

It writes `cards/<id>.mp3` — no suffix, as it always did — so its clips and
Azure's can coexist and `audio_path` says which is being played.

```sh
python3 -m venv ~/.venvs/piper
~/.venvs/piper/bin/pip install piper-tts

mkdir -p ~/.venvs/piper/voices
~/.venvs/piper/bin/python -m piper.download_voices \
  sr_RS-serbski_institut-medium --data-dir ~/.venvs/piper/voices
```

Nothing here belongs in `package.json` — this is a laptop tool, not a dependency
of the app. `~/.venvs/piper` is not an arbitrary choice; see the gotcha below.
With the voice in `~/.venvs/piper/voices/` the script finds both by itself and
needs no environment variables. It also looks at `PIPER_BIN` and `PIPER_VOICE`,
and at `./voices/` in the repo. `ffmpeg` and `ffprobe` do the WAV-to-mp3
conversion and the duration check (`brew install ffmpeg`).

**How long it takes.** Loading the 73 MB voice costs about half a second;
speaking a word costs about a hundredth of one. So the script batches: **one**
long-lived Piper process speaks the whole run through Piper's Python API, rather
than one `piper` invocation per card. Calling the CLI 754 times would spend an
hour and a half loading the same model over and over. A full local run is a
couple of minutes end to end, almost all of it upload.

### The gotcha: install Piper somewhere with a short path

espeak-ng — which Piper uses to turn Serbian text into phonemes — truncates its
data directory at **160 characters** and then silently falls back to the path
baked in when *it* was compiled. For a wheel built on CI that is a directory on
a GitHub runner's disk, so the failure reads:

```
Error processing file '/Users/runner/work/piper1-gpl/.../espeak-ng-data/phontab':
No such file or directory.
```

and leaves a **0-byte WAV** behind. It looks like a broken model. It is a path
length.

Piper ships its espeak data inside site-packages, so the full path is the
virtualenv's path plus about 60 characters. `~/.venvs/piper` leaves it at 81 and
everything works. A venv under a deep scratch directory blows the limit, which
is exactly how this was found. The script detects the case and symlinks the data
somewhere short before running, so a long install path still works — but
installing at a short one keeps the shim out of the picture.

### Piper's letter clips

Worth recording for the phonetics, even though the letter deck is now human:
espeak's Serbian voice renders an isolated consonant as consonant-plus-schwa,
which is how you say a Serbian letter aloud, so «б» came out as *buh* rather
than as the letter's name. Verified through the phonemiser:

```
'б, беба' -> b ˈə , b ˈɛ b ɐ
'а, мама' -> ˈa , m ˈa m ɐ
```

---

## Changing the voice

Azure publishes exactly two Serbian neural voices and the script uses both, so
"changing the voice" means changing engine or vendor, not picking a third.

```sh
node scripts/generate-audio.mjs --hosted --force
```

`--force` is the point: without it every word card already has an `-a1` clip and
the run does nothing.

**If Azure is not an option**, `--engine=piper` is the free offline answer and
needs no key. **espeak-ng** (`brew install espeak-ng`) is below that: formant
synthesis, very intelligible, unmistakably a robot, but free, tiny, instant, and
phonetically accurate — for single words that is most of what matters. It would
need a third engine in the script, which is now a matter of one object with a
`speak()` method rather than a rewrite.

Whatever the vendor, it stays an **offline batch**. A card's audio is data,
generated once, not a live dependency on anyone — that was the whole point of
phase 3, and it is why this is a script and not a function.

---

## When to re-run it

- After adding cards to `data/seed-deck.json` or `data/phase3/ghmily-vocab.json`
  and re-seeding — the new rows have no clip.
- After adding a card by hand in the Deck screen. That card has no clip and no
  speaker button until the next run.
- After a local database reset — but for the **word** deck only. The letter
  clips come back by re-uploading `recordings/letter-clips/`, never by TTS.
- Never for anything else. Existing clips do not go stale.
