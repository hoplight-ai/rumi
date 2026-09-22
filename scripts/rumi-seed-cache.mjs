#!/usr/bin/env node
// rumi-seed-cache.mjs — refill build/rumi-clips-11/ from the recordings already on disk, so a
// re-render only ever pays for the lines that are genuinely new.
//
// WHY THIS EXISTS. build/ is gitignored, so every fresh clone and every new worktree starts with
// an empty render cache. rumi-eleven.mjs decides what to synthesise by asking one question per
// line — is there already a file at build/rumi-clips-11/<clipFile(key, voice)>.mp3? — so on a
// machine with an empty build/ the answer is no for all 288 lines in all five voices, and
// `npm run rumi:11:packs` re-renders 1,440 clips. That costs about 20,000 ElevenLabs credits and
// roughly 1,400 serial API calls for lines that are already recorded, and it is worse than
// wasteful: every one of those clips comes back a FRESH take of the same text. The same sentence,
// said again, slightly differently. Whit has heard the shipped takes. Adding a line to the corpus
// should not re-record the 280 that were already right.
//
// The recordings are not lost when build/ is empty — they ship:
//   the four downloadable voices   voices/<slug>/<clip-id>.mp3, listed in voices/<slug>/index.json
//   the embedded voice (Inés)      base64 inside <script id="rumiClips"> in rumi-espanol-app.html,
//                                  with her word spans in <script id="rumiTimes">
// This script reads both and writes them back into the render cache under the exact names
// rumi-eleven.mjs's own clipFile() produces, so the renderer sees every existing line as already
// made. It is the ElevenLabs-era sibling of scripts/rumi-extract.mjs, which does the same job for
// the older edge-tts bank.
//
// THE FILE NAMES ALREADY AGREE, which is what makes the copy exact rather than a re-derivation:
// rumi-packs.mjs names each pack clip with `clipFile(it.key, v.id)` from rumi-eleven.mjs — the
// same function, the same voice id, the same model / speed / format stamp. So a pack file and its
// render-cache file are the same name, and seeding is a byte-for-byte copy. If the model, the
// speed or the output format ever changes, the names stop matching, nothing is seeded, and the
// renderer correctly re-records everything — which is the behaviour that stamp was built for.
//
// TIMING IS PRESERVED, NOT RECOMPUTED. An mp3 carries no word boundaries; they came from the
// with-timestamps response at render time and cannot be recovered from the audio. What ships is
// the CONVERTED form — the flat word spans [clip end, s0, e0, s1, e1, …] that rumi-words.mjs
// produces — so this script converts them back into the per-character alignment the render cache
// holds beside each clip, and then proves the conversion by running rumi-words.mjs over the result
// and refusing unless it reproduces the shipped spans exactly, to the digit. A line whose timing
// cannot be round-tripped is a line that would lose its word-by-word playback, so it stops the run.
//
// usage: node scripts/rumi-seed-cache.mjs          seed build/rumi-clips-11/ from what is on disk
//        node scripts/rumi-seed-cache.mjs --dry    report what it would seed, write nothing
//
// then:  node --env-file=.env.local scripts/rumi-packs.mjs   renders only what is missing

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect } from './rumi-strings.mjs';
import { wordSpans } from './rumi-words.mjs';
import { VOICES, packDir, packIndexPath } from './rumi-voices.mjs';
import { BANKS, clipFile } from './rumi-eleven.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = path.join(ROOT, 'rumi-espanol-app.html');

function fail(msg) {
  console.error(`REFUSED: ${msg}`);
  process.exit(1);
}

/** The inverse of rumi-words.mjs: flat word spans back into the per-character alignment the
 *  render cache stores. Characters inside a word get their share of that word's span by straight
 *  interpolation, so the first character's start and the last character's end are the word's own
 *  two numbers, unchanged. A single space is written between words, and one more at the end
 *  carrying the clip's end time — which is not the last word's end, because a line usually has a
 *  breath of audio after the last syllable, and that tail is what the app uses to know when the
 *  clip is over. Returns null when the spans and the text do not describe the same line. */
export function alignmentFromSpans(text, spans) {
  if (!Array.isArray(spans) || spans.length < 3) return null;
  const words = String(text).split(/\s+/).filter(Boolean);
  if (spans.length !== 1 + words.length * 2) return null;

  const characters = [];
  const character_start_times_seconds = [];
  const character_end_times_seconds = [];
  const push = (ch, s, e) => {
    characters.push(ch);
    character_start_times_seconds.push(s);
    character_end_times_seconds.push(e);
  };

  let lastEnd = 0;
  for (let i = 0; i < words.length; i += 1) {
    const s = spans[1 + i * 2];
    const e = spans[2 + i * 2];
    if (typeof s !== 'number' || typeof e !== 'number' || !(e > s)) return null;
    if (i) push(' ', lastEnd, s);
    const w = [...words[i]];
    for (let j = 0; j < w.length; j += 1) {
      push(w[j], s + ((e - s) * j) / w.length, s + ((e - s) * (j + 1)) / w.length);
    }
    lastEnd = e;
  }
  // The clip's end, parked on a trailing space so it is the last character's end time and no
  // word's span changes. wordSpans() ignores whitespace when it groups words and reads only the
  // final end time for the clip length, which is exactly what this carries.
  const clipEnd = typeof spans[0] === 'number' && spans[0] > lastEnd ? spans[0] : lastEnd;
  push(' ', lastEnd, clipEnd);

  return { characters, character_start_times_seconds, character_end_times_seconds };
}

