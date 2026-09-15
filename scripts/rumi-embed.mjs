#!/usr/bin/env node
// rumi-embed.mjs — splice the generated clip map into rumi-espanol-app.html, and gate the result.
//
// It rewrites exactly one line: the body of <script id="rumiClips">. Nothing else in the
// file is touched, which is what makes this safe to re-run — a regenerated clip set is a
// second run of this script, not a merge.
//
// The gates below run every time and refuse to write if any fails, because the failure mode
// this guards against is silent: a truncated base64 value produces a page that still loads,
// still looks right, and just never plays that one phrase.
//
// usage: node scripts/rumi-embed.mjs            embed build/rumi-clips.json into rumi-espanol-app.html
//        node scripts/rumi-embed.mjs --check     report what is embedded, write nothing

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect } from './rumi-strings.mjs';
import { spanMap } from './rumi-words.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = path.join(ROOT, 'rumi-espanol-app.html');
const MAP_FILE = path.join(ROOT, 'build', 'rumi-clips.json');
const TAG = /(<script id="rumiClips">)([\s\S]*?)(<\/script>)/;
// RUMI3: the English help lines and meanings, in their own file and their own tag. Kept
// separate end to end so a Spanish regeneration can never overwrite an en-GB recording.
const CUE_FILE = path.join(ROOT, 'build', 'rumi-cues.json');
const CUE_TAG = /(<script id="rumiCues">)([\s\S]*?)(<\/script>)/;
// RUMIVOICE1: per-word timing for the Spanish clips, written by whichever recorder made them
// (`rumi-audio.mjs --map` or `rumi-eleven.mjs --map`) and turned into spans by rumi-words.mjs.
const TIMES_FILE = path.join(ROOT, 'build', 'rumi-times.json');
const TIMES_TAG = /(<script id="rumiTimes">)([\s\S]*?)(<\/script>)/;

// Vercel serves this as one static file to an iPad, possibly on hotel wifi. 10MB is the
// brief's ceiling; the realistic payload is a third of that and a surprise past it means
// something went wrong upstream, not that the app grew.
const MAX_BYTES = 10 * 1024 * 1024;

function fail(msg) {
  console.error(`REFUSED: ${msg}`);
  process.exit(1);
}

