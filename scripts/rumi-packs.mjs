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
//   voices/<slug>/index.json                       { voice, name, clips: {key: {file, bytes}},
//                                                  times: {key: [...spans]} } for each of the
//                                                  other four
//   voices/<slug>/<clip-id>.mp3                    one raw mp3 per clip, named by the same
//                                                  content-addressed hash rumi-eleven.mjs already
//                                                  uses for its own render cache
//
// WHY PER-CLIP FILES (RUMITIDY1, 2026-09-17). The one-JSON-per-voice shape this replaces held all
// 280 clips' base64 audio in a single file, so a re-recording that changed ten lines rewrote the
// other 270 too — every re-recording pass grew the repo's history by roughly 11MB regardless of
// how many lines actually changed. `writeIfChanged` below only opens a clip file for writing when
// its bytes differ from what is already on disk, so a re-recording now touches exactly the files
// that changed. The cost, named in the brief and not hidden here: picking a voice for the first
// time goes from one request to roughly one per clip (280), because the app now fetches the index
// and then every clip it names, rather than one file that already held them all.
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
//        node scripts/rumi-packs.mjs --packs-only                     no network, no build/, no
//                                                                     touch to the embedded voice:
//                                                                     only split the four
//                                                                     downloadable voices into
//                                                                     voices/<slug>/, from
//                                                                     whichever source (build/ or
//                                                                     the pre-RUMITIDY1 flat JSON)
//                                                                     already has each one
//
// WHERE EACH PACK'S BYTES COME FROM (RUMITIDY1). Two sources, tried in this order, and neither one
// ever calls ElevenLabs on its own — only the render loop above does that, and only when this is
// run without --maps-only:
//   1. build/rumi-clips-11/  — a fresh render on this machine. Preferred when it is there.
//   2. voices/<slug>.json    — the pre-RUMITIDY1 flat pack already shipped, if there is no fresh
//                              render to prefer. This is how this lane produced voices/<slug>/ the
//                              first time, on a worktree with no build/ at all: split the four
//                              packs that were already on disk into per-clip files, with no
//                              network call and no ElevenLabs credential in play.
// If neither exists for a voice, this refuses rather than guessing.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collect } from './rumi-strings.mjs';
import { spanMap } from './rumi-words.mjs';
import { VOICES, DEFAULT_VOICE, packDir, packIndexPath } from './rumi-voices.mjs';
import {
  BANKS, setVoice, renderBank, readBank, writeMaps, clipFile,
} from './rumi-eleven.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = path.join(ROOT, 'rumi-espanol-app.html');

function fail(msg) {
  console.error(`REFUSED: ${msg}`);
  process.exit(1);
}

/** Write `buf` to `dest` only if it differs from what is already there. Returns whether it wrote.
 *  This is the one thing that makes a re-recording touch only the clips that changed: an unchanged
 *  clip's file is never opened for writing, so git sees no diff for it, unlike the one-JSON-per-
 *  voice shape this replaces, which rewrote all 280 clips' bytes the moment any one of them did.
 *  Exported (not just used by main() below) so a test can prove this in isolation, on a temp
 *  directory, with no ElevenLabs credential and no network. */
