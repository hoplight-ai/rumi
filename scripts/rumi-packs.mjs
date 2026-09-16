#!/usr/bin/env node
// rumi-packs.mjs — render all five voices, embed one, write the other four beside the page.
//
// WHY FIVE VOICES CANNOT ALL LIVE IN THE PAGE, which is the constraint that shapes everything
// here. rumi-embed.mjs refuses to write an app over 10,485,760 bytes; one voice's Spanish bank
// is about 2MB of base64 inside the file. Five would be ten. So exactly one voice is inside the
// page — the app opens and talks with no network, first time, on hotel wifi, which is the whole
// argument for this app being one file — and the other four are ordinary static JSON files
// downloaded on the one occasion a grown-up picks one, then kept on the device.
//
// WHAT IT WRITES
//   build/rumi-clips.json, build/rumi-times.json   the embedded voice, then spliced in by
//                                                  rumi-embed.mjs exactly as before
//   voices/<slug>.json                             { voice, name, clips, times } for each of
//                                                  the other four, times ALREADY turned into
//                                                  word spans, the same shape rumi-embed.mjs
//                                                  writes into <script id="rumiTimes">
//
// WHY THE SPANS ARE PRE-COMPUTED HERE rather than in the app: a per-character alignment is about
// thirty times the size of the word spans the slow speed actually reads, and that is a download
// a five-year-old waits through for nothing. Same conversion, same rumi-words.mjs, same result.
//
// THE ENGLISH CUE MAP IS NEVER TOUCHED. `npm run rumi:11:embed` also runs `--cues --map`, which
// on a machine with an empty build/ writes an empty English map; rumi-embed.mjs now refuses that
// rather than silently replacing 171 recordings with nothing. This script only ever renders the
// Spanish bank and then calls rumi-embed.mjs directly, so the cue tag is left where it is.
//
// usage: node --env-file=.env.local scripts/rumi-packs.mjs            render all five
//        node --env-file=.env.local scripts/rumi-packs.mjs --limit 3  three lines each, to listen
//        node scripts/rumi-packs.mjs --maps-only                      no network: rebuild the
//                                                                     packs from clips already
//                                                                     rendered under build/

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collect } from './rumi-strings.mjs';
import { spanMap } from './rumi-words.mjs';
import { VOICES, DEFAULT_VOICE, packPath } from './rumi-voices.mjs';
import { BANKS, setVoice, renderBank, readBank, writeMaps } from './rumi-eleven.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = path.join(ROOT, 'rumi-espanol-app.html');

function fail(msg) {
  console.error(`REFUSED: ${msg}`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const mapsOnly = args.includes('--maps-only');
  const limitArg = args.indexOf('--limit');
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;

  const html = fs.readFileSync(HTML, 'utf8');
  const items = collect(html);
  console.log(`${items.length} spanish lines, ${VOICES.length} voices\n`);

  let credits = 0;
  for (const v of VOICES) {
    setVoice(v.id);
    if (!mapsOnly) {
      process.stdout.write(`${v.name} (${v.slug})\n`);
      const r = await renderBank(BANKS.es, items, limit);
      credits += r.chars;
    }
  }

  // The embedded voice goes through the ordinary path, untouched: write build/rumi-clips.json
  // and build/rumi-times.json, then let rumi-embed.mjs splice and gate them. Every assertion
  // that file makes about the shipped app still runs, unchanged.
  setVoice(DEFAULT_VOICE.id);
  const emb = writeMaps(BANKS.es, items);
  console.log(`\nembedded voice ${DEFAULT_VOICE.name}: ${emb.count} clips, `
    + `${(emb.bytes / 1e6).toFixed(2)} MB raw, ${emb.timed} with timing`);
  if (emb.count !== items.length) {
    fail(`${DEFAULT_VOICE.name} is short ${items.length - emb.count} clips. The voice inside the `
      + 'page is the one that has to be complete — every line it misses falls through to a device '
      + 'voice, which on the iPad this app exists for is silence.');
  }

  // The four packs. Same items, same span conversion, and the same completeness rule: a pack
  // short of a line is that line going quiet the moment a grown-up picks that voice.
  const outDir = path.join(ROOT, 'voices');
  fs.mkdirSync(outDir, { recursive: true });
  for (const v of VOICES.filter((x) => !x.embedded)) {
    const { clips, times, bytes, missing } = readBank(BANKS.es, items, v.id);
    if (missing.length) {
      fail(`${v.name} is short ${missing.length} clips (${missing.slice(0, 3).join(', ')}…). `
        + 'Re-run without --maps-only, or with the key in the environment.');
    }
    const withClips = items.filter((it) => Object.prototype.hasOwnProperty.call(clips, it.key));
    const { map, dropped } = spanMap(withClips, times);
    for (const k of dropped) console.log(`  UNTIMED  ${v.slug}  ${k}`);
    const file = path.join(ROOT, packPath(v.slug));
    const body = JSON.stringify({ voice: v.slug, name: v.name, clips, times: map });
    fs.writeFileSync(file, body);
    console.log(`${packPath(v.slug).padEnd(22)} ${Object.keys(clips).length} clips, `
      + `${(bytes / 1e6).toFixed(2)} MB raw, ${(Buffer.byteLength(body) / 1e6).toFixed(2)} MB served, `
      + `${Object.keys(map).length} timed`);
  }

  console.log('\nembedding the default voice into the page:');
  // Run it as its own process rather than importing it: rumi-embed.mjs is a script with a main()
  // and its refusals are exit codes. A refusal there must stop this run too.
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'rumi-embed.mjs')],
    { cwd: ROOT, stdio: 'inherit' });

  if (credits) console.log(`\n${credits} credits spent this run.`);
}

main().catch((e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