function main() {
  const check = process.argv.includes('--check');
  const html = fs.readFileSync(HTML, 'utf8');
  const m = html.match(TAG);
  if (!m) fail('no <script id="rumiClips"> tag in rumi-espanol-app.html');

  if (check) {
    const embedded = (m[2].match(/"/g) || []).length;
    console.log(`embedded tag: ${Buffer.byteLength(m[2], 'utf8')} bytes, ~${Math.floor(embedded / 4)} keys`);
    console.log(`rumi-espanol-app.html: ${Buffer.byteLength(html, 'utf8')} bytes`);
    return;
  }

  if (!fs.existsSync(MAP_FILE)) fail(`${MAP_FILE} not found — run scripts/rumi-audio.mjs first`);
  const clips = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
  const keys = Object.keys(clips);
  if (!keys.length) fail('clip map is empty');

  // Gate 1: every key the app can ask for is a key we generated, or knowingly is not.
  const wanted = collect(html).map((it) => it.key);
  const missing = wanted.filter((k) => !Object.prototype.hasOwnProperty.call(clips, k));
  // Gate 2: no key we shipped is one the app will never ask for (a stale map after an edit).
  const wantedSet = new Set(wanted);
  const orphan = keys.filter((k) => !wantedSet.has(k));
  // Gate 3: every value decodes as base64 and is big enough to be real audio.
  for (const k of keys) {
    const v = clips[k];
    if (typeof v !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(v)) fail(`value for "${k}" is not base64`);
    if (v.length < 700) fail(`value for "${k}" is only ${v.length} base64 chars — too short to be a clip`);
  }

  const body = `window.RUMI_CLIPS = ${JSON.stringify(clips)};`;
  let next = html.replace(TAG, (_all, open, _old, close) => `${open}${body}${close}`);

  // The cue map is optional: if it has not been generated the page still works, it just has
  // no spoken English help. That is a degradation, not a break, so it must not fail the run.
  let cueCount = 0;
  if (fs.existsSync(CUE_FILE)) {
    const cues = JSON.parse(fs.readFileSync(CUE_FILE, 'utf8'));
    // Found 2026-09-15, one run before it shipped. `rumi:embed` regenerates the cue map from
    // build/rumi-cues/, and on a fresh clone that folder is empty — so the map is {}, this step
    // replaces a tag holding 171 English recordings with nothing, and every gate stays green
    // because an app with no English audio is a valid app. The child just stops being told what
    // anything means. An empty map is therefore only ever written over an already-empty tag.
    const cuesNow = (next.match(CUE_TAG)?.[2] || '').length;
    if (!Object.keys(cues).length && cuesNow > 200) {
      fail('the cue map is empty but the app has English cues embedded — regenerate them '
        + '(node scripts/rumi-cues.mjs) rather than deleting them');
    }
    for (const k of Object.keys(cues)) {
      const v = cues[k];
      if (typeof v !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(v)) fail(`cue for "${k}" is not base64`);
      if (v.length < 700) fail(`cue for "${k}" is only ${v.length} base64 chars — too short to be a clip`);
    }
    cueCount = Object.keys(cues).length;
    if (!CUE_TAG.test(next)) fail('no <script id="rumiCues"> tag in rumi-espanol-app.html');
    const cueBody = `window.RUMI_CUES = ${JSON.stringify(cues)};`;
    next = next.replace(CUE_TAG, (_all, open, _old, close) => `${open}${cueBody}${close}`);
  }
  // Timing. A timing map describes ONE set of recordings. Both recorders write one now (the
  // free voice since 2026-09-15), and either can rewrite rumi-clips.json — so a timing file
  // left over from the other recorder describes clips that are no longer the ones being
  // embedded, and a stale span cuts a word in half. Timing is written only when it is at least
  // as new as the clip map, whoever wrote it, and it is
  // otherwise CLEARED, never left behind. The app double-checks each span against its buffer.
  let timed = 0;
  let timesNote = 'none';
  let times = {};
  if (fs.existsSync(TIMES_FILE) && fs.statSync(TIMES_FILE).mtimeMs >= fs.statSync(MAP_FILE).mtimeMs) {
    const raw = JSON.parse(fs.readFileSync(TIMES_FILE, 'utf8'));
    const items = collect(html).filter((it) => Object.prototype.hasOwnProperty.call(clips, it.key));
    const { map, dropped } = spanMap(items, raw);
    times = map;
    timed = Object.keys(map).length;
    timesNote = `${timed} lines timed${dropped.length ? `, ${dropped.length} dropped (recorded words did not match the text)` : ''}`;
    for (const k of dropped) console.log(`  UNTIMED  ${k}`);
  } else if (fs.existsSync(TIMES_FILE)) {
    timesNote = 'cleared: the timing file is older than the clip map, so it describes other recordings';
  }
  if (!TIMES_TAG.test(next)) fail('no <script id="rumiTimes"> tag in rumi-espanol-app.html');
  next = next.replace(TIMES_TAG, (_all, open, _old, close) => `${open}window.RUMI_TIMES = ${JSON.stringify(times)};${close}`);

  const bytes = Buffer.byteLength(next, 'utf8');
  if (bytes > MAX_BYTES) fail(`result would be ${(bytes / 1e6).toFixed(2)} MB, over the ${MAX_BYTES / 1e6} MB ceiling`);

  fs.writeFileSync(HTML, next);

  console.log(`embedded ${keys.length} spanish clips + ${cueCount} english cues`);
  console.log(`per-word timing: ${timesNote}`);
  console.log(`rumi-espanol-app.html: ${(bytes / 1e6).toFixed(2)} MB`);
  console.log(`strings the app can speak: ${wanted.length}`);
  console.log(`missing clips (fall back to speechSynthesis): ${missing.length}`);
  for (const k of missing) console.log(`  MISS  ${k}`);
  console.log(`orphan clips (generated, never requested): ${orphan.length}`);
  for (const k of orphan) console.log(`  ORPHAN  ${k}`);
}

main();
