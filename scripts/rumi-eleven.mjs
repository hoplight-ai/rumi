#!/usr/bin/env node
// rumi-eleven.mjs — render the Rumi corpus with ElevenLabs instead of edge-tts.
//
// WHY THIS EXISTS, AND WHY IT IS A SECOND SCRIPT RATHER THAN AN EDIT TO rumi-audio.mjs.
// edge-tts is free and has exactly two controls: a voice name and a rate. It cannot be
// directed, it cannot be given a character, it returns no timing information, and its
// catalogue is Microsoft's. ElevenLabs gives three things edge-tts structurally cannot:
// a voice designed for this app rather than picked off a list, per-character timing that
// turns "turtle" into the real voice said one word at a time instead of a fallback to a
// device voice that on the target iPad does not exist, and inline direction.
//
// The edge path stays on disk and stays wired. Both generators write the same two files
// (build/rumi-clips.json, build/rumi-cues.json) in the same shape, so rumi-embed.mjs is
// untouched and a bad ElevenLabs run is undone by re-running the edge one.
//
// THE FILE SIZE GATE IS THE REAL CONSTRAINT, NOT THE CREDITS. rumi-embed.mjs refuses to
// write an app over 10,485,760 bytes and the shipped app is already 8,483,696 of them.
// Every clip is base64 inside the page, so bitrate is app size times 4/3. ElevenLabs
// defaults to mp3_44100_128 — nearly three times edge-tts's 48kbps — which would blow the
// gate on its own. OUTPUT_FORMAT is pinned below and must stay pinned. ffmpeg is not
// installed on this machine, so a wrong format cannot be repaired after the fact; it has
// to be asked for correctly.
//
// usage:
//   node scripts/rumi-eleven.mjs --estimate          what it would cost, no key, no network
//   node scripts/rumi-eleven.mjs --voices            list the voices the key can reach
//   node scripts/rumi-eleven.mjs --shared es         search the public library by language
//   node scripts/rumi-eleven.mjs --balance           credits used and remaining
//   node scripts/rumi-eleven.mjs                     render the 280 Spanish strings
//   node scripts/rumi-eleven.mjs --cues              render the 171 English cues
//   node scripts/rumi-eleven.mjs --map               write the json maps from what exists
//   node scripts/rumi-eleven.mjs --limit 5           sample run, for listening before committing
//
// The key is read from the environment, never from the command line:
//   node --env-file=.env.local scripts/rumi-eleven.mjs

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { collect } from './rumi-strings.mjs';
import { collectEnglish } from './rumi-cues.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.elevenlabs.io';

// --- the settings that decide what it sounds like --------------------------------------
//
// Whit picks the two voice ids off the bake-off page; until he has, these are unset and
// the script refuses to render rather than shipping a voice nobody chose.
export const ES_VOICE = process.env.RUMI_ES_VOICE || '';
export const EN_VOICE = process.env.RUMI_EN_VOICE || '';

// eleven_multilingual_v2 is the stable, best-quality multilingual model and it honours
// voice_settings.speed. eleven_v3 is more expressive and takes inline direction but its
// settings surface differs; switch with RUMI_11_MODEL once a bake-off has been heard.
export const MODEL = process.env.RUMI_11_MODEL || 'eleven_multilingual_v2';

// 22.05kHz / 32kbps. LOWER than the edge-tts clips this replaces (48kbps), which is
// deliberate: it buys back roughly 2MB of the 10MB budget, and that headroom is what the
// 41 unrecorded stroke cues and the timing data are going to spend.
export const OUTPUT_FORMAT = 'mp3_22050_32';

// ElevenLabs' speed floor is 0.7 and edge-tts was running at -35%, i.e. about 0.65. So the
// slowest single read available here is slightly faster than what ships today. That is not
// a regression to paper over: the answer is per-word playback driven by the timing data
// below, which is slower than 0.65 ever was and keeps the pitch. Card rate stays 0.7.
export const SPEED = Number(process.env.RUMI_11_SPEED || 0.7);

// Per-character start/end times, saved beside each clip. This is the payload that lets
// turtle mode and word highlighting use the real recording instead of a device voice.
const WITH_TIMESTAMPS = !process.env.RUMI_11_NO_TIMESTAMPS;

const BANKS = {
  es: {
    label: 'spanish',
    dir: path.join(ROOT, 'build', 'rumi-clips-11'),
    map: path.join(ROOT, 'build', 'rumi-clips.json'),
    times: path.join(ROOT, 'build', 'rumi-times.json'),
    voice: () => ES_VOICE,
    lang: 'es',
    items: (html) => collect(html),
  },
  en: {
    label: 'english',
    dir: path.join(ROOT, 'build', 'rumi-cues-11'),
    map: path.join(ROOT, 'build', 'rumi-cues.json'),
    times: path.join(ROOT, 'build', 'rumi-cue-times.json'),
    voice: () => EN_VOICE,
    lang: 'en',
    items: (html) => collectEnglish(html),
  },
};

