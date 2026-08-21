#!/usr/bin/env node
// rumi-audio.mjs — generate one neural-TTS MP3 per spoken string and write the clip map.
//
// WHY THIS EXISTS. The app's fallback voice is the browser's own speechSynthesis, which on
// an iPad is whatever Spanish voice the device happens to have installed — often none, in
// which case the app is silent, and when present it is the robotic compact voice. The child
// this is for is five and pre-literate, so the audio IS the product. Pre-generated neural
// clips make the voice identical on every device and, being embedded in the page, they work
// with no signal at all.
//
// WHY ONE SET AT A SLOWED RATE, NOT playbackRate 0.75. Slowing an AudioBufferSourceNode
// resamples it: 0.75 drops the pitch about five semitones, which turns a female Spain voice
// into a slurred male one. That is a real quality loss on the exact thing this upgrade is
// meant to improve. edge-tts's own `--rate` is a prosody change instead — the voice speaks
// slower at its own pitch. So we generate ONE set at RATE_OFFSET and play it at 1.0 for
// walk (the default speed). Rabbit plays the same buffer at RABBIT_PLAYBACK, a mild speed-up
// rather than a large slow-down, so the pitch artifact lands on the setting that wants to
// sound brisk instead of on the everyday one.
//
// Turtle speed never uses clips: it needs one utterance per word with a real gap between
// them, which is a speechSynthesis behaviour, and that path is untouched.
//
// usage: node scripts/rumi-audio.mjs                 generate into build/rumi-clips/
//        node scripts/rumi-audio.mjs --limit 5       sample run, for sizing
//        node scripts/rumi-audio.mjs --map           write build/rumi-clips.json from what exists

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { collect } from './rumi-strings.mjs';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Whit's pick, 2026-08-21, after listening to the bake-off: Ximena over Elvira.
export const VOICE = 'es-ES-XimenaNeural';
// edge-tts's default output is audio-24khz-48kbitrate-mono-mp3 — already the 48kbps mono the
// brief asks for, so no ffmpeg pass is needed (and ffmpeg is not installed on this machine).
// Whit, 2026-08-21: "for slow, try 35% slow not just 20". This is the WALK speed — the
// default, and the one she spends nearly all her time in — so it is the one worth slowing.
// Asking the synthesiser for it (rather than resampling on playback) keeps the pitch correct;
// resampling to the same pace would drop it about seven semitones and turn Ximena into a man.
export const RATE_OFFSET = '-35%';

const OUT_DIR = path.join(ROOT, 'build', 'rumi-clips');
const MAP_FILE = path.join(ROOT, 'build', 'rumi-clips.json');

// edge-tts installs to the user site-packages bin, which is not on PATH here.
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

/** Content-addressed filename for a clip key.
 *
 * RUMI3, 2026-08-21: this used to be the item's INDEX, zero-padded. That made the cache
 * silently wrong the moment the corpus order changed — adding the 17 module names shifted
 * every index, so every cached file would have been reused for a different phrase. A
 * mismatched-but-plausible audio clip is the worst kind of bug here: the app works, the
 * child hears the wrong word, and nothing anywhere reports it. Hashing the key means a
 * clip's filename depends only on what it says, so caches survive any corpus edit. */
export function clipFile(key) {
  // The hash MUST cover the voice and the rate, not just the phrase. Hashing the phrase
  // alone means switching voices silently REUSES every clip of the old one: the run reports
  // "reused 228", the page ships the previous voice, and nothing anywhere says so. Caught
  // 2026-08-21 while switching Elvira -> Ximena, before it could ship.
  const stamp = `${VOICE}|${RATE_OFFSET}|${key}`;
  return `${createHash('sha256').update(stamp).digest('hex').slice(0, 16)}.mp3`;
}

async function synth(bin, text, dest) {
  await execFileAsync(bin, [
    '--voice', VOICE,
    // `--rate=-20%` as ONE token: argparse reads a separate `-20%` as an option, not a value.
    `--rate=${RATE_OFFSET}`,
    '--text', text,
    '--write-media', dest,
  ], { timeout: 60_000 });
  const { size } = fs.statSync(dest);
  if (size < 512) throw new Error(`clip too small (${size} bytes) for: ${text}`);
  return size;
}

function writeMap(items) {
  const clips = {};
  let bytes = 0;
  for (const it of items) {
    const f = path.join(OUT_DIR, clipFile(it.key));
    if (!fs.existsSync(f)) continue;
    const buf = fs.readFileSync(f);
    bytes += buf.length;
    clips[it.key] = buf.toString('base64');
  }
  fs.writeFileSync(MAP_FILE, JSON.stringify(clips));
  return { count: Object.keys(clips).length, bytes };
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.indexOf('--limit');
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;
  const items = collect(fs.readFileSync(path.join(ROOT, 'rumi-espanol-app.html'), 'utf8'));

  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (args.includes('--map')) {
    const r = writeMap(items);
    console.log(`map: ${r.count} clips, ${(r.bytes / 1e6).toFixed(2)} MB raw -> ${MAP_FILE}`);
    return;
  }

  const bin = edgeBin();
  const todo = items.slice(0, limit === Infinity ? items.length : limit);
  let made = 0;
  let skipped = 0;
  let bytes = 0;

  for (const it of todo) {
    const dest = path.join(OUT_DIR, clipFile(it.key));
    if (fs.existsSync(dest) && fs.statSync(dest).size >= 512) {
      skipped += 1;
      bytes += fs.statSync(dest).size;
      continue;
    }
    // Serial, not parallel: the Edge endpoint rate-limits and a 403 here is the brief's
    // named failure mode. Losing two minutes is cheaper than losing the whole run.
    bytes += await synth(bin, it.text, dest);
    made += 1;
    if (made % 25 === 0) console.log(`  ${made} generated (${(bytes / 1e6).toFixed(2)} MB)`);
  }

  console.log(`generated ${made}, reused ${skipped}, total ${todo.length} clips, ${(bytes / 1e6).toFixed(2)} MB raw`);
  console.log(`base64 estimate: ${((bytes * 4) / 3 / 1e6).toFixed(2)} MB`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
}
