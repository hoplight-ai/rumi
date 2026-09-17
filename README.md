# Rumi

A Spanish app for a five-year-old who cannot read yet.

One HTML file. Everything — the markup, the styles, the app logic, and 304 recorded audio clips —
is inside it. No build step, no dependencies, no network calls, no accounts, no analytics.

**Live:** recorded in the RUMI2 report on the bridge and in `_handoffs/_lanes/POLICY.md`. The URL
Vercel generated for this project is the one that counts; do not guess it from the project name.

## The file

| Path | What it is |
|---|---|
| `rumi-espanol-app.html` | the whole app, 5,787,537 bytes |
| `rumi-voice-bakeoff.html` | voice comparison, for Whit's ear. Served at `/rumi-voice-bakeoff` |
| `voices/<slug>/index.json` | one voice's clip list — file name, byte size, and word-timing spans for every line |
| `voices/<slug>/<clip-id>.mp3` | one recording, downloaded the once a grown-up picks that voice |
| `scripts/rumi-voices.mjs` | the one list of the five voices. Four things read it; none keeps a copy |
| `vercel.json` | `cleanUrls`, and the two rewrites that serve the app at `/` and at `/rumi` |
| `scripts/ci-check.mjs` | the structural gate. 67 assertions, no network, no dependencies |
| `scripts/rumi-unit-test.mjs` | the behavioural suite. 196 assertions over the real shipped corpus |
| `scripts/rumi-audio-smoke.mjs` | the gate that actually listens. 85 assertions, in a real browser and in plain Node — see below |
| `scripts/rumi-strings.mjs` etc. | the content toolchain — see below |
| `.github/workflows/ci.yml` | runs both gates on every push |

## Regenerating the content

The audio is produced from the strings in the app and embedded back into it. The source audio
lives under `build/`, which is **not in the repo** — regenerating needs a voice credential Whit
holds, so a fresh clone can run the gates but not the generators.

```bash
npm run rumi:strings    # list the phrases the app asks for
npm run rumi:extract    # rebuild build/ from the shipped page (reuse, never resynthesize)
npm run rumi:audio      # render the Spanish clips, and the word timing beside them
                        # (needs python3 with edge-tts importable; see scripts/rumi-edge-words.py)
npm run rumi:cues       # render the English cues (idle help + phrase glosses)
npm run rumi:embed      # base64 both banks back into the app file
npm run rumi:bakeoff    # rebuild the old edge-tts voice comparison page
npm run rumi:11:bakeoff # rebuild the ElevenLabs listening page (the one served now)
npm run rumi:11:packs   # record all five voices, embed one, write the other four (see below)
```

## Rumi's five voices, and which one is inside the page (RUMIVOICES2, 2026-09-16)

**Rumi speaks with five native Spanish women now, and a grown-up picks one in Grown-ups.** Four
read Spain Spanish, one reads Latin American. Whit, 2026-09-16: *"why make me choose? let the user
have like 5 options in the settings."* The Microsoft voice this app used from August is gone; every
one of these is a real Spanish speaker, which the previous key could not buy at any price.

| Name | From | Where her recordings live |
|---|---|---|
| Inés | Spain, calm | inside `rumi-espanol-app.html` |
| Alma | Spain, warm | `voices/alma/` |
| Valeria | Spain, clear | `voices/valeria/` |
| Sofía | Spain, natural | `voices/sofia/` |
| Daniela | Latin America, bright | `voices/daniela/` |

**Inés is the default by reading, not by ear, and that is worth saying out loud.** The library
tags her calm and she reads slowest, which is what a five-year-old decoding a new language needs.
Nobody has heard her against the other four. Any of them is one tap away, so the choice was never
worth a question.

**Why one voice is inside the file and four are not.** `scripts/rumi-embed.mjs` refuses to write an
app over 10,485,760 bytes and one voice's recordings are about two megabytes of base64 inside the
page. Five would be ten. So one voice ships in the file — which is what makes the app open and talk
the first time, offline, on bad wifi, the whole reason this app is a single file — and the other
four are fetched the one time a grown-up picks one and then kept on the device in Cache Storage. On
every later load the chosen voice comes back off the device before the first word, never off the
network.

