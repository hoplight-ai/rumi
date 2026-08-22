# Rumi

A Spanish app for a five-year-old who cannot read yet.

One HTML file. Everything — the markup, the styles, the app logic, and 304 recorded audio clips —
is inside it. No build step, no dependencies, no network calls, no accounts, no analytics.

**Live:** recorded in the RUMI2 report on the bridge and in `_handoffs/_lanes/POLICY.md`. The URL
Vercel generated for this project is the one that counts; do not guess it from the project name.

## The file

| Path | What it is |
|---|---|
| `rumi-espanol-app.html` | the whole app, 7,041,806 bytes |
| `rumi-voice-bakeoff.html` | voice comparison, for Whit's ear. Served at `/rumi-voice-bakeoff` |
| `vercel.json` | `cleanUrls`, and the two rewrites that serve the app at `/` and at `/rumi` |
| `scripts/ci-check.mjs` | the structural gate. 20 assertions, no network, no dependencies |
| `scripts/rumi-unit-test.mjs` | the behavioural suite. 72 assertions over the real shipped corpus |
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

The cost is honest and worth stating: the page is 8.4 MB and the first load is not fast. About
1.9 MB of that is trailing edge-tts silence — `npm run rumi:trim-audit` measures it — left in
place deliberately: cutting it changes the app's pacing (clip end drives every completion
callback) and no trim ships without a human listening to a sample first.

## The gates, and the one assertion that matters

`npm run check` — 20 assertions, runs in about a second, needs nothing installed.
`npm run test:rumi` — 72 more, over the real shipped corpus, also with no network.

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
