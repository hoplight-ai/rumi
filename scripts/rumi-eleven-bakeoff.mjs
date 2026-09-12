#!/usr/bin/env node
// rumi-eleven-bakeoff.mjs — build the ElevenLabs listening page Whit picks a voice on.
//
// WHY A SECOND BAKE-OFF SCRIPT, AND NOT AN EDIT TO rumi-bakeoff.mjs.
// The edge-tts one shells out to a binary with two knobs, a voice name and a rate, and its
// whole hypothesis was "is -35% too slow". This one calls a paid HTTP service on a metered
// budget, has to name which candidates a free key may actually use, and has to say out loud
// which accent each voice is. Sharing a file would have meant one script where half the
// options are inert depending on a flag. Both write the same page; the edge one is kept so a
// no-credential machine can still rebuild something.
//
// THE BUDGET. The account is a free tier with 10,000 credits, one credit per character. Five
// phrases is 73 characters; ten voices is 730. A full production re-voice is 6,108, so this
// page must leave at least that much behind. --dry prints the bill without spending it.
//
// WHY THESE TEN VOICES, MEASURED 2026-09-13 ON THE REAL KEY.
// - The public library has about a hundred Spanish voices, Spain and Latin American both, and a
//   free key can use NONE of them through the API: every one answers 402 "Free users cannot use
//   library voices via the API", whatever its free_users_allowed flag says. That flag is about
//   the website, not the API. (`node scripts/rumi-eleven.mjs --shared es` still lists them, for
//   the day the plan changes.)
// - The key's own library is Eleven's 21 ready-made voices, all English speakers.
// - A free key has 3 saved-voice slots, and a DESIGNED voice — built from a written description —
//   lives in one. That is the only way this key gets a native Spanish accent at all.
// - ...and a free key cannot design one either: 403 "Creating a voice through the API is only
//   available on a paid plan", measured the same day.
// So the script carries THREE candidate lists and renders whatever the key in hand can reach,
// skipping a refused voice at no cost: designed voices (--design, two Spain and one Latin
// American), library voices (five Spain, three Latin American), and Eleven's seven ready-made
// women reading Spanish, labelled as English speakers so nobody mistakes them for native. On
// the free key only the last list renders. With a paid key, one re-run fills in the rest.
// All women on purpose: Rumi's Spanish has been one woman since August and the English cue is a
// second, so a man would change the character as well as the voice. Spain before Latin America
// because Rumi speaks Spain Spanish today and the brief's default is to stay there.
//
// usage:
//   node scripts/rumi-eleven-bakeoff.mjs --dry                 the bill, no network
//   node --env-file=.env.local scripts/rumi-eleven-bakeoff.mjs --design castilian-warm
//   node --env-file=.env.local scripts/rumi-eleven-bakeoff.mjs --limit-voices 1 --limit-phrases 1
//   node --env-file=.env.local scripts/rumi-eleven-bakeoff.mjs
//   node scripts/rumi-eleven-bakeoff.mjs --page                rebuild the page from cache only

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MODEL, OUTPUT_FORMAT, SPEED } from './rumi-eleven.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.elevenlabs.io';
const OUT_DIR = path.join(ROOT, 'build', 'bakeoff-11');
const PAGE = path.join(ROOT, 'rumi-voice-bakeoff.html');
const ANCHOR = path.join(ROOT, 'bakeoff-anchor.json');
const SITE = 'https://rumi-rouge.vercel.app';

