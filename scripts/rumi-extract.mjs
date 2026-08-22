#!/usr/bin/env node
// rumi-extract.mjs — rebuild build/ from the shipped page.
//
// WHY. build/ is gitignored, so a fresh checkout has no mp3s and no maps — but the page
// itself embeds every clip as base64. Regenerating from scratch would re-hit the
// rate-limited edge-tts endpoint 300+ times and, worse, could silently produce a
// DIFFERENT recording of the same phrase (the RUMI3b near-miss). This script inverts the
// embed instead: it reads both banks out of rumi-espanol-app.html and writes the exact
// content-addressed files the generators expect, so `rumi-audio.mjs` and `rumi-cues.mjs`
// see every existing clip as already made and synthesize only what is genuinely new.
//
// The filenames come from each generator's own clipFile(), so if a VOICE or RATE_OFFSET
// constant has changed since the page was built, the extracted files deliberately do NOT
// match and the generators regenerate — which is exactly the behaviour that keeps a voice
// change from silently reusing the old voice.
//
// usage: node scripts/rumi-extract.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clipFile as spanishFile } from './rumi-audio.mjs';
import { clipFile as englishFile } from './rumi-cues.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'rumi-espanol-app.html'), 'utf8');

const BANKS = [
  { tag: 'rumiClips', global: 'RUMI_CLIPS', dir: 'rumi-clips', map: 'rumi-clips.json', file: spanishFile },
  { tag: 'rumiCues', global: 'RUMI_CUES', dir: 'rumi-cues', map: 'rumi-cues.json', file: englishFile },
];

for (const bank of BANKS) {
  const m = html.match(new RegExp(`<script id="${bank.tag}">window\\.${bank.global} = ([\\s\\S]*?);</script>`));
  if (!m) {
    console.error(`SKIP: no populated <script id="${bank.tag}"> tag found`);
    continue;
  }
  const table = JSON.parse(m[1]);
  const outDir = path.join(ROOT, 'build', bank.dir);
  fs.mkdirSync(outDir, { recursive: true });
  // build/ is machine-generated bulk: stop Spotlight indexing it (root CLAUDE.md, 2026-08-17).
  const noIndex = path.join(ROOT, 'build', '.metadata_never_index');
  if (!fs.existsSync(noIndex)) fs.writeFileSync(noIndex, '');
  let written = 0, kept = 0, bytes = 0;
  for (const [key, b64] of Object.entries(table)) {
    const dest = path.join(outDir, bank.file(key));
    const buf = Buffer.from(b64, 'base64');
    bytes += buf.length;
    if (fs.existsSync(dest) && fs.statSync(dest).size === buf.length) { kept += 1; continue; }
    fs.writeFileSync(dest, buf);
    written += 1;
  }
  fs.writeFileSync(path.join(ROOT, 'build', bank.map), JSON.stringify(table));
  console.log(`${bank.tag}: ${Object.keys(table).length} clips (${(bytes / 1e6).toFixed(2)} MB raw) -> build/${bank.dir}/ (${written} written, ${kept} already current) + build/${bank.map}`);
}