**Each downloadable voice is a folder, not one file (RUMITIDY1, 2026-09-17).** `voices/<slug>/`
holds `index.json` (every clip's file name, byte size and word-timing spans) plus one mp3 per clip.
Picking a name in Grown-ups fetches the index, then every clip it names — roughly 280 requests the
first time, instead of the one request the older single-JSON shape cost. That is a real trade, made
on purpose: the old shape rewrote a voice's whole 2-3MB file in the repo's history every time even
one line was re-recorded, so a handful of re-recordings this size added up fast. Now a re-recording
that changes ten lines touches ten files; the other 270 are untouched on disk and invisible to git.
Confirm the trade is still worth it before re-recording a large batch — this makes small,
frequent re-recordings cheap and a first pick of any one voice slightly slower, not the reverse.

**A voice that cannot be had is never silence.** A failed download, a pack that arrives short of a
line, storage refusing, a saved name whose file has gone: all of them land back on Inés and the
settings screen names the voice that did not arrive. A pack missing even one line is rejected
whole, because the lines it lacks would fall through to the device's own Spanish voice, and on the
iPad this app exists for there is no such voice. Half a voice is worse than one voice.

**Both slow speeds work for all five.** Each pack carries its own per-word timing, already
converted to the spans the app reads, so the turtle speed plays that voice's real recording one
word at a time exactly as the embedded one does.

**Regenerating.** `npm run rumi:11:packs` records all five, writes the four packs, embeds Inés and
runs the ordinary embed gate. It never touches the English cue map: `npm run rumi:11:embed` also
rebuilds that map from an empty `build/`, which used to replace 171 English recordings with
nothing. Use `rumi:11:packs`, not `rumi:11:embed`, on a fresh clone.

`node scripts/rumi-packs.mjs --packs-only` (no network, no credential) writes only the four
downloadable voices' folders and leaves the embedded voice untouched — either from a fresh render
under `build/rumi-clips-11/` if one is there, or by splitting whatever is already at
`voices/<slug>/` or, on an older checkout, the pre-RUMITIDY1 flat `voices/<slug>.json`. This is
how a worktree with no `build/` directory at all converts packs that already shipped without
calling ElevenLabs again.

**The gate.** `npm run check` compares the list in the page against `scripts/rumi-voices.mjs`, and
walks every clip in every pack frame by frame the same way it walks the ones in the page. A name in
one list and not the other fails. So does a pack short of a line, and so does a clip cut off
mid-word.

## Who recorded Rumi before, and why it was the Microsoft voice (RUMIVOICE1 phase B, 2026-09-15)

**The voice did not change, and that is the finding, not a shortfall.** Re-probed on the real
service on 2026-09-15: the key is still a free plan (9,489 credits left of 10,000), every native
Spanish voice still answers 402 `paid_plan_required` at no charge, and designing one still answers
403. Everything this key can actually speak with is an English speaker reading Spanish. Rumi's
listener is five and learning the language by ear, the app has spoken Spain Spanish since August,
and the brief's own default was to stay there — so swapping a native Spanish voice for an
English-accented one to be able to say the word ElevenLabs would have made the app worse. **The
recordings stay with `es-ES-XimenaNeural`, which Whit picked by ear on 2026-08-21.** The listening
page and the ElevenLabs generator stay wired and unused; one paid month and a single re-run puts
real Spanish candidates on that page. Total spent this lane: **0 credits.**

**What was actually blocking the slow speed was never the voice — it was timing, and the free
service gives that away.** The `edge-tts` command asks for sentence boundaries and merges its
subtitles into one caption per line, which is why no timing existed. The library underneath it
takes `boundary="WordBoundary"`, and the service then returns one event per word with an offset
and a duration. `scripts/rumi-edge-words.py` calls it that way — same service, same voice, same
rate, so the audio is byte-for-byte the audio this app already shipped — and keeps the half that
was being thrown away. `rumi-words.mjs` turns either recorder's timing into the one flat shape the
app reads, so a line's timing works whoever recorded it.

So, for free, all three of the things the lane existed for:
- **The 41 drawing instructions have recordings.** They were the only strings in the app with
  none, which on an iPad with no Spanish voice made all 41 of them silence.
- **The slow speed plays the real recording**, one word at a time, at rate 1 — never resampled —
  on a device with no voices at all. `turtleUsable()` no longer needs one.
- **Every Spanish line carries per-word timing**, not just the drawing instructions.

**A cached clip is now only reused if its word marks are cached too.** The marks arrive with the
audio and cannot be recovered from an mp3, so a clip recorded before this change has to be recorded
once more to gain a slow speed. If `python3` cannot import the library the generator says so once
and falls back to the command, and those clips simply play whole — today's behaviour, not a break.

**A guard that was missing, found one run before it shipped.** `npm run rumi:embed` rebuilds the
English cue map from `build/rumi-cues/`, and on a fresh clone that folder is empty — so the map is
`{}`, the embed step replaces a tag holding 171 English recordings with nothing, and every gate
stays green, because an app with no English audio is a structurally valid app. The child just stops
being told what anything means. An empty cue map is now refused over a populated tag.

**The English cues are not timed, deliberately.** Timing is what the slow speed reads, the slow
speed is for decoding Spanish, and the English gloss is heard rather than repeated. Recording 171
more marks would add bytes to a file with a ceiling for a control nothing reads.

**The stroke-cue rate override still earns its place, and does not double-slow anything.**
`TRACE_RATE` (0.55) now applies on exactly one path: a drawing instruction with no recording at
all, spoken by a device voice. A recorded instruction plays at rate 1 either way, word by word when
it has timing. Nothing is slowed twice. Whether word-by-word is *too* slow for an instruction said
while her hand is moving is the one question here an ear has to answer, and it is one line to
change: the `playWords()` call in `speakStroke()`.

## ElevenLabs, the slow speed, and the free plan (RUMIVOICE1, 2026-09-13)

**What the key in `.env.local` can actually do, measured on the real service the same day.** It
is a free-plan key: 10,000 credits, one credit per character, 3 saved-voice slots. A full re-voice
of the app is 6,108 credits (`npm run rumi:11:estimate`). Three limits that no document had:
- **No public-library voice works through the API on the free plan.** There are about a hundred
  Spanish ones, Spain and Latin American (`npm run rumi:11:shared`); every one answers 402
  `paid_plan_required`, at no charge, whatever its `free_users_allowed` flag says.
- **Designing a voice through the API is refused too:** 403 `feature_not_available`.
- The key's own library is Eleven's 21 ready-made voices, all English speakers.

So the listening page (`npm run rumi:11:bakeoff`, served at `/rumi-voice-bakeoff`) carries every
candidate the key can reach: the seven ready-made women reading Spanish, labelled as English
speakers, beside one clip of the voice that is live today. The script also holds eight Spain and
Latin American library voices and three voice designs; on the free key it skips them for free,
and **with a paid-plan key a single re-run puts them on the same page.** No production clip is
rendered until Whit names a voice.

**Turtle no longer needs a device voice.** ElevenLabs returns per-character timing with each
clip. `scripts/rumi-words.mjs` turns it into one start and end per word, `rumi-embed.mjs` writes
that into `<script id="rumiTimes">`, and turtle then plays **the real recording one word at a
time** — slices of one buffer at rate 1, so the pitch is never resampled, with the same gap after
each word the device-voice turtle always used. Timing is dropped for any line whose recorded words
do not match its text, cleared when the timing file is older than the clip map, and re-checked
against each decoded buffer in the app — a wrong span cuts a word in half, which is worse than
none. **Where there is no timing, everything plays exactly as before.** The drawing instructions
use the same path when they have a clip: timed means word by word whatever the speed buttons
say, untimed means the whole clip, no clip means the device voice at `TRACE_RATE` as before.
Whether word by word is now too slow for a stroke cue is for an ear on the real render.

The browser gate reproduces the bug first. Section 4c of `rumi-audio-smoke.mjs` splices a real
ElevenLabs clip and its timing (`scripts/fixtures/`) into a temporary copy of the app. Against
the 2026-09-12 build it failed four ways: the drawing instruction started no audio at all, turtle
was switched off, turtle played the clip once instead of four words, and so did a muted read.
The gate also now hides the device's voice list on every machine. A Mac's Chromium reports all
180 macOS voices, so every `voices > 0 ||` check there used to pass without testing anything.

## The listening drill, and the pace of a new instruction (RUMI L7, 2026-08-31)

**A tap is a listen, not an answer.** Whit: *"when user taps an answer option it should speak
that in spanish so the ear is being trained to listen and identify it... right now the only way
to know what an answer chip is is to read it in english and that's no good."*

He found the hole in the exercise. A tap used to *be* the answer, judged the instant it landed,
so the only way to choose between three pictures was to read the small English caption under
them — in a listening drill, in an app built for a child who cannot read. She was matching
English to English and never had to hear a word of Spanish to get a card right.

So tapping an option now **selects it and speaks it in Spanish**. She can tap all three, hold
each against the phrase Rumi said, and commit with **▶︎**, which already means *I am done with
this*. Wrong turns the chip red, takes it out of play — she ruled it out, and the app remembers
that for her — and says the phrase again, so the next guess is made against a fresh hearing
rather than a memory of one. Right turns it green, Rumi says the phrase and its English meaning
once, and only then does the card advance; advancing on the tap would delete the confirmation,
which is the part that teaches.

The 🔊 button deliberately stays *say the question again* rather than becoming a second submit.
She needs to re-hear the prompt far more often than she needs another way to commit, and one
control that sometimes replays and sometimes answers would be worse than either.

**The stroke instructions get their own, slower voice.** Whit: *"the spoken instructions for
drawing letters and numbers is too fast to understand. the repetition comes a touch too fast and
the spoken words are too fast for the instructions since those are difficult and new words."*

Two different bugs in one sentence. *Pace*: the 41 stroke cues are the hardest Spanish in the
app — `Baja hacia la izquierda, pasa la raya` is a sentence of unfamiliar words said while her
hand is moving — and **not one of them has a recorded clip**, so every one falls through to the
device voice at the card rate, which is tuned for phrases she has already met. A stroke cue now
has its own rate (`TRACE_RATE`, 0.55) that **ignores the speed buttons**: 🐇 is a statement about
how fast she wants the phrases, never about how fast a brand-new instruction can be decoded. Not
lower than 0.55 because browsers clamp the synthesis floor around 0.5 and anything under it
silently does nothing. *Gap*: the repeat used to land 250ms after the attempt was judged, before
she had registered that the attempt was over. It is `TR_REPEAT_MS` now — a beat of silence is
part of the instruction.

Recording those 41 cues would beat both halves of this fix, and `npm run rumi:audio && npm run
rumi:embed` already enumerates them. Until then the device voice is what says them, slowly.

## The three ways it went silent (RUMI L5, 2026-08-30)

Whit, on a phone: *"i'm getting no sound in rumi at all."* Both gates were green. Every one of
the 228 clips was a complete, valid, byte-tiled mp3. The app was silent anyway, and it was not
one bug — it was three, each of which could silence the app on its own, and each of which
**survived a reload**. That is why it read as *no sound at all* rather than as a glitch.

**One: the AudioContext was created once and resumed nowhere.** iOS suspends a context whenever
the app is backgrounded, the iPad locks, a call arrives, or another app takes the audio route —
and it has a fourth state, `interrupted`, that the old code never tested. After the first such
interruption every `src.start()` ran against a dead context: no sound, no exception, no fallback
to the device voice, and `onended` never fired — so the completion callbacks carrying the English
sandwich and the tracing stroke instruction were stranded too. The overlay that owned the only
`resume()` was `display:none` by then, so nothing short of a reload could revive it. There is now
exactly one place a context is made or revived, `ensureAudio()`, and a capture-phase `pointerdown`
listener calls it on every tap — the gesture iOS requires is always already happening.

`ensureAudio()` returns a **promise**, and that is load-bearing. `resume()` is asynchronous, and
the tap that revives the context is usually the same tap that asks for a clip; reading
`actx.state` synchronously after it still sees `suspended`, concludes there is no clip, and falls
through to a device voice that on this iPad does not exist. The first draft of the fix did
exactly that and was still silent. The browser gate caught it.

**Two: Web Audio obeys the hardware ring/silent switch on iOS.** Everything audible in Rumi is
Web Audio, and Web Audio alone plays under the *ambient* audio session, which the switch
silences. A muted iPad played all 228 clips to nobody. The fix is an element, not code:
`#silentLoop` is a quarter-second of true silence on loop, and an `<audio>` element that is
genuinely playing promotes the page to the *playback* session, which the switch does not touch.
It starts on the unlock tap and is paused whenever the app is muted or backgrounded, so the
session is held only while Rumi has something to say.

That workaround deliberately takes the iPad's own switch away from her, so the app owes a
grown-up a way back: **the 🔊 control in the header of every screen**, which Whit asked for in the
same breath. Three states — 🔊 on, 🔇 off, and 🔈 on a pink ground meaning *the audio route is
not open*, which is the diagnosis no build ever showed anyone. In that third state the tap
**revives rather than toggles**, because a button reporting that sound is broken must not also
mean "mute". Muting is a **gain change**, never a refusal to play: the buffer still runs, so
`onended` still fires and the sandwich, the stroke instruction and the auto-advance keep exactly
the timing they have unmuted. A mute that changed the app's timing would be a second bug.

**Three: turtle bypasses the clips by design, so on a voiceless device it is silence.** Turtle
wants one utterance per word with a real gap, which only `speechSynthesis` can do — and the
speed is persisted. One tap of 🐢 by a five-year-old muted the app across reloads, with nothing
on screen to say why. Turtle is now disabled when no device voice can deliver it, and
`effectiveSpeed()` degrades a *stored* turtle to walk at speaking time. That degradation is
deliberately **non-destructive**: `S.speed` is left alone, because voices load asynchronously and
a device whose Spanish voice arrives late should get its turtle back rather than have the setting
quietly rewritten underneath it at boot.

### The gate that actually listens

`npm run test:audio`. The two existing gates could not have caught any of this and never could:
they read the file, and the file was perfect. *Does a buffer reach the speakers* is a property of
a running browser.

So this one drives a real Chromium and hooks `AudioContext`, asserting on audio that actually
starts and on the gain it starts behind — a clip playing at gain 0 is silence and must not read
as sound. It runs on a machine with **no speech-synthesis voices at all**, which is not a
limitation of the test but the entire point: it is the iPad whose Spanish voice is absent, the
device the clips exist for.

Every case in it is a regression test. All three bugs above were observed red against the
2026-08-29 build and green against this one before the file was committed — *a gate nobody has
seen fail is a gate nobody knows is connected.* Playwright is the one dependency in this repo and
is deliberately optional: absent, the script prints `SKIP` and exits 0, so a fresh clone still
runs the other two gates with no install. A skip is not a pass — nothing was played, so the app
may already be silent. In CI it is installed with `--no-save`, which keeps `package.json`
dependency-free. `RUMI_CHROMIUM` points it at a pre-installed browser where one exists.

**The English policy, as amended (RUMI L4, 2026-08-22).** RUMI3 ruled that English is spoken only
on idle and only on a correct HEAR/FIND answer, so that she hears Spanish first. Whit amended it:
*"the single words can be only spanish but the phrases are too hard to figure out without the
english"* — an emoji can carry `rojo` 🔴 but not `¿Me dejas jugar contigo?`. So on the **first
meeting** of a phrase card (no star yet) Rumi speaks a sandwich — Spanish, a beat, the English
meaning once, a beat, Spanish again — and every phrase card carries a small 🇬🇧 control that
replays the English on demand. The last thing she ever hears is Spanish, because that is what she
repeats; once the card has its star the sandwich retires, so English never becomes predictable.
Which cards count as phrases is decided by exactly one rule, `needsGloss()` in
`scripts/rumi-strings.mjs`, with a textual twin in the app that the unit test holds in agreement;
per-card `gloss: true/false` overrides exist for where the token-count proxy is wrong (the
article+noun vocabulary in `mesa` and `ropa` stays Spanish-only, `Espérame` glosses despite being
one word). English is en-GB-SoniaNeural, Spanish is es-ES-XimenaNeural — two languages, two
audibly different people.

## Tracing, and why the cues are Spanish

She traces the letter on the same card that teaches her its Spanish name. The card opens as one
very large ghost F with a numbered dot on the stroke she starts with, and Rumi says *"efe. F de
flor"* over it. Whit's instruction, 2026-08-24: *"we need to have the letter tracing within the
Spanish language rumi app so that when you're practicing letters, you're also learning Spanish."*

**The glyph is painted before a word is spoken, and that ordering is a fix, not a preference.**
It shipped the other way round on 2026-08-24: the letter card showed first and only flipped to
the glyph once Rumi had finished the sentence. Whit found it on a phone the next morning and
reported the feature missing. It was not missing, it was invisible — you land on a card, there is
nothing to trace on screen, and if you tap forward you never see it at all. So `renderCard` now
opens the trace itself and the *stroke instruction* is what waits for the end of the sentence.
Two assertions hold that ordering, and the one named *the letter to trace is on screen before
Rumi speaks* fails against the build that shipped.

**The stroke instruction is Spanish and that is the whole idea.** `Baja una línea grande`,
`Cruza por arriba`, `Empieza arriba y da la vuelta` — 41 of them, one per distinct stroke, said
while her hand moves. They are BYTE-IDENTICAL on every repetition, because the point is that she
repeats them, and varying the wording destroys the mechanism. They live in the dataset, never in
a phrasing function. **They have no recorded clip yet** — the lane that built this had no
outbound network, so `edge-tts` could not run. They are enumerated by `rumi-strings.mjs`, so
`npm run rumi:audio && npm run rumi:embed` records and embeds them with no further edit; until
then they fall through to the device's own Spanish voice like any un-regenerated string.

**Tracing is a flag, not a card type.** `trace:"F"` rides on the existing `letter` card, so
hearing the letter and writing it stay one activity. A separate `trace` card type would have made
them two activities again. A card with no glyph, or one gated by age, falls back to the plain
letter or number card it was before any of this existed.

**A number card carries its countable things into the trace.** `cuatro` means four of something,
so four strawberries sit above the `4` while she writes it; the numeral alone would teach the
shape and not the quantity. They wrap in fives, so `diez` reads as two rows and not as a line
nobody can count.

**The age gate is the stored age, never a list of letters.** A glyph whose `minAge` is above
`S.age` still shows and still speaks; she is simply not asked to write it. At the shipped default
of 5 everything is traceable, so the gate is invisible until a grown-up sets a younger age.

**There is no timer and no self-ending session,** deliberately. The letter app that this geometry
came from ends itself after seven minutes because it has no other terminal state; Rumi has
seventeen of them — the end of a module, with the wind-down that already exists. A clock that cut
her off mid-module would delete the ending that already teaches "we're done". The bounding is per
stroke instead: three failed attempts let the stroke through, silently, and `▶︎` is live the whole
time so she can leave a letter whenever she likes.

### The stroke geometry, and the file that owns it

`letters/letters-app.html`, in the sibling `letters` repo, is the **author** of every shared
glyph. Both apps are one self-contained HTML file with no build step, so there is no shared
import to make and the data is copied into `<script id="rumiGlyphs">`. Fix shared geometry
**there** and re-copy; an edit made here is the one that gets silently reverted.

Section 12 of `rumi-unit-test.mjs` compares all 62 shared glyphs field by field and fails on any
difference. It compares geometry only — `path`, `start`, `order`, `direction`, `strokeFamily`,
`minAge`, `case` — because `cue` is deliberately not shared. When the sibling checkout is absent,
as it is in CI, it prints `SKIP` and the sentence *a skip is not a pass* rather than counting an
assertion.

`Ñ` and `ñ` are **authored here and nowhere else**: `letters` is an English alphabet and has
neither, and Rumi's has 27 letters. Same rules as the rest — same 1024 frame, base letter before
the tilde, top-to-bottom, left-to-right.

### The numbers module

Whit referred to it as though it existed. It did not: 17 modules, none of them numbers, and the
only Spanish numerals in the file were a ten-entry lookup used to speak her age. `Los números`
runs 1 to 10 — zero is left out because every card is built on countable objects and you cannot
put a finger on nothing. `diez` is two glyphs and is traced as two marks in one go, which is how
it is written. **The thing counted changes on every card and the number does not,** which is the
actual maths, and above five the row wraps in fives.

**There is no `index.html` and that is deliberate.** Root `CLAUDE.md`, ratified 2026-08-17: a file
is named `index.html` only when a web server requires that exact name to resolve a live URL. Here
one does not, because `vercel.json` rewrites `/` to the app. Whit finds files with Spotlight, which
shows him a filename and nothing else, so the real file keeps a name he can actually search for.
The gate asserts that no `index.html` appears, because adding one is the obvious fix for a 404 and
it would quietly undo this.

## Why the app is one file

Rumi is used on a phone, in a car, in a house with bad wifi, by a child who will not wait for a
spinner. Every clip is inlined as base64 so that once the page has loaded once, nothing else has to
succeed. The gate asserts this directly — zero subresource references — because the natural
direction of drift is to split the audio out into files, and that would break the app in exactly
the conditions it exists to survive.

The cost is honest and worth stating: the page is 8.5 MB and the first load is not fast. Tracing
added 50 KB to that — geometry is tiny — but it also added 52 Spanish strings with no clips yet,
and recording them will add roughly 1.0 MB when somebody runs the generator. About
1.9 MB of the current page is trailing edge-tts silence — `npm run rumi:trim-audit` measures it — left in
place deliberately: cutting it changes the app's pacing (clip end drives every completion
callback) and no trim ships without a human listening to a sample first.

