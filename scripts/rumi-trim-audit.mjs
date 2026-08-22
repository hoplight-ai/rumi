#!/usr/bin/env node
// rumi-trim-audit.mjs — MEASURE the silence padding in both audio banks. Writes nothing.
//
// RUMI L4 W4. Every edge-tts clip carries dead air at both ends — the English clip for
// "red" is ~1.78s of audio for ~0.3s of speech. This script answers "how much of the
// page is silence?" without decoding anything: it walks the mp3 frames (same walk as
// ci-check.mjs) and reads each frame's side info. A Layer III frame whose granule
// part2_3_length is 0 carries no Huffman data at all — digital silence — so a run of
// such frames at either end of a clip is trimmable padding.
//
// WHY THIS IS AUDIT-ONLY. Cutting leading frames breaks the bit reservoir: a kept frame
// whose main_data_begin reaches back into a cut frame decodes as garbage or a click, and
// the user is five and will not report it. Shipping a trim needs (a) reservoir-aware
// cutting (keep every frame the first speech frame's main_data_begin reaches into),
// (b) the ci-check frame-tiling gate still green, and (c) a human listening to a sample.
// This session cannot listen, so it measures and reports instead.
//
// usage: node scripts/rumi-trim-audit.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'rumi-espanol-app.html'), 'utf8');

const BR_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BR_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Walk frames; for each, record byte offset, length, samples, and whether its side info
 * says "no main data" (part2_3_length === 0 for every granule/channel). */
function frames(b) {
  let i = 0;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    i = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f));
  }
  const out = [];
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) break;
    const ver = (b[i + 1] >> 3) & 3;
    const layer = (b[i + 1] >> 1) & 3;
    if (ver === 1 || layer !== 1) break;
    const crc = ((b[i + 1] & 1) === 0) ? 2 : 0;
    const bi = (b[i + 2] >> 4) & 15;
    const si = (b[i + 2] >> 2) & 3;
    const pad = (b[i + 2] >> 1) & 1;
    if (bi === 0 || bi === 15 || si === 3) break;
    const mode = (b[i + 3] >> 6) & 3;           // 3 = mono
    const mono = mode === 3;
    const len = Math.floor((ver === 3 ? 144 : 72) * (ver === 3 ? BR_V1 : BR_V2)[bi] * 1000 / SR[ver][si]) + pad;
    if (len < 4) break;

    // Side info starts after header+crc. Bit offsets of part2_3_length per layout:
    // MPEG1: main_data_begin 9b + private (mono 5b / stereo 3b) + scfsi (mono 4b / stereo 8b),
    //        2 granules; MPEG2/2.5: main_data_begin 8b + private (mono 1b / stereo 2b), 1 granule.
    const sideStart = (i + 4 + crc) * 8;
    const readBits = (bitPos, n) => {
      let v = 0;
      for (let k = 0; k < n; k += 1) {
        const byte = b[(bitPos + k) >> 3];
        v = (v << 1) | ((byte >> (7 - ((bitPos + k) & 7))) & 1);
      }
      return v;
    };
    let silent = true;
    let mdb = 0;
    if (ver === 3) {
      mdb = readBits(sideStart, 9);
      const pre = 9 + (mono ? 5 : 3) + (mono ? 4 : 8);
      const grSize = mono ? 59 : 118;
      for (let g = 0; g < 2 && silent; g += 1) {
        const p23 = readBits(sideStart + pre + g * grSize, 12);
        if (p23 !== 0) silent = false;
        if (!mono && readBits(sideStart + pre + g * grSize + 59, 12) !== 0) silent = false;
      }
    } else {
      mdb = readBits(sideStart, 8);
      const pre = 8 + (mono ? 1 : 2);
      if (readBits(sideStart + pre, 12) !== 0) silent = false;
      if (!mono && readBits(sideStart + pre + 63, 12) !== 0) silent = false;
    }
    out.push({ off: i, len, silent, mdb, samples: ver === 3 ? 1152 : 576, sr: SR[ver][si] });
    i += len;
  }
  return out;
}

for (const [tag, globalName] of [['rumiClips', 'RUMI_CLIPS'], ['rumiCues', 'RUMI_CUES']]) {
  const m = html.match(new RegExp(`<script id="${tag}">window\\.${globalName} = ([\\s\\S]*?);</script>`));
  if (!m) { console.log(`${tag}: not embedded`); continue; }
  const table = JSON.parse(m[1]);
  let clips = 0, totalBytes = 0, silentBytes = 0, leadBytes = 0, tailBytes = 0;
  let leadSec = 0, tailSec = 0, reservoirRisk = 0;
  for (const b64 of Object.values(table)) {
    const buf = Buffer.from(b64, 'base64');
    const fr = frames(buf);
    if (!fr.length) continue;
    clips += 1;
    totalBytes += buf.length;
    silentBytes += fr.filter((f) => f.silent).reduce((a, f) => a + f.len, 0);
    let lead = 0;
    while (lead < fr.length && fr[lead].silent) lead += 1;
    let tail = 0;
    while (tail < fr.length - lead && fr[fr.length - 1 - tail].silent) tail += 1;
    for (let k = 0; k < lead; k += 1) { leadBytes += fr[k].len; leadSec += fr[k].samples / fr[k].sr; }
    for (let k = 0; k < tail; k += 1) { const f = fr[fr.length - 1 - k]; tailBytes += f.len; tailSec += f.samples / f.sr; }
    // A first-kept-frame that reaches back into the cut region is the reservoir hazard.
    if (lead > 0 && lead < fr.length && fr[lead].mdb > 0) reservoirRisk += 1;
  }
  const b64of = (n) => Math.round((n * 4) / 3);
  console.log(`${tag}: ${clips} clips, ${(totalBytes / 1e6).toFixed(2)} MB raw`);
  console.log(`  frames with empty side info (digital silence): ${(silentBytes / 1e6).toFixed(2)} MB raw anywhere in-clip`);
  console.log(`  trimmable LEADING run:  ${(leadBytes / 1e6).toFixed(2)} MB raw (${leadSec.toFixed(1)}s total) -> ~${(b64of(leadBytes) / 1e6).toFixed(2)} MB of page`);
  console.log(`  trimmable TRAILING run: ${(tailBytes / 1e6).toFixed(2)} MB raw (${tailSec.toFixed(1)}s total) -> ~${(b64of(tailBytes) / 1e6).toFixed(2)} MB of page`);
  console.log(`  clips whose first kept frame reaches back into cut bytes (bit-reservoir risk): ${reservoirRisk}`);
}
