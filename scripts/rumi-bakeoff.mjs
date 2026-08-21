#!/usr/bin/env node
// rumi-bakeoff.mjs — build the voice comparison page Whit listens to.
//
// Whit's words on the shipped audio: "the accent is very poor." He reviews by LISTENING, not
// by reading a table, so this generates one self-contained page with a play button per
// variant and hands him a URL. It does not pick for him.
//
// THE HYPOTHESIS IT IS BUILT TO TEST, and it is the brief's, not mine: the shipped corpus is
// generated at --rate=-20% and played at 1.0. That was a deliberate improvement over
// resampling (which drops pitch ~5 semitones), but a neural voice asked to speak 20% slow
// smears its consonants — and smeared consonants are exactly what "poor accent" sounds like.
// So every voice appears TWICE, at 0% and at -20%, and the pairs sit next to each other.
// If 0% is the fix, the engine never has to change and the answer is two speed sets.
//
// Phrases are chosen to expose Castilian specifically: the c/z interdental in "Gracias",
// the ll in "llamas", the rounded vowels in "Buenas noches".
//
// usage: node scripts/rumi-bakeoff.mjs

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'build', 'bakeoff');
const PAGE = path.join(ROOT, 'rumi-voice-bakeoff.html');

const PHRASES = [
  '¿Cómo te llamas?',
  'Gracias',
  'Lávate las manos',
  'Estoy contenta',
  '¿Has visto Las Guerreras K-pop?',
  'Buenas noches',
];

// edge-tts is the only engine reachable without a credential this workspace does not have.
// 2026-08-21: Whit picked Ximena and asked for 35% slow. Her three rates now lead the page
// so the actual decision — is -35% too slow, or right — is the first thing on screen.
const VARIANTS = [
  { id: 'ximena-35',  voice: 'es-ES-XimenaNeural', rate: '-35%', label: 'Ximena · 35% slow  ← WHAT RUMI SHIPS NOW (walk speed)' },
  { id: 'ximena-20',  voice: 'es-ES-XimenaNeural', rate: '-20%', label: 'Ximena · 20% slow' },
  { id: 'ximena-0',   voice: 'es-ES-XimenaNeural', rate: '+0%',  label: 'Ximena · normal speed' },
  { id: 'elvira-35',  voice: 'es-ES-ElviraNeural', rate: '-35%', label: 'Elvira · 35% slow' },
  { id: 'elvira-20',  voice: 'es-ES-ElviraNeural', rate: '-20%', label: 'Elvira · 20% slow  (the old shipped setting)' },
  { id: 'elvira-0',   voice: 'es-ES-ElviraNeural', rate: '+0%',  label: 'Elvira · normal speed' },
  { id: 'alvaro-35',  voice: 'es-ES-AlvaroNeural', rate: '-35%', label: 'Álvaro · 35% slow' },
  { id: 'alvaro-0',   voice: 'es-ES-AlvaroNeural', rate: '+0%',  label: 'Álvaro · normal speed' },
];

const CANDIDATES = [
  process.env.EDGE_TTS_BIN,
  `${process.env.HOME}/Library/Python/3.9/bin/edge-tts`,
  '/usr/local/bin/edge-tts',
  'edge-tts',
].filter(Boolean);
const edgeBin = () => CANDIDATES.find((c) => c === 'edge-tts' || fs.existsSync(c)) || 'edge-tts';

const fileFor = (vid, phrase) =>
  `${vid}-${createHash('sha256').update(phrase).digest('hex').slice(0, 8)}.mp3`;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const bin = edgeBin();
  const clips = {};
  let made = 0, bytes = 0;

  for (const v of VARIANTS) {
    for (const p of PHRASES) {
      const dest = path.join(OUT_DIR, fileFor(v.id, p));
      if (!fs.existsSync(dest) || fs.statSync(dest).size < 512) {
        await execFileAsync(bin, ['--voice', v.voice, `--rate=${v.rate}`, '--text', p, '--write-media', dest], { timeout: 60_000 });
        made += 1;
      }
      const buf = fs.readFileSync(dest);
      bytes += buf.length;
      clips[`${v.id}|${p}`] = buf.toString('base64');
    }
  }

  const rows = VARIANTS.map((v) => `
    <div class="variant">
      <h2>${esc(v.label)}<small>${esc(v.voice)} · rate ${esc(v.rate)}</small></h2>
      <div class="phrases">
        ${PHRASES.map((p) => `<button class="ph" data-k="${esc(v.id)}|${esc(p)}"><span class="pi">▶︎</span>${esc(p)}</button>`).join('\n        ')}
      </div>
    </div>`).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Rumi — which voice?</title>