// The written descriptions the three designed voices are built from. A design call returns
// three different takes on a description; the one saved is the SLOWEST take (longest preview
// for the same text), because the listener is five and meeting most of these words for the first
// time. That is a rule, not an ear — Whit's ear decides between the voices that come out of it.
export const DESIGNS = [
  {
    slug: 'castilian-warm', name: 'Lucía', region: 'Spain', place: 'Spain · designed',
    note: 'made for Rumi: warm Madrid teacher',
    description: 'A warm, gentle young woman from Madrid speaking clear Castilian Spanish from Spain, with the '
      + 'soft "th" sound for c and z. A kind preschool teacher talking slowly and patiently to a five-year-old. '
      + 'Calm, bright, smiling, never theatrical. Clean studio recording.',
  },
  {
    slug: 'castilian-bright', name: 'Carmen', region: 'Spain', place: 'Spain · designed',
    note: 'made for Rumi: brighter, livelier',
    description: 'A cheerful, bright woman in her thirties from central Spain speaking crisp Castilian Spanish '
      + 'with the Spanish "th" for c and z. She reads picture books aloud to small children: every word '
      + 'distinct, a little slow, friendly and encouraging. Clean studio recording.',
  },
  {
    slug: 'latam-warm', name: 'Paloma', region: 'Latin America', place: 'Latin America · designed',
    note: 'made for Rumi: warm, neutral Latin American',
    description: 'A warm, gentle young woman speaking clear neutral Latin American Spanish, the way a bilingual '
      + 'children\'s television host speaks. A kind teacher talking slowly and patiently to a five-year-old. '
      + 'Calm, bright, never theatrical. Clean studio recording.',
  },
];

// The design call reads this aloud, so the three takes are heard saying real Rumi strings.
// 100 characters is the service's minimum.
const DESIGN_TEXT = 'Gracias. ¿Quieres jugar conmigo? zeta. Z de zapato. cinco. '
  + 'Baja una línea grande. Baja hacia la izquierda, pasa la raya.';

// Where a designed voice's id is recorded once it exists. Committed, because the id is the
// thing phase B renders with, and a designed voice cannot be re-made identically.
const DESIGNED_FILE = path.join(ROOT, 'scripts', 'rumi-bakeoff-voices.json');
const readDesigned = () => (fs.existsSync(DESIGNED_FILE) ? JSON.parse(fs.readFileSync(DESIGNED_FILE, 'utf8')) : {});

