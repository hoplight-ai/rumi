# Rumi

A Spanish app for a five-year-old who cannot read yet.

One HTML file. Everything — the markup, the styles, the app logic, and 304 recorded audio clips —
is inside it. No build step, no dependencies, no network calls, no accounts, no analytics.

**Live:** recorded in the RUMI2 report on the bridge and in `_handoffs/_lanes/POLICY.md`. The URL
Vercel generated for this project is the one that counts; do not guess it from the project name.

## The file

| Path | What it is |
|---|---|
| `rumi-espanol-app.html` | the whole app, 8,483,696 bytes |
| `rumi-voice-bakeoff.html` | voice comparison, for Whit's ear. Served at `/rumi-voice-bakeoff` |
| `vercel.json` | `cleanUrls`, and the two rewrites that serve the app at `/` and at `/rumi` |
| `scripts/ci-check.mjs` | the structural gate. 22 assertions, no network, no dependencies |
| `scripts/rumi-unit-test.mjs` | the behavioural suite. 144 assertions over the real shipped corpus |
| `scripts/rumi-strings.mjs` etc. | the content toolchain — see below |
| `.github/workflows/ci.yml` | runs both gates on every push |

## Regenerating the content

The audio is produced from the strings in the app and embedded back into it. The source audio
lives under `build/`, which is **not in the repo** — regenerating needs a voice credential Whit
holds, so a fresh clone can run the gates but not the generators.

```bash
npm run rumi:strings    # list the phrases the app asks for
npm run rumi:extract    # rebuild build/ from the shipped page (reuse, never resynthesize)
npm run rumi:audio      # render the Spanish clips
npm run rumi:cues       # render the English cues (idle help + phrase glosses)
npm run rumi:embed      # base64 both banks back into the app file
npm run rumi:bakeoff    # rebuild the voice comparison page
```

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

She traces the letter on the same card that teaches her its Spanish name. Rumi says
*"efe. F de flor"*, the flower is there, and then the card is replaced by one very large ghost F
with a numbered dot on the stroke she starts with. Whit's instruction, 2026-08-24: *"we need to
have the letter tracing within the Spanish language rumi app so that when you're practicing
letters, you're also learning Spanish."*

**The stroke instruction is Spanish and that is the whole idea.** `Baja una línea grande`,
`Cruza por arriba`, `Empieza arriba y da la vuelta` — 41 of them, one per distinct stroke, said
while her hand moves. They are BYTE-IDENTICAL on every repetition, because the point is that she
repeats them, and varying the wording destroys the mechanism. They live in the dataset, never in
a phrasing function. **They have no recorded clip yet** — the lane that built this had no
outbound network, so `edge-tts` could not run. They are enumerated by `rumi-strings.mjs`, so
`npm run rumi:audio && npm run rumi:embed` records and embeds them with no further edit; until
then they fall through to the device's own Spanish voice like any un-regenerated string.

**Tracing is a flag, not a card type.** `trace:"F"` rides on the existing `letter` card, so
hearing the letter and writing it stay one activity with two beats. A separate `trace` card type
would have made them two activities again.

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

`npm run check` — 22 assertions, runs in about a second, needs nothing installed.
`npm run test:rumi` — 144 more, over the real shipped corpus, also with no network. 140 of them
when the `letters` sibling checkout is not on disk, and it says so out loud.

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