<style>
  :root{--ink:#1b1233;--paper:#f7f4fb;--card:#fff;--purple:#6c2bd9;--mag:#e0409a}
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    background:var(--paper);color:var(--ink);padding:20px 16px 60px;line-height:1.5}
  .wrap{max-width:720px;margin:0 auto}
  h1{font-size:26px;margin:0 0 6px}
  .lede{opacity:.7;font-size:15px;margin:0 0 8px}
  .ask{background:#fff8e6;border:2px solid #f0c65a;border-radius:16px;padding:14px 16px;margin:18px 0 26px;font-size:15px}
  .variant{background:var(--card);border-radius:20px;padding:16px;margin-bottom:14px;
    box-shadow:0 3px 14px rgba(27,18,51,.08)}
  h2{font-size:16px;margin:0 0 10px;display:flex;flex-direction:column}
  h2 small{font-weight:600;opacity:.5;font-size:12px;margin-top:2px}
  .phrases{display:flex;flex-wrap:wrap;gap:8px}
  .ph{font:inherit;font-size:14px;font-weight:600;cursor:pointer;border:2px solid #e7e0f5;
    background:#fff;border-radius:999px;padding:9px 14px;display:inline-flex;align-items:center;gap:7px;color:inherit}
  .ph:active{transform:scale(.97)}
  .ph.playing{border-color:var(--mag);background:#fff0f7}
  .pi{color:var(--purple);font-size:12px}
  .foot{margin-top:26px;font-size:13px;opacity:.6}
</style>
</head>
<body><div class="wrap">
<h1>Rumi — which voice?</h1>
<p class="lede">Six phrases, every Castilian voice available, at the speeds that matter. Headphones if you have them.</p>

<div class="ask">
  <strong>Rumi now ships the top row: Ximena at 35% slow.</strong> That is the walk speed, the
  default, and the one she spends nearly all her time in.
  <br><br>
  <strong>The thing to check.</strong> Compare the first three rows — same voice, three speeds. 35%
  is a lot of slow, and asking a neural voice to drag smears its consonants, which is itself a
  common cause of "the accent sounds off". If 35% sounds mushy to you, say 20 or 25 and it is a
  ten-minute regeneration.
  <br><br>
  Rabbit speed plays the same recordings faster, so it sits around 19% slow with a slight lift in
  pitch. Turtle is unchanged and still reads word by word.
</div>

${rows}

<p class="foot">Generated with edge-tts, which is free and needs no account. Engines that need a
credential this workspace does not hold — OpenAI, Google Cloud, ElevenLabs — are absent rather
than guessed at. ElevenLabs is the current quality leader on Spanish and would need an account
you do not have; that is a separate question and a money one.</p>
</div>
<script id="bakeClips">window.BAKE = ${JSON.stringify(clips)};</script>
<script>
"use strict";
let ctx = null, src = null, cur = null;
const cache = new Map();
function buf(k){
  if(cache.has(k)) return cache.get(k);
  const p = new Promise((res, rej) => {
    const bin = atob(window.BAKE[k]);
    const a = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) a[i] = bin.charCodeAt(i);
    ctx.decodeAudioData(a.buffer, res, rej);
  });
  cache.set(k, p);
  return p;
}
document.querySelectorAll(".ph").forEach(b => {
  b.onclick = () => {
    if(!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if(ctx.state === "suspended") ctx.resume();
    if(src){ try{ src.onended = null; src.stop(); }catch(e){} src = null; }
    if(cur) cur.classList.remove("playing");
    cur = b; b.classList.add("playing");
    buf(b.dataset.k).then(d => {
      const s = ctx.createBufferSource();
      s.buffer = d; s.connect(ctx.destination);
      s.onended = () => { b.classList.remove("playing"); if(src === s) src = null; };
      src = s; s.start(0);
    }).catch(() => b.classList.remove("playing"));
  };
});
</script>
</body>
</html>
`;
  fs.writeFileSync(PAGE, html);
  console.log(`variants ${VARIANTS.length} · phrases ${PHRASES.length} · clips ${Object.keys(clips).length}`);
  console.log(`generated ${made} new · raw ${(bytes / 1e6).toFixed(2)} MB`);
  console.log(`page ${(fs.statSync(PAGE).size / 1e6).toFixed(2)} MB -> ${PAGE}`);
}

main().catch((e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