/** Content-addressed, for the reason rumi-audio.mjs is: a filename that depends on the
 *  item's position makes every cached clip wrong the moment the corpus order changes.
 *  The stamp covers voice, model, speed and format as well as the text, so changing any
 *  one of them invalidates the cache instead of silently reusing the previous voice —
 *  the failure that was caught in August while switching Elvira to Ximena. */
export function clipFile(key, voice) {
  const stamp = `${voice}|${MODEL}|${SPEED}|${OUTPUT_FORMAT}|${key}`;
  return `${createHash('sha256').update(stamp).digest('hex').slice(0, 16)}.mp3`;
}

function apiKey() {
  const k = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_API_KEY;
  if (!k) {
    throw new Error(
      'no ELEVENLABS_API_KEY in the environment. Put it in rumi/.env.local (gitignored) '
      + 'and run: node --env-file=.env.local scripts/rumi-eleven.mjs',
    );
  }
  return k;
}

async function api(route, init = {}) {
  const res = await fetch(`${API}${route}`, {
    ...init,
    headers: { 'xi-api-key': apiKey(), ...(init.headers || {}) },
  });
  if (!res.ok) {
    // Surface ElevenLabs' own message. Guessing at what a 422 means here has cost more
    // time than reading one has.
    const body = await res.text().catch(() => '');
    throw new Error(`${init.method || 'GET'} ${route} -> ${res.status} ${body.slice(0, 400)}`);
  }
  return res;
}

/** One clip. Returns { bytes, alignment } — alignment is null when timestamps are off. */
async function synth(text, voice, lang, dest) {
  const route = WITH_TIMESTAMPS
    ? `/v1/text-to-speech/${voice}/with-timestamps?output_format=${OUTPUT_FORMAT}`
    : `/v1/text-to-speech/${voice}?output_format=${OUTPUT_FORMAT}`;
  const res = await api(route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      language_code: lang,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        // A teaching voice must say the same word the same way every time. Style adds
        // per-render variation, which is exactly the thing to avoid: she is repeating
        // these, and a phrase that lands differently on each hearing teaches nothing.
        style: 0,
        use_speaker_boost: true,
        speed: SPEED,
      },
    }),
  });

  let audio;
  let alignment = null;
  if (WITH_TIMESTAMPS) {
    const json = await res.json();
    audio = Buffer.from(json.audio_base64, 'base64');
    alignment = json.normalized_alignment || json.alignment || null;
  } else {
    audio = Buffer.from(await res.arrayBuffer());
  }

  if (audio.length < 512) throw new Error(`clip too small (${audio.length} bytes) for: ${text}`);
  fs.writeFileSync(dest, audio);
  return { bytes: audio.length, alignment };
}

function writeMaps(bank, items) {
  const clips = {};
  const times = {};
  let bytes = 0;
  const voice = bank.voice();
  for (const it of items) {
    const f = path.join(bank.dir, clipFile(it.key, voice));
    if (!fs.existsSync(f)) continue;
    const buf = fs.readFileSync(f);
    bytes += buf.length;
    clips[it.key] = buf.toString('base64');
    const t = `${f}.json`;
    if (fs.existsSync(t)) times[it.key] = JSON.parse(fs.readFileSync(t, 'utf8'));
  }
  fs.writeFileSync(bank.map, JSON.stringify(clips));
  if (Object.keys(times).length) fs.writeFileSync(bank.times, JSON.stringify(times));
  return { count: Object.keys(clips).length, bytes, timed: Object.keys(times).length };
}

function estimate(html) {
  const rows = [];
  let total = 0;
  for (const b of Object.values(BANKS)) {
    const items = b.items(html);
    const chars = items.reduce((n, it) => n + it.text.length, 0);
    total += chars;
    rows.push({ bank: b.label, strings: items.length, chars });
  }
  return { rows, total };
}

async function renderBank(bank, items, limit) {
  const voice = bank.voice();
  if (!voice) {
    throw new Error(
      `no ${bank.label} voice id set. Pick one on the bake-off page, then set `
      + `${bank === BANKS.es ? 'RUMI_ES_VOICE' : 'RUMI_EN_VOICE'} in .env.local. `
      + 'This script will not choose a voice on its own.',
    );
  }
  fs.mkdirSync(bank.dir, { recursive: true });
  const todo = items.slice(0, limit);
  let made = 0;
  let reused = 0;
  let bytes = 0;
  let chars = 0;

  for (const it of todo) {
    const dest = path.join(bank.dir, clipFile(it.key, voice));
    if (fs.existsSync(dest) && fs.statSync(dest).size >= 512) {
      reused += 1;
      bytes += fs.statSync(dest).size;
      continue;
    }
    // Serial, like the edge path, and for the same reason: the endpoint rate-limits and
    // losing the run two hundred clips in costs more than the minutes saved.
    const r = await synth(it.text, voice, bank.lang, dest);
    if (r.alignment) fs.writeFileSync(`${dest}.json`, JSON.stringify(r.alignment));
    bytes += r.bytes;
    chars += it.text.length;
    made += 1;
    if (made % 25 === 0) console.log(`  ${made} rendered (${(bytes / 1e6).toFixed(2)} MB)`);
  }

  console.log(
    `${bank.label}: rendered ${made}, reused ${reused}, of ${todo.length}. `
    + `${(bytes / 1e6).toFixed(2)} MB raw, ${((bytes * 4) / 3 / 1e6).toFixed(2)} MB embedded, `
    + `${chars} credits spent this run.`,
  );
  return { made, reused, bytes, chars };
}

