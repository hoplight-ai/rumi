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
// The same file rumi-eleven.mjs writes, in a different shape that rumi-words.mjs tells apart.
const TIMES_FILE = path.join(ROOT, 'build', 'rumi-times.json');

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

let fellBackOnce = false;

/** One clip, and the word marks beside it.
 *
 * RUMIVOICE1, 2026-09-15: this used to run the `edge-tts` command, which throws the service's
 * word boundaries away. The slow speed needs them — it plays the recording one word at a time —
 * so the call now goes through scripts/rumi-edge-words.py, which asks the same service for the
 * same voice at the same rate and keeps the marks. The audio is unchanged; only the discarded
 * half is new. If python3 cannot import the library, the command path below still records the
 * clip, and that clip simply plays whole, exactly as it did before this change. */
async function synth(bin, text, dest) {
  const marks = `${dest}.json`;
  try {
    await execFileAsync('python3', [
      path.join(ROOT, 'scripts', 'rumi-edge-words.py'),
      '--voice', VOICE,
      `--rate=${RATE_OFFSET}`,
      '--text', text,
      '--media', dest,
      '--marks', marks,
    ], { timeout: 60_000 });
  } catch (e) {
    if (!fellBackOnce) {
      console.log(`  word timing unavailable (${String(e.message).split('\n')[0].slice(0, 120)});`);
      console.log('  falling back to the edge-tts command: clips still record, they just play whole.');
      fellBackOnce = true;
    }
    await execFileAsync(bin, [
      '--voice', VOICE,
      // `--rate=-20%` as ONE token: argparse reads a separate `-20%` as an option, not a value.
      `--rate=${RATE_OFFSET}`,
      '--text', text,
      '--write-media', dest,
    ], { timeout: 60_000 });
  }
  const { size } = fs.statSync(dest);
  if (size < 512) throw new Error(`clip too small (${size} bytes) for: ${text}`);
  return size;
}

function writeMap(items) {
  const clips = {};
  const times = {};
  let bytes = 0;
  for (const it of items) {
    const f = path.join(OUT_DIR, clipFile(it.key));
    if (!fs.existsSync(f)) continue;
    const buf = fs.readFileSync(f);
    bytes += buf.length;
    clips[it.key] = buf.toString('base64');
    const t = `${f}.json`;
    if (fs.existsSync(t)) times[it.key] = JSON.parse(fs.readFileSync(t, 'utf8'));
  }
  fs.writeFileSync(MAP_FILE, JSON.stringify(clips));
  // Written AFTER the clip map, always, so its modification time is never older: rumi-embed.mjs
  // reads that comparison as "this timing describes these recordings" and clears the timing when
  // it does not. Deleted rather than left stale when a run produced no marks at all.
  if (Object.keys(times).length) fs.writeFileSync(TIMES_FILE, JSON.stringify(times));
  else if (fs.existsSync(TIMES_FILE)) fs.rmSync(TIMES_FILE);
  return { count: Object.keys(clips).length, bytes, timed: Object.keys(times).length };
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.indexOf('--limit');
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;
  const items = collect(fs.readFileSync(path.join(ROOT, 'rumi-espanol-app.html'), 'utf8'));

  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (args.includes('--map')) {
    const r = writeMap(items);
    console.log(`map: ${r.count} clips, ${(r.bytes / 1e6).toFixed(2)} MB raw, ${r.timed} with word timing -> ${MAP_FILE}`);
    return;
  }

  const bin = edgeBin();
  const todo = items.slice(0, limit === Infinity ? items.length : limit);
  let made = 0;
  let skipped = 0;
  let bytes = 0;

  for (const it of todo) {
    const dest = path.join(OUT_DIR, clipFile(it.key));
    // A cached clip is reused only when its word marks are cached too. The marks arrive with
    // the audio and cannot be recovered from an mp3 afterwards, so a clip recorded before this
    // change has to be recorded again to gain a slow speed — once, and then it caches like any
    // other. Once a run has proved the timing path unavailable, cached clips are reused as they
    // always were rather than re-recorded on every run for marks that are not coming.
    if (fs.existsSync(dest) && fs.statSync(dest).size >= 512
        && (fellBackOnce || fs.existsSync(`${dest}.json`))) {
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
