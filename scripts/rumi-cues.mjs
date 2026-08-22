#!/usr/bin/env node
// rumi-cues.mjs — generate the ENGLISH audio: the idle help lines and every card's meaning.
//
// WHY THIS IS A SECOND SCRIPT AND A SECOND MAP. rumi-audio.mjs owns the Spanish corpus in
// es-ES-ElviraNeural. These are en-GB, they answer a different question, and they must
// survive a Spanish regeneration untouched. One script owning both would eventually
// regenerate one language into the other's map, and the failure would be a Spanish app
// speaking English at a child — silent, plausible, and very hard to spot in a base64 blob.
//
// WHAT IT COVERS
//   1. Six idle help lines, spoken only after 5s of no taps, so she hears Spanish first.
//   2. Every module's English name, for the adult and for the reveal.
//   3. Every card's English meaning, played ONCE after a correct HEAR/FIND answer — the one
//      moment English earns its place, because she has just committed to a guess.
//
// usage: node scripts/rumi-cues.mjs            generate into build/rumi-cues/
//        node scripts/rumi-cues.mjs --limit 5  sample run, for sizing
//        node scripts/rumi-cues.mjs --map      write build/rumi-cues.json from what exists

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readModules, normalizeKey, needsGloss } from './rumi-strings.mjs';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// en-GB, deliberately: the child is going to Spain from an English-speaking home, and a
// British English helper voice beside a Castilian teacher voice is two clearly different
// people rather than one confused one.
export const VOICE = 'en-GB-SoniaNeural';
// The help lines are read at normal pace. They are instructions, not language practice.
export const RATE_OFFSET = '+0%';

const OUT_DIR = path.join(ROOT, 'build', 'rumi-cues');
const MAP_FILE = path.join(ROOT, 'build', 'rumi-cues.json');

/** The six idle help lines. Keys MUST match CUE_KEY in rumi-espanol-app.html. */
export const HELP_LINES = [
  'Your turn — say it',
  'What does it mean?',
  'Tap the right picture',
  'Now do it',
  'Say it with Rumi',
  'Tap here when you did it',
];

const CANDIDATES = [
  process.env.EDGE_TTS_BIN,
  `${process.env.HOME}/Library/Python/3.9/bin/edge-tts`,
  '/usr/local/bin/edge-tts',
  'edge-tts',
].filter(Boolean);

function edgeBin() {
  for (const c of CANDIDATES) {
    if (c === 'edge-tts') return c;
    if (fs.existsSync(c)) return c;
  }
  return 'edge-tts';
}

/** Every English string the app can speak, deduped on the runtime key. */
export function collectEnglish(html) {
  const { modules } = readModules(html);
  const out = new Map();
  const add = (s) => {
    if (!s) return;
    // {NAME} is never voiced anywhere in this app, and {AGE}/{A}/{E} do not appear in the
    // English glosses. Strip defensively and skip anything still carrying a placeholder.
    const clean = String(s).replace(/\{NAME\}/g, '').replace(/\s+/g, ' ').trim();
    if (!clean || clean.includes('{')) return;
    const key = normalizeKey(clean);
    if (!out.has(key)) out.set(key, clean);
  };

  for (const line of HELP_LINES) add(line);
  for (const m of modules) {
    add(m.en);                                   // module name, spoken on the reveal path
    for (const c of m.cards || []) {
      // Two gates, deliberately a union (RUMI L4 amends RUMI3, it does not repeal it):
      //   - hear/find keep their clip whatever needsGloss says, because the correct-answer
      //     reveal plays the English after she commits to a guess, single words included.
      //   - needsGloss() adds every phrase card — say, answer, do — whose meaning the emoji
      //     cannot carry, for the first-meeting sandwich and the W3b repeat control.
      if (needsGloss(c) || c.t === 'hear' || c.t === 'find') add(c.en);
      // The reply is the payoff line and it is the half she has to understand.
      if (c.reply && needsGloss({ t: 'reply', es: c.reply.es, gloss: c.reply.gloss })) add(c.reply.en);
    }
  }
  return [...out.entries()].map(([key, text]) => ({ key, text }));
}

// Content-addressed, for the same reason rumi-audio.mjs is: a filename that depends on
// the item's position makes every cached clip wrong the moment the corpus order changes.
export const clipFile = (key) =>
  `${createHash('sha256').update(`${VOICE}|${RATE_OFFSET}|${key}`).digest('hex').slice(0, 16)}.mp3`;

async function synth(bin, text, dest) {
  await execFileAsync(bin, [
    '--voice', VOICE,
    `--rate=${RATE_OFFSET}`,
    '--text', text,
    '--write-media', dest,
  ], { timeout: 60_000 });
  const { size } = fs.statSync(dest);
  if (size < 512) throw new Error(`clip too small (${size} bytes) for: ${text}`);
  return size;
}

function writeMap(items) {
  const cues = {};
  let bytes = 0;
  for (const it of items) {
    const f = path.join(OUT_DIR, clipFile(it.key));
    if (!fs.existsSync(f)) continue;
    const buf = fs.readFileSync(f);
    bytes += buf.length;
    cues[it.key] = buf.toString('base64');
  }
  fs.writeFileSync(MAP_FILE, JSON.stringify(cues));
  return { count: Object.keys(cues).length, bytes };
}

async function main() {
  const args = process.argv.slice(2);
  const li = args.indexOf('--limit');
  const limit = li >= 0 ? Number(args[li + 1]) : Infinity;
  const items = collectEnglish(fs.readFileSync(path.join(ROOT, 'rumi-espanol-app.html'), 'utf8'));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (args.includes('--map')) {
    const r = writeMap(items);
    console.log(`map: ${r.count} cues, ${(r.bytes / 1e6).toFixed(2)} MB raw -> ${MAP_FILE}`);
    return;
  }

  const bin = edgeBin();
  const todo = items.slice(0, limit === Infinity ? items.length : limit);
  let made = 0, skipped = 0, bytes = 0;
  for (const it of todo) {
    const dest = path.join(OUT_DIR, clipFile(it.key));
    if (fs.existsSync(dest) && fs.statSync(dest).size >= 512) {
      skipped += 1; bytes += fs.statSync(dest).size; continue;
    }
    // Serial: the Edge endpoint rate-limits, and losing two minutes beats losing the run.
    bytes += await synth(bin, it.text, dest);
    made += 1;
    if (made % 25 === 0) console.log(`  ${made} generated (${(bytes / 1e6).toFixed(2)} MB)`);
  }
  console.log(`generated ${made}, reused ${skipped}, total ${todo.length} cues, ${(bytes / 1e6).toFixed(2)} MB raw`);
  console.log(`base64 estimate: ${((bytes * 4) / 3 / 1e6).toFixed(2)} MB`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
}