## The gates, and the one assertion that matters

`npm run check` — 67 assertions, runs in about a second, needs nothing installed.
`npm run test:rumi` — 196 more, over the real shipped corpus, also with no network. Four fewer
when the `letters` sibling checkout is not on disk, and it says so out loud.
`npm run test:audio` — 85 more: 7 run in plain Node with no browser at all (they prove a
re-recording only rewrites the clip that changed), the rest drive a real headless Chromium and
skip, loudly, if playwright is not installed.

Most of it is ordinary: the file is present, the inline scripts parse, the stylesheet is non-empty,
`vercel.json` parses and its rewrites resolve to a real file with an extensionless destination
(with `cleanUrls` on, a destination ending in `.html` 404s in production — measured on `the-board`
2026-08-20).

**The assertion that earns the file is the audio one.** Both banks are decoded from base64 and
every clip is walked frame by frame, requiring the mp3 frames to tile the buffer exactly to its
last byte. A clip that was cut short still holds a valid ID3 tag and a valid first frame sync, so a
header check passes on a blob that is half gone — that was the first version of this gate, and it
printed 17/17 against a clip truncated to 200 base64 characters on 2026-08-21. The frame walk
catches it. Measured against the real banks the same day: 228 + 76 clips, 0 ragged.

This matters more than it sounds. A truncated clip renders a perfect page with every button in
place, and plays silence. The user is five. She will not file a bug.