const sameSpans = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length
  && a.every((n, i) => n === b[i]);

/** The embedded voice: base64 clips and word spans read straight out of the shipped page. */
function sourceFromPage(html) {
  const clipTag = html.match(/<script id="rumiClips">window\.RUMI_CLIPS = ([\s\S]*?);<\/script>/);
  const timeTag = html.match(/<script id="rumiTimes">window\.RUMI_TIMES = ([\s\S]*?);<\/script>/);
  if (!clipTag) return null;
  const clips = JSON.parse(clipTag[1]);
  const times = timeTag ? JSON.parse(timeTag[1]) : {};
  const out = {};
  for (const k of Object.keys(clips)) {
    out[k] = { buf: Buffer.from(clips[k], 'base64'), spans: times[k] || null };
  }
  return { where: 'rumi-espanol-app.html (embedded voice)', clips: out };
}

/** A downloadable voice: one index plus one mp3 per clip, already named by clipFile(). */
function sourceFromPack(v) {
  const indexFile = path.join(ROOT, packIndexPath(v.slug));
  if (!fs.existsSync(indexFile)) return null;
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  const entries = (index.clips && typeof index.clips === 'object') ? index.clips : {};
  const times = (index.times && typeof index.times === 'object') ? index.times : {};
  const out = {};
  for (const k of Object.keys(entries)) {
    const rec = entries[k];
    if (!rec || typeof rec.file !== 'string') continue;
    const f = path.join(ROOT, packDir(v.slug), rec.file);
    if (!fs.existsSync(f)) continue;
    out[k] = { buf: fs.readFileSync(f), spans: times[k] || null };
  }
  return { where: `${packDir(v.slug)}/`, clips: out };
}

function main() {
  const dry = process.argv.includes('--dry');
  const html = fs.readFileSync(HTML, 'utf8');
  const items = collect(html);
  const byKey = new Map(items.map((it) => [it.key, it.text]));
  const dir = BANKS.es.dir;
  if (!dry) {
    fs.mkdirSync(dir, { recursive: true });
    // build/ is machine-generated bulk: keep Spotlight out of it (root CLAUDE.md, 2026-08-17).
    const noIndex = path.join(ROOT, 'build', '.metadata_never_index');
    if (!fs.existsSync(noIndex)) fs.writeFileSync(noIndex, '');
  }

  console.log(`${items.length} spanish lines, ${VOICES.length} voices, cache at build/rumi-clips-11/\n`);
  let totalSeeded = 0;
  let totalNew = 0;
  const badTiming = [];

  for (const v of VOICES) {
    const src = v.embedded ? sourceFromPage(html) : sourceFromPack(v);
    if (!src) {
      console.log(`${v.slug.padEnd(9)} no source on disk — every line will be rendered`);
      totalNew += items.length;
      continue;
    }
    let wrote = 0;
    let already = 0;
    let timed = 0;
    let untimed = 0;
    const missing = [];

    for (const it of items) {
      const rec = src.clips[it.key];
      if (!rec) { missing.push(it.key); continue; }
      const dest = path.join(dir, clipFile(it.key, v.id));

      // Timing first: a clip written without its alignment is a clip the renderer will never
      // revisit and a line that has silently lost word-by-word playback.
      let alignment = null;
      if (rec.spans) {
        alignment = alignmentFromSpans(byKey.get(it.key), rec.spans);
        const back = alignment ? wordSpans(byKey.get(it.key), alignment) : null;
        if (!sameSpans(back, rec.spans)) {
          badTiming.push(`${v.slug}: ${it.key}`);
          alignment = null;
        } else timed += 1;
      } else untimed += 1;

      if (fs.existsSync(dest) && fs.readFileSync(dest).equals(rec.buf)) already += 1;
      else if (!dry) { fs.writeFileSync(dest, rec.buf); wrote += 1; } else wrote += 1;
      if (alignment && !dry) fs.writeFileSync(`${dest}.json`, JSON.stringify(alignment));
    }

    totalSeeded += wrote + already;
    totalNew += missing.length;
    console.log(`${v.slug.padEnd(9)} ${String(wrote + already).padStart(3)} seeded `
      + `(${wrote} written, ${already} already current), ${timed} with timing`
      + `${untimed ? `, ${untimed} without` : ''}, ${missing.length} to render `
      + `— from ${src.where}`);
    if (missing.length && missing.length <= 12) {
      for (const k of missing) console.log(`    TO RENDER  ${k}`);
    }
  }

  if (badTiming.length) {
    fail(`${badTiming.length} lines' word timing could not be rebuilt from what shipped `
      + `(${badTiming.slice(0, 5).join('; ')}). Seeding them would hand the app a clip whose `
      + 'spans no longer match it, and a wrong span cuts a word in half. Nothing was trusted: '
      + 're-render those lines instead.');
  }

  console.log(`\n${totalSeeded} clips seeded across ${VOICES.length} voices, ${totalNew} left to render.`);
  if (dry) console.log('--dry: nothing written.');
  else console.log('next: node --env-file=.env.local scripts/rumi-packs.mjs');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
