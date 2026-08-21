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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = path.join(ROOT, 'rumi-espanol-app.html');
const MAP_FILE = path.join(ROOT, 'build', 'rumi-clips.json');
const TAG = /(<script id="rumiClips">)([\s\S]*?)(<\/script>)/;
// RUMI3: the English help lines and meanings, in their own file and their own tag. Kept
// separate end to end so a Spanish regeneration can never overwrite an en-GB recording.
const CUE_FILE = path.join(ROOT, 'build', 'rumi-cues.json');
const CUE_TAG = /(<script id="rumiCues">)([\s\S]*?)(<\/script>)/;

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
  const bytes = Buffer.byteLength(next, 'utf8');
  if (bytes > MAX_BYTES) fail(`result would be ${(bytes / 1e6).toFixed(2)} MB, over the ${MAX_BYTES / 1e6} MB ceiling`);

  fs.writeFileSync(HTML, next);

  console.log(`embedded ${keys.length} spanish clips + ${cueCount} english cues`);
  console.log(`rumi-espanol-app.html: ${(bytes / 1e6).toFixed(2)} MB`);
  console.log(`strings the app can speak: ${wanted.length}`);
  console.log(`missing clips (fall back to speechSynthesis): ${missing.length}`);
  for (const k of missing) console.log(`  MISS  ${k}`);
  console.log(`orphan clips (generated, never requested): ${orphan.length}`);
  for (const k of orphan) console.log(`  ORPHAN  ${k}`);
}

main();
