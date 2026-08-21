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
| `vercel.json` | `cleanUrls`, and the two rewrites that serve the app at `/` and at `/rumi` |
| `scripts/ci-check.mjs` | the gate. 17 assertions, no network, no dependencies |
| `.github/workflows/ci.yml` | runs the gate on every push |

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

The cost is honest and worth stating: the page is 7 MB and the first load is not fast.

## The gate, and the one assertion that matters

`node scripts/ci-check.mjs` — 17 assertions, runs in about a second, needs nothing installed.

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