export function writeIfChanged(dest, buf) {
  if (fs.existsSync(dest) && fs.readFileSync(dest).equals(buf)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return true;
}

/** Source 1: a fresh render on this machine. Reads build/rumi-clips-11/ through rumi-eleven.mjs's
 *  own readBank(), so the render cache and the embedded voice keep reading the exact same files. */
function packFromRenderCache(v, items) {
  const { clips, times, missing } = readBank(BANKS.es, items, v.id);
  if (missing.length) return null;
  const withClips = items.filter((it) => Object.prototype.hasOwnProperty.call(clips, it.key));
  const { map } = spanMap(withClips, times);
  const byKey = {};
  let bytes = 0;
  for (const it of withClips) {
    bytes += Buffer.byteLength(clips[it.key], 'base64');
    byKey[it.key] = { base64: clips[it.key], spans: map[it.key] };
  }
  return { byKey, bytes, source: 'build/rumi-clips-11 (fresh render)' };
}

/** Source 2: the pre-RUMITIDY1 flat pack already on disk. `times` there is already in the word-
 *  span shape spanMap() produces — this script wrote it that way before RUMITIDY1 too — so it is
 *  used as-is rather than reprocessed. No network, no ElevenLabs credential, no build/ directory
 *  required: this is how a worktree with no render cache splits what has already shipped. */
function packFromLegacyJson(v) {
  const file = path.join(ROOT, 'voices', `${v.slug}.json`);
  if (!fs.existsSync(file)) return null;
  const legacy = JSON.parse(fs.readFileSync(file, 'utf8'));
  const clips = (legacy.clips && typeof legacy.clips === 'object') ? legacy.clips : {};
  const times = (legacy.times && typeof legacy.times === 'object') ? legacy.times : {};
  const byKey = {};
  let bytes = 0;
  for (const k of Object.keys(clips)) {
    bytes += Buffer.byteLength(clips[k], 'base64');
    byKey[k] = { base64: clips[k], spans: times[k] };
  }
  return { byKey, bytes, source: file };
}

async function main() {
  const args = process.argv.slice(2);
  const mapsOnly = args.includes('--maps-only');
  // RUMITIDY1: split the four downloadable voices into per-clip files and stop — never touch the
  // embedded voice's <script id="rumiClips"> tag, never call rumi-embed.mjs. This is the mode a
  // worktree with no build/ directory uses to convert packs that are already on disk (see
  // packFromLegacyJson above) with no ElevenLabs credential and no network call at all.
  const packsOnly = args.includes('--packs-only');
  const limitArg = args.indexOf('--limit');
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;

  const html = fs.readFileSync(HTML, 'utf8');
  const items = collect(html);
  console.log(`${items.length} spanish lines, ${VOICES.length} voices\n`);

  if (!packsOnly) {
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
    if (credits) console.log(`\n${credits} credits spent this run.`);
  }

  // The four packs. Same items, same span conversion, and the same completeness rule: a pack
  // short of a line is that line going quiet the moment a grown-up picks that voice. What is
  // new (RUMITIDY1) is the shape on disk: one small index plus one mp3 per clip, and only the
  // clips whose bytes actually changed get written.
  const voicesRoot = path.join(ROOT, 'voices');
  fs.mkdirSync(voicesRoot, { recursive: true });
  for (const v of VOICES.filter((x) => !x.embedded)) {
    const packed = packFromRenderCache(v, items) || packFromLegacyJson(v);
    if (!packed) {
      fail(`${v.name} has neither a fresh render under build/rumi-clips-11/ nor an existing `
        + `voices/${v.slug}.json to split. Run the real renderer first, or restore the flat pack.`);
    }
    const { byKey, bytes, source } = packed;
    const missingKeys = items.filter((it) => !Object.prototype.hasOwnProperty.call(byKey, it.key));
    if (missingKeys.length) {
      fail(`${v.name} is short ${missingKeys.length} clips (${missingKeys.slice(0, 3).map((it) => it.key).join(', ')}…), `
        + `reading from ${source}.`);
    }

    const dir = path.join(ROOT, packDir(v.slug));
    fs.mkdirSync(dir, { recursive: true });
    // Machine-generated bulk, same rule as the old flat voices/*.json files carried.
    fs.writeFileSync(path.join(dir, '.metadata_never_index'), '');

    const indexClips = {};
    const indexTimes = {};
    const wantedFiles = new Set();
    let written = 0;
    let kept = 0;
    let untimed = 0;
    for (const it of items) {
      const { base64, spans } = byKey[it.key];
      const buf = Buffer.from(base64, 'base64');
      const file = clipFile(it.key, v.id);
      wantedFiles.add(file);
      if (writeIfChanged(path.join(dir, file), buf)) written += 1; else kept += 1;
      indexClips[it.key] = { file, bytes: buf.length };
      if (spans) indexTimes[it.key] = spans; else untimed += 1;
    }
    if (untimed) console.log(`  UNTIMED  ${v.slug}  ${untimed} lines have no per-word spans`);

    // Orphans: a clip file left over from a line the corpus no longer asks for. Left behind, it
    // is dead weight nothing serves on purpose — the same failure mode rumi-embed.mjs's own
    // orphan gate catches for the embedded voice, applied here to the folder on disk.
    const onDisk = fs.readdirSync(dir).filter((f) => f.endsWith('.mp3'));
    let removedOrphans = 0;
    for (const f of onDisk) {
      if (!wantedFiles.has(f)) { fs.unlinkSync(path.join(dir, f)); removedOrphans += 1; }
    }

    const index = { voice: v.slug, name: v.name, clips: indexClips, times: indexTimes };
    fs.writeFileSync(path.join(ROOT, packIndexPath(v.slug)), JSON.stringify(index));
    console.log(`${packDir(v.slug).padEnd(14)} ${Object.keys(indexClips).length} clips, `
      + `${(bytes / 1e6).toFixed(2)} MB raw (from ${source}), ${written} written, ${kept} unchanged, `
      + `${removedOrphans} orphans removed, ${Object.keys(indexTimes).length} timed`);

    // The flat pack this replaces. Removed only once the folder that supersedes it is written and
    // gated below, so a failed run never leaves a voice with neither shape on disk.
    const legacyFile = path.join(voicesRoot, `${v.slug}.json`);
    if (fs.existsSync(legacyFile)) fs.unlinkSync(legacyFile);
  }

  if (packsOnly) {
    console.log('\n--packs-only: embedded voice and rumi-embed.mjs left untouched, as asked.');
    return;
  }

  console.log('\nembedding the default voice into the page:');
  // Run it as its own process rather than importing it: rumi-embed.mjs is a script with a main()
  // and its refusals are exit codes. A refusal there must stop this run too.
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'rumi-embed.mjs')],
    { cwd: ROOT, stdio: 'inherit' });
}

// Guarded (RUMITIDY1): a test imports writeIfChanged() from this module to prove the
// diff-only-rewrite behaviour without a network call or an ElevenLabs credential, and importing
// a module must never itself re-record five voices.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
}