async function main() {
  const args = process.argv.slice(2);
  const html = fs.readFileSync(path.join(ROOT, 'rumi-espanol-app.html'), 'utf8');
  const bank = args.includes('--cues') ? BANKS.en : BANKS.es;
  const limitArg = args.indexOf('--limit');
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;

  if (args.includes('--estimate')) {
    const { rows, total } = estimate(html);
    const appBytes = Buffer.byteLength(html, 'utf8');
    for (const r of rows) console.log(`${r.bank.padEnd(8)} ${String(r.strings).padStart(4)} strings  ${String(r.chars).padStart(6)} characters`);
    console.log(`\na full re-voice costs ${total} credits (1 credit = 1 character on ${MODEL}).`);
    console.log(`flash / turbo models halve that, to ${Math.ceil(total / 2)}.`);
    console.log(`\napp today: ${appBytes.toLocaleString()} bytes. embed gate: 10,485,760. headroom: ${(10485760 - appBytes).toLocaleString()}.`);
    console.log(`output format pinned to ${OUTPUT_FORMAT}; ElevenLabs' default would be about 4x that size.`);
    return;
  }

  if (args.includes('--balance')) {
    const res = await api('/v1/user/subscription');
    const s = await res.json();
    const used = s.character_count;
    const cap = s.character_limit;
    console.log(`tier: ${s.tier}`);
    console.log(`credits used this period: ${used?.toLocaleString()} of ${cap?.toLocaleString()}`);
    console.log(`remaining: ${(cap - used)?.toLocaleString()}`);
    // A free key can speak only with voices saved in its own library — public-library voices
    // answer 402 "paid_plan_required" — so the number of saved-voice slots is a real limit.
    console.log(`saved voice slots: ${s.voice_slots_used ?? '?'} of ${s.voice_limit ?? '?'}`);
    const { total } = estimate(html);
    console.log(`a full Rumi re-voice is ${total} of those, i.e. ${((total / (cap - used)) * 100).toFixed(3)}% of what is left.`);
    return;
  }

  if (args.includes('--voices')) {
    const res = await api('/v1/voices');
    const { voices } = await res.json();
    for (const v of voices) {
      const langs = v.labels?.language || v.fine_tuning?.language || '';
      console.log(`${v.voice_id}  ${String(v.name).padEnd(24)} ${langs} ${v.labels?.description || ''}`);
    }
    console.log(`\n${voices.length} voices reachable by this key.`);
    return;
  }

  // The key's own library is whatever the account has saved — on a fresh free account that is
  // Eleven's 21 default English voices and not one Spanish one. Every Spanish voice worth
  // hearing lives in the PUBLIC library, which is a different endpoint. This lists it so the
  // bake-off page can be built from real candidates rather than from names in a brief.
  if (args.includes('--shared')) {
    const i = args.indexOf('--shared');
    const lang = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'es';
    const res = await api(`/v1/shared-voices?page_size=100&language=${encodeURIComponent(lang)}`);
    const { voices } = await res.json();
    for (const v of voices) {
      const acc = v.accent || v.locale || '';
      console.log(
        `${v.voice_id}  ${String(v.name).slice(0, 38).padEnd(38)} ${String(acc).padEnd(16)} `
        + `${String(v.age || '').padEnd(11)} ${String(v.gender || '').padEnd(7)} `
        + `${String(v.use_case || '').padEnd(16)} ${String(v.free_users_allowed)}`,
      );
    }
    console.log(`\n${voices.length} public ${lang} voices. Last column: usable on a free key.`);
    return;
  }

  if (args.includes('--map')) {
    const r = writeMaps(bank, bank.items(html));
    console.log(`${bank.label} map: ${r.count} clips, ${(r.bytes / 1e6).toFixed(2)} MB raw, ${r.timed} with timing -> ${bank.map}`);
    return;
  }

  await renderBank(bank, bank.items(html), limit);
  console.log(`\nnext: node scripts/rumi-eleven.mjs ${args.includes('--cues') ? '--cues ' : ''}--map`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
}
