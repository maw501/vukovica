# Vukovica — the audio batch

Every card's pronunciation is a **build artefact**, not a runtime call. Phase 3
deleted the `tts` Edge Function along with the rest of the AI surface, so there
is nothing left in the app that can synthesise speech. Instead
`scripts/generate-audio.mjs` speaks every card once, offline, on a laptop; it
uploads the clip to the public `audio` bucket and writes the key back to
`cards.audio_path`.

The app only ever *reads* that column (`lib/audio.ts`, `components/SpeakButton.tsx`).
A card with a clip gets a speaker button; a card without one gets no button at
all, rather than a button that does nothing. That is the whole contract, and it
is why this script can be run, re-run, or never run again without the app
needing to know.

---

## What was generated

| | |
| --- | --- |
| Engine | [Piper](https://github.com/OHF-voice/piper1-gpl) 1.7.0 (`piper-tts` on PyPI) |
| Voice | `sr_RS-serbski_institut-medium` (Serbian, medium quality, ~73 MB) |
| Source | [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) on Hugging Face |
| Licence | Both are free and run entirely offline — no key, no account, no per-clip cost |
| Format | mp3, mono, 64 kbit, from Piper's 22.05 kHz WAV via ffmpeg |
| Coverage | 754 cards: all 30 letters and all 724 words |
| Size | 6.7 MB for the lot — about 9 kB a clip |

Piper is a neural (VITS) voice, so it is a long way from a robot: it is the
same class of thing as a paid cloud TTS, just running locally. It is *not* an
npm dependency and never runs in the app.

### What each clip says

**Letter cards** say the letter's sound, a beat, then its example word — "б,
беба". The comma is doing real work: it makes espeak insert a clause break, so
the clip reads as two things rather than one run-on. espeak's Serbian voice
renders an isolated consonant as consonant-plus-schwa, which is how you say a
Serbian letter aloud, so «б» comes out as *buh* rather than as the letter's
name. Vowels come out as the bare vowel. Verified through the phonemiser:

```
'б, беба' -> b ˈə , b ˈɛ b ɐ
'а, мама' -> ˈa , m ˈa m ɐ
```

**Word cards** say the headword (`sr_cyr`) and nothing else — no example
sentence, no English.

### Quality gates

Two automated, one human.

1. **Every clip is probed after conversion.** `ffprobe` reads its duration and
   anything under 0.2 s is rejected as silence rather than uploaded. This is the
   failure that actually happens: a phonemiser that produced nothing leaves a
   valid-looking, entirely silent file. All 754 passed; the shortest real clips
   are the shortest words (`тврд`, `брз`, 0.5 s).
2. **Playback was verified in the browser**, on a letter card and a word review
   card, against the local stack: the speaker button renders, the click
   range-requests the mp3 (`206`), the button does not remove itself (which is
   what it does when playback fails), and the clip decodes to real speech —
   peak 0.95, RMS 0.13 over 1.39 s for «А а». No console errors.
3. **Ears.** Nothing above can tell you it sounds *right* — whether the stress
   is where a Serbian speaker would put it, whether «ђ» and «ћ» are actually
   distinguishable. That needs Mark, and a handful of clips is enough to judge
   the voice. With the local stack up:

   ```
   letters   .../object/public/audio/cards/16c8c67a-ab74-4d2a-98e5-3374b91de6b0.mp3   А а
             .../object/public/audio/cards/ca8c40ba-50fa-4a21-a2d5-2f47ab023c3d.mp3   Б б
             .../object/public/audio/cards/853009c1-2fae-47ae-8b01-98322cd3f0c0.mp3   Љ љ
             .../object/public/audio/cards/048a4839-50c7-4f81-8958-85da0d5cddaf.mp3   Џ џ
   words     .../object/public/audio/cards/27bc5b95-2c8a-4ad6-9887-608fde4bb41f.mp3   беба
             .../object/public/audio/cards/8d0a4d87-d06a-40dc-bd1a-b5139780a739.mp3   кућа
             .../object/public/audio/cards/cf252480-1c8d-4a80-882a-6d057c759c28.mp3   мама
             .../object/public/audio/cards/b786b7c2-1b45-4a01-9063-a75e107dd296.mp3   хвала
   ```

   (prefix `http://127.0.0.1:54321/storage/v1`, or just open Letters in the app
   and press the speaker). If the voice is wrong, see **Changing the voice**
   below — the fix is one flag and one re-run, not a code change.

---

## Installing the engine

One-time, and nothing here belongs in `package.json` — this is a laptop tool,
not a dependency of the app.

```sh
python3 -m venv ~/.venvs/piper
~/.venvs/piper/bin/pip install piper-tts

mkdir -p ~/.venvs/piper/voices
~/.venvs/piper/bin/python -m piper.download_voices \
  sr_RS-serbski_institut-medium --data-dir ~/.venvs/piper/voices
```

`~/.venvs/piper` is not an arbitrary choice — see the gotcha below. With the
voice in `~/.venvs/piper/voices/`, the script finds both by itself and needs no
environment variables at all. It also looks at `PIPER_BIN` and `PIPER_VOICE`,
and at `./voices/` in the repo, if you would rather put them somewhere else.

`ffmpeg` and `ffprobe` do the WAV-to-mp3 conversion and the duration check
(`brew install ffmpeg`).

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
is exactly how this was found. `scripts/generate-audio.mjs` detects the case and
symlinks the data somewhere short before running, so a long install path still
works — but installing at a short one keeps the shim out of the picture.

---

## Running it

```sh
npm run db:audio                                       # local
node --env-file=.env.local scripts/generate-audio.mjs  # the same thing
```

It reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — the service role,
because it writes to `cards`, which is a table no user may write.

**Idempotent.** Cards that already have an `audio_path` are skipped, so a re-run
after adding words to `data/seed-deck.json` speaks only the new ones. Nothing is
wasted and nothing is overwritten.

Letters are always spoken first. If a run is cut short — `--limit`, a closed
lid — the alphabet is the part that is finished, because it is the deck being
learned first.

| Flag | Does |
| --- | --- |
| `--hosted` | reads `.env.hosted` instead of `--env-file`. Same bucket, same column, same clips — only the project differs |
| `--force` | re-speak and re-upload cards that already have a clip (after changing voice) |
| `--kind=letter` | one deck only (`letter` or `word`) |
| `--limit=N` | stop after N cards |
| `--dry-run` | synthesise and check, upload nothing, write nothing |

### Against production

```sh
node scripts/generate-audio.mjs --hosted
```

`.env.hosted` is the same file the seed scripts use (ship-runbook.md step 1).
The hosted `audio` bucket is created by the first migration, exactly as the
local one is, so there is nothing to set up in the dashboard.

The clips are not copied between projects — each run generates them fresh from
the same voice, which is deterministic enough that it does not matter. Roughly a
minute of synthesis for the full deck, plus upload time.

### How long it takes

Loading the 73 MB voice costs about half a second; speaking a word costs about a
hundredth of one. So the script batches: **one** long-lived Piper process speaks
the whole run through Piper's Python API, rather than one `piper` invocation per
card. Calling the CLI 754 times would spend an hour and a half loading the same
model over and over. The full local run took a couple of minutes end to end,
almost all of it upload.

---

## Changing the voice

`sr_RS-serbski_institut-medium` is the only Serbian voice Piper publishes, so
the realistic alternatives are a different engine, not a different Piper voice.

```sh
PIPER_VOICE=/path/to/other.onnx node --env-file=.env.local \
  scripts/generate-audio.mjs --force
```

`--force` is the point: without it every card already has a clip and the run
does nothing.

### If Piper is not an option

**espeak-ng** (`brew install espeak-ng`) is the fallback. It is formant
synthesis — very intelligible, unmistakably a robot — but it is free, tiny,
instant, and its Serbian is phonetically accurate, which for single words is
most of what matters. It would need `synthesise()` in the script pointed at
`espeak-ng -v sr -w out.wav`; everything else in the script is engine-agnostic.

**OpenAI TTS** is the paid fallback, and the one to reach for if the Piper voice
turns out to be unpleasant to listen to daily. `gpt-4o-mini-tts` or `tts-1` with
`voice=alloy`, one request per card, mp3 straight back — no conversion step. At
754 cards it is a few tens of cents, once, and it is still an **offline batch**:
the key lives on the laptop for the length of the run and never goes near the
app or a secret store. That is the important part, and the reason this stays a
script rather than becoming a function again — the whole point of phase 3 was
that a card's audio is data, generated once, not a live dependency on a vendor.

---

## When to re-run it

- After adding cards to `data/seed-deck.json` or `data/phase3/ghmily-vocab.json`
  and re-seeding — the new rows have no clip.
- After adding a card by hand in the Deck screen. That card has no clip and no
  speaker button until the next run.
- Never for anything else. Existing clips do not go stale.