Proven red three ways before it was trusted: a clip truncated mid-file, a syntax error in the app
block, and an `index.html` appearing.

The behavioural suite is the other half. Its own headline assertion runs the page's `buildOptions()`
against the real corpus and requires that no two answer options ever share an emoji — once the
options became pictures, a repeated glyph stopped being merely hard and became unanswerable, and
the shipped data really does contain repeats across modules. A second one asserts that this repo
has no middleware, no auth and no cookie-conditional routing, because the user is five and must
never meet a login screen.

## Provenance

Rumi shipped inside `quick-tools` and was extracted to its own repo on 2026-08-21 by the RUMI2
lane, executing `_handoffs/Ops-RUMI2-Give-Rumi-Its-Own-Home.md`.

Git history starts here. The build history is on the bridge, and those reports are the record of
how the app got its content:

- `done-2026-08-21-quick-tools-rumi1-ship-rumi-espanol.md` — the first ship, 212 clips.
- `done-2026-08-21-quick-tools-rumi3-no-reading-required.md` — the no-reading UI (emoji first,
  no glyphs), 228 es-ES + 76 en clips, and the Ximena voice at −35% walk speed.

**Why it was extracted.** Whit's ruling, 2026-08-20: *"right now I have the Rumi app in
production... if we stack them all in one dispatch, like a quick tools dispatch, they're all gonna
choke."* Every Rumi edit was competing for `quick-tools`' single writer slot with every internal
tooling edit, and `quick-tools` is where the internal tools live, not where products live.

## Saved progress

The app keeps progress in `localStorage` under the key `rumi.v1`. `localStorage` is scoped to an
origin, so the move to this domain starts the counter over — the old progress is not lost, it is
stranded at `quick-tools-pi.vercel.app` and unreachable from here. The redirect page left behind at
the old URL says so in plain words rather than letting a streak vanish silently.

## Deploying

`git push origin main`. Vercel builds from the push.

**Push or CLI-deploy, never both.** Two builds of one commit finish in either order and the alias
follows completion, not commit order. That is the 2026-07-16 alias race and it is still live.