// Eleven's ready-made women. English speakers; the multilingual model makes them read Spanish,
// with whatever accent that leaves. On the page for contrast, and labelled as exactly that.
const STOCK = [
  { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice',   note: 'clear, teacherly' },
  { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', note: 'even, professional' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah',   note: 'mature, reassuring' },
  { id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', note: 'playful, bright' },
  { id: 'hpp4J3VqNfWAUOO0d1Us', name: 'Bella',   note: 'bright, warm' },
  { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura',   note: 'enthusiastic, quirky' },
  { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily',    note: 'velvety, low' },
].map((v) => ({ ...v, region: 'Stock', place: 'English speaker', kind: 'stock' }));

// Public-library Spanish women, picked 2026-09-13 from `rumi-eleven.mjs --shared es`. A free key
// gets 402 on every one of these and the render loop skips them at no cost; the moment a paid
// key is in .env.local, re-running this script renders them and they appear on the page.
const LIBRARY = [
  { id: '8gK5gnQBZnJWm1ta8R8X', name: 'Alma',        region: 'Spain', place: 'Spain', note: 'soft, warm, unhurried' },
  { id: 'eZxqQzb5CuYo3Kl6EXfZ', name: 'Sofía',       region: 'Spain', place: 'Spain', note: 'everyday, conversational' },
  { id: 'nH81SxhcPaX89XdDlp2m', name: 'Cristina',    region: 'Spain', place: 'Spain', note: 'casual, close to the microphone' },
  { id: 'SzSUM9aqTucCylaROOmf', name: 'Valeria',     region: 'Spain', place: 'Spain', note: 'clear and relaxed' },
  { id: 'pN4aFdNIp2mvGfTwy1Oj', name: 'Sofía N.',    region: 'Spain', place: 'Spain', note: 'storytelling, more shaped' },
  { id: 'NUEuVCKSYxEA5YrK3kmx', name: 'Daniela',     region: 'Latin America', place: 'Latin America', note: 'bright, warm, forward' },
  { id: 'Tc7dePDnjW90vlgpLnhZ', name: 'Graciela',    region: 'Latin America', place: 'Latin America', note: 'older, calm, grandmotherly' },
  { id: 'xINMaIuUfU4JP13Ky4WH', name: 'Nancy',       region: 'Latin America', place: 'Mexico', note: 'young, plain, unfussy' },
].map((v) => ({ ...v, kind: 'library' }));

// Every candidate this script knows about, in page order: Spain, Latin America, then the
// ready-made English speakers. Only voices with all five clips on disk reach the page.
export function voices() {
  const made = readDesigned();
  const designed = DESIGNS.filter((d) => made[d.slug]).map((d) => ({
    id: made[d.slug].voice_id, name: d.name, region: d.region, place: d.place, note: d.note, kind: 'designed',
  }));
  return [...designed, ...LIBRARY, ...STOCK];
}

// Five real strings out of Rumi's own 280, one per kind of card, chosen so the Spain and Latin
// American readings are audibly different: "Gracias", "zeta. Z de zapato" and "cinco" all turn
// on the c/z sound, which is the single clearest split between the two accents.
export const PHRASES = [
  { key: 'word',   kind: 'a single word',        text: 'Gracias' },
  { key: 'phrase', kind: 'a phrase card',        text: '¿Quieres jugar conmigo?' },
  { key: 'letter', kind: 'a letter card',        text: 'zeta. Z de zapato' },
  { key: 'number', kind: 'a number card',        text: 'cinco' },
  { key: 'stroke', kind: 'a drawing instruction', text: 'Baja una línea grande' },
];

const clipFile = (voiceId, text) =>
  `${createHash('sha256').update(`${voiceId}|${MODEL}|${SPEED}|${OUTPUT_FORMAT}|${text}`).digest('hex').slice(0, 16)}.mp3`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function apiKey() {
  const k = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_API_KEY;
  if (!k) throw new Error('no ELEVENLABS_API_KEY in the environment. Run with --env-file=.env.local');
  return k;
}

async function synth(text, voiceId, dest) {
  // The timed endpoint, same price: the per-character times saved beside each clip are the
  // real-service fixture the app's word-by-word slow speed is proved against.
  const res = await fetch(`${API}/v1/text-to-speech/${voiceId}/with-timestamps?output_format=${OUTPUT_FORMAT}`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey(), 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      language_code: 'es',
      // Same settings the real render will use, so what he hears is what she gets. style 0 in
      // particular: a teaching voice must say the same word the same way every time.
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: SPEED },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${voiceId} -> ${res.status} ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  const audio = Buffer.from(json.audio_base64, 'base64');
  if (audio.length < 512) throw new Error(`clip too small (${audio.length} bytes) for: ${text}`);
  fs.writeFileSync(dest, audio);
  const alignment = json.normalized_alignment || json.alignment;
  if (alignment) fs.writeFileSync(`${dest}.json`, JSON.stringify(alignment));
  return audio.length;
}

function buildPage(clips, stamp, anchor, list) {
  const count = (r) => list.filter((v) => v.region === r).length;
  const plural = (n) => `${n} voice${n === 1 ? '' : 's'}`;
  const groups = [
    { title: 'Spain', blurb: `The accent Rumi speaks today. ${plural(count('Spain'))}.`, rows: list.filter((v) => v.region === 'Spain') },
    { title: 'Latin America', blurb: `A different accent, so your ear can decide. ${plural(count('Latin America'))}.`, rows: list.filter((v) => v.region === 'Latin America') },
    { title: 'Ready-made voices', blurb: `English speakers reading Spanish. ${plural(count('Stock'))}; listen for an English accent.`, rows: list.filter((v) => v.region === 'Stock') },
  ].filter((g) => g.rows.length);

  const badge = { Spain: 'es', 'Latin America': 'la', Stock: 'st' };
  const row = (v) => `
      <section class="voice" data-voice="${esc(v.id)}">
        <div class="vhead">
          <h3>${esc(v.name)}</h3>
          <span class="badge ${badge[v.region]}">${esc(v.place)}</span>
          <span class="vnote">${esc(v.note)}</span>
        </div>
        <button class="all" data-voice="${esc(v.id)}">▶︎ Play all five</button>
        <div class="phrases">
          ${PHRASES.map((p) => `<button class="ph" data-k="${esc(`${v.id}|${p.key}`)}"><span class="kind">${esc(p.kind)}</span><span class="txt">${esc(p.text)}</span></button>`).join('\n          ')}
        </div>
      </section>`;

  const body = groups.map((g) => `
    <h2 class="group">${esc(g.title)}<small>${esc(g.blurb)}</small></h2>
${g.rows.map(row).join('\n')}`).join('\n');

  const native = list.some((v) => v.region !== 'Stock');
  const desc = `${list.length} voices for Rumi, each saying the same five things she hears in the app. Tap a row, listen, and pick one.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Rumi — which voice?</title>
<!-- App metadata. This page is served at ${SITE}/rumi-voice-bakeoff and Whit holds that URL, so
     it gets the same four things every page here gets: a name, preview text, a preview image and
     a home-screen icon. It shipped once with a <title> and nothing else, which pastes into a text
     as a bare grey URL and saves to a phone as a blank square.

     og:image is ABSOLUTE. A relative path renders as a blank card in iMessage and reports no
     error in the console, the network tab or the Vercel log.

     It reuses Rumi's own card and icons on purpose: this is a screen inside Rumi, not a second
     product. It does NOT reuse Rumi's manifest — that one starts at "/", so installing this page
     from a home screen would have opened the app instead of the page whose icon was tapped.

     ci-check.mjs asserts this whole block against the committed file. Change it here, not there. -->
<meta name="description" content="${esc(desc)}">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Voices">
<link rel="manifest" href="/bakeoff-manifest.json">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="icon" href="/icon-192.png" sizes="192x192" type="image/png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Rumi">
<meta property="og:url" content="${SITE}/rumi-voice-bakeoff">
<meta property="og:title" content="Rumi — which voice?">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${SITE}/rumi-og-card.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Rumi — which voice?">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${SITE}/rumi-og-card.png">
<style>
  :root{--ink:#1b1233;--paper:#f7f4fb;--card:#fff;--purple:#6c2bd9;--mag:#e0409a;
    --line:#e7e0f5;--dim:#6b6183}
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    background:var(--paper);color:var(--ink);padding:22px 14px 80px;line-height:1.5;
    -webkit-text-size-adjust:100%}
  .wrap{max-width:640px;margin:0 auto}
  h1{font-size:27px;margin:0 0 8px;letter-spacing:-.01em}
  .lede{font-size:16px;margin:0 0 18px;color:var(--dim)}
  .ask{background:#fff8e6;border:2px solid #f0c65a;border-radius:16px;padding:15px 16px;
    margin:0 0 26px;font-size:16px}
  .ask p{margin:0 0 10px}
  .ask p:last-child{margin:0}
  .today{background:var(--card);border:2px dashed var(--line);border-radius:18px;
    padding:14px 16px;margin:0 0 30px}
  .today h3{margin:0 0 4px;font-size:16px}
  .today p{margin:0 0 12px;font-size:14px;color:var(--dim)}
  h2.group{font-size:13px;text-transform:uppercase;letter-spacing:.09em;color:var(--dim);
    margin:32px 0 12px;display:flex;flex-direction:column;gap:3px}
  h2.group small{font-size:13px;text-transform:none;letter-spacing:0;opacity:.85;font-weight:400}
  .voice{background:var(--card);border-radius:20px;padding:15px 15px 16px;margin-bottom:14px;
    box-shadow:0 3px 14px rgba(27,18,51,.08)}
  .vhead{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:11px}
  .vhead h3{font-size:19px;margin:0}
  .badge{font-size:12px;font-weight:700;border-radius:999px;padding:3px 10px;white-space:nowrap}
  .badge.es{background:#efe6ff;color:#5320a8}
  .badge.la{background:#e2f4ec;color:#15694a}
  .badge.st{background:#eeeef1;color:#4d4a57}
  .vnote{font-size:13px;color:var(--dim);flex-basis:100%}
  .all,.ph,.anchor{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
  .all,.anchor{width:100%;min-height:52px;border:0;border-radius:14px;background:var(--purple);
    color:#fff;font-size:17px;font-weight:700;margin-bottom:10px}
  .anchor{background:#4a4160}
  .all:active,.anchor:active,.ph:active{transform:scale(.985)}
  .all.playing,.anchor.playing{background:var(--mag)}
  .phrases{display:flex;flex-direction:column;gap:8px}
  .ph{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;
    min-height:54px;border:2px solid var(--line);background:#fff;border-radius:14px;padding:8px 14px}
  .ph .kind{font-size:12px;color:var(--dim)}
  .ph .txt{font-size:17px;font-weight:600}
  .ph.playing{border-color:var(--mag);background:#fff0f7}
  .foot{margin-top:34px;font-size:13px;color:var(--dim)}
  @media (prefers-color-scheme:dark){
    :root{--ink:#f3effa;--paper:#151020;--card:#221a36;--line:#3a2f55;--dim:#a79dc0}
    .ask{background:#3a2f13;border-color:#7a6425}
    .ph{background:var(--card)}
    .ph.playing{background:#3a1f33}
    .badge.es{background:#3b2a63;color:#d9c7ff}
    .badge.la{background:#1d4438;color:#b7e8d3}
    .badge.st{background:#34313d;color:#d6d3de}
  }
</style>
</head>
<body><div class="wrap">
<h1>Rumi — which voice?</h1>
<p class="lede">${list.length} voices. Each one says the same five things Rumi says to her.</p>

<div class="ask">
  <p><strong>Tap “Play all five” on a row and just listen.</strong> Headphones help. Sound on.</p>
  <p><strong>Reply with one name.</strong> That is the whole job. Everything gets recorded in the
  voice you name, and nothing gets recorded until you do.</p>
  ${native
    ? '<p>Spain first, which is the accent she has been hearing, then Latin America. The ready-made voices at the bottom are English speakers, there for contrast.</p>'
    : '<p><strong>Every voice here is an English speaker reading Spanish.</strong> The ElevenLabs key Rumi has is on the free plan, and the free plan cannot use any of ElevenLabs’ Spanish voices or make a new one. If none of these beats what she hears today, the answer is “none”, and native Spanish voices from Spain and Latin America land on this same page once the key is from a paid plan.</p>'}
</div>

<div class="today">
  <h3>What she hears today</h3>
  <p>The voice that is live right now, saying the first phrase. Use it as your floor: anything
  below is not worth changing to.</p>
  <button class="anchor" data-k="__anchor__">▶︎ “Gracias” — the voice live today</button>
</div>
${body}

<p class="foot">Build ${esc(stamp)}. Every clip is stored inside this page, so it keeps working
with no signal.</p>
</div>
<script id="bakeClips">window.BAKE = ${JSON.stringify(clips)};
window.BAKE["__anchor__"] = ${JSON.stringify(anchor)};
window.ORDER = ${JSON.stringify(Object.fromEntries(list.map((v) => [v.id, PHRASES.map((p) => `${v.id}|${p.key}`)])))};</script>
<script>
"use strict";
// One AudioContext, resumed on every tap. Same lesson as the app: iOS suspends a context when
// the page is backgrounded and a dead context plays nothing, throws nothing, and fires no
// onended, so "resume on the gesture that is already happening" is the only reliable shape.
let ctx = null, src = null, cur = null, queue = [], qBtn = null;
const cache = new Map();
function ensure(){
  if(!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if(ctx.state !== "running") return ctx.resume().then(() => ctx);
  return Promise.resolve(ctx);
}
function buf(k){
  if(cache.has(k)) return cache.get(k);
  const p = new Promise((res, rej) => {
    const b64 = window.BAKE[k];
    if(!b64) return rej(new Error("no clip " + k));
    const bin = atob(b64);
    const a = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) a[i] = bin.charCodeAt(i);
    ctx.decodeAudioData(a.buffer, res, rej);
  });
  cache.set(k, p);
  return p;
}
function stop(){
  if(src){ try{ src.onended = null; src.stop(); }catch(e){} src = null; }
  queue = [];
  if(cur) cur.classList.remove("playing");
  if(qBtn) qBtn.classList.remove("playing");
  cur = null; qBtn = null;
}
function markFor(k){
  return document.querySelector('[data-k="' + k.replace(/"/g, '\\\\"') + '"]');
}
function playKey(k, then){
  return ensure().then(() => buf(k)).then(d => {
    const s = ctx.createBufferSource();
    s.buffer = d; s.connect(ctx.destination);
    const btn = markFor(k);
    if(btn) btn.classList.add("playing");
    if(cur && cur !== btn) cur.classList.remove("playing");
    cur = btn;
    s.onended = () => {
      if(btn) btn.classList.remove("playing");
      if(src === s){ src = null; if(then) then(); }
    };
    src = s; s.start(0);
  }).catch(() => { if(cur) cur.classList.remove("playing"); if(then) then(); });
}
function drain(){
  if(!queue.length){ if(qBtn) qBtn.classList.remove("playing"); qBtn = null; return; }
  const k = queue.shift();
  // A real gap between clips. She gets one in the app too; without it five phrases run
  // together and there is nothing to judge.
  playKey(k, () => setTimeout(drain, 500));
}
document.querySelectorAll(".ph, .anchor").forEach(b => {
  b.onclick = () => { const k = b.dataset.k; stop(); playKey(k); };
});
document.querySelectorAll(".all").forEach(b => {
  b.onclick = () => {
    const was = b.classList.contains("playing");
    stop();
    if(was) return;
    b.classList.add("playing");
    qBtn = b;
    queue = (window.ORDER[b.dataset.voice] || []).slice();
    drain();
  };
});
</script>
</body>
</html>
`;
}

function readCache(list) {
  const clips = {};
  let bytes = 0;
  let missing = 0;
  for (const v of list) {
    for (const p of PHRASES) {
      const f = path.join(OUT_DIR, clipFile(v.id, p.text));
      if (!fs.existsSync(f)) { missing += 1; continue; }
      const b = fs.readFileSync(f);
      bytes += b.length;
      clips[`${v.id}|${p.key}`] = b.toString('base64');
    }
  }
  return { clips, bytes, missing };
}

function writePage() {
  // Only a voice with all five clips earns a row: half a row cannot be compared.
  const complete = (v) => PHRASES.every((p) => fs.existsSync(path.join(OUT_DIR, clipFile(v.id, p.text))));
  const list = voices().filter(complete);
  const { clips, bytes, missing } = readCache(list);
  const anchor = JSON.parse(fs.readFileSync(ANCHOR, 'utf8')).mp3_base64;
  // The stamp doubles as the deploy proof: a string that exists only in this build.
  const when = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
  const stamp = `rumivoice1-${when}Z · ${list.length} voices · ${Object.keys(clips).length} clips`;
  fs.writeFileSync(PAGE, buildPage(clips, stamp, anchor, list));
  const size = fs.statSync(PAGE).size;
  console.log(`clips ${Object.keys(clips).length} of ${list.length * PHRASES.length}${missing ? ` (${missing} missing)` : ''} · raw ${(bytes / 1e6).toFixed(2)} MB`);
  console.log(`page ${size.toLocaleString()} bytes -> ${PAGE}`);
  console.log(`build stamp: ${stamp}`);
  return { size, missing };
}

/** Design one voice, save the slowest of its takes into a library slot, and record the id.
 *  Refuses to run twice for one slug: a second run would spend credits AND a slot. */
async function design(slug) {
  const d = DESIGNS.find((x) => x.slug === slug);
  if (!d) throw new Error(`unknown design "${slug}". Known: ${DESIGNS.map((x) => x.slug).join(', ')}`);
  const made = readDesigned();
  if (made[slug]) { console.log(`${slug} already exists as ${made[slug].voice_id}; not re-designing.`); return; }
  if (DESIGN_TEXT.length < 100) throw new Error(`design text is ${DESIGN_TEXT.length} chars; the service needs 100`);

  const res = await fetch(`${API}/v1/text-to-voice/design?output_format=${OUTPUT_FORMAT}`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey(), 'content-type': 'application/json' },
    body: JSON.stringify({ voice_description: d.description, text: DESIGN_TEXT, model_id: 'eleven_multilingual_ttv_v2' }),
  });
  if (!res.ok) throw new Error(`design ${slug} -> ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
  const { previews } = await res.json();
  if (!previews?.length) throw new Error(`design ${slug} returned no previews`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  previews.forEach((p, i) => fs.writeFileSync(path.join(OUT_DIR, `design-${slug}-${i}.mp3`), Buffer.from(p.audio_base_64, 'base64')));
  const takes = previews.map((p, i) => `take ${i}: ${Number(p.duration_secs).toFixed(2)}s`).join(', ');
  const pick = previews.reduce((a, b) => (Number(b.duration_secs) > Number(a.duration_secs) ? b : a));

  const save = await fetch(`${API}/v1/text-to-voice`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey(), 'content-type': 'application/json' },
    body: JSON.stringify({ voice_name: `Rumi ${d.name}`, voice_description: d.description, generated_voice_id: pick.generated_voice_id }),
  });
  if (!save.ok) throw new Error(`save ${slug} -> ${save.status} ${(await save.text().catch(() => '')).slice(0, 300)}`);
  const saved = await save.json();

  made[slug] = {
    voice_id: saved.voice_id, name: d.name, region: d.region,
    chosen_take: previews.indexOf(pick), takes, rule: 'slowest take (longest preview duration)',
    designed: new Date().toISOString().slice(0, 10), model: 'eleven_multilingual_ttv_v2',
  };
  fs.writeFileSync(DESIGNED_FILE, `${JSON.stringify(made, null, 2)}\n`);
  console.log(`${slug}: ${takes}. saved take ${previews.indexOf(pick)} as ${saved.voice_id}`);
}

async function main() {
  const args = process.argv.slice(2);
  const num = (flag, dflt) => {
    const i = args.indexOf(flag);
    return i >= 0 ? Number(args[i + 1]) : dflt;
  };

  if (args.includes('--design')) { await design(args[args.indexOf('--design') + 1]); return; }
  if (args.includes('--page')) { writePage(); return; }

  const all = voices();
  const list = all.slice(0, num('--limit-voices', all.length));
  const phrases = PHRASES.slice(0, num('--limit-phrases', PHRASES.length));
  const chars = phrases.reduce((n, p) => n + p.text.length, 0);

  if (args.includes('--dry')) {
    for (const p of PHRASES) console.log(`  ${String(p.text.length).padStart(3)} chars  ${p.kind.padEnd(22)} ${p.text}`);
    const per = PHRASES.reduce((n, p) => n + p.text.length, 0);
    console.log(`\n${PHRASES.length} phrases = ${per} characters per voice.`);
    console.log(`${all.length} voices on the list now (${DESIGNS.length} designs possible) = ${all.length * per} credits.`);
    console.log(`this invocation would render at most ${list.length} x ${phrases.length} = ${list.length * chars} credits (cached clips cost nothing).`);
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let made = 0;
  let reused = 0;
  let spent = 0;
  const refused = [];
  for (const v of list) {
    for (const p of phrases) {
      const dest = path.join(OUT_DIR, clipFile(v.id, p.text));
      if (fs.existsSync(dest) && fs.statSync(dest).size >= 512) { reused += 1; continue; }
      // Serial on purpose: the endpoint rate-limits, and on a 10,000-credit account losing a
      // run halfway costs credits that do not come back.
      let n;
      try {
        n = await synth(p.text, v.id, dest);
      } catch (e) {
        // A plan refusal is about the voice, not the run: it costs nothing, so note it and move
        // on to the next voice. Anything else is a real failure and stops the run.
        if (/ -> 40[23] /.test(e.message) && /paid|plan|feature_not_available/.test(e.message)) {
          refused.push(v.name);
          console.log(`  ${v.name.padEnd(12)} refused by the plan (no charge); skipping this voice`);
          break;
        }
        throw e;
      }
      spent += p.text.length;
      made += 1;
      console.log(`  ${v.name.padEnd(12)} ${p.key.padEnd(7)} ${String(n).padStart(6)} bytes  (${spent} credits so far)`);
    }
  }
  console.log(`\nrendered ${made}, reused ${reused}. ${spent} credits spent this run.`);
  if (refused.length) console.log(`refused by the plan: ${refused.join(', ')}`);
  writePage();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
}
