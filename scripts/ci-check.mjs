// CI gate for Rumi. Run by .github/workflows/ci.yml, and runnable by hand with
// `node scripts/ci-check.mjs`.
//
// WHY THIS EXISTS. Rumi is one 7 MB hand-edited HTML file with no bundler, no framework and no
// build step. Nothing stands between an edit and production except this file. It was extracted
// from `quick-tools` on 2026-08-21 by the RUMI2 lane; the gate came with it because the repo it
// left had one and the repo it arrived in must not be weaker.
//
// THE FAILURE THIS GATE IS ACTUALLY FOR, and it is not the syntax one. Two of the three inline
// script blocks are 5.9 MB and 1.1 MB of base64-encoded mp3 held in JavaScript object literals.
// A truncated or half-pasted blob still parses, still renders, still shows every button, and
// plays SILENCE. The user is five years old and speaks to the app instead of reporting bugs, so
// a silent clip is a defect that reports itself to nobody. Assertions 4 and 5 are the ones that
// catch it and they are worth more than the rest put together.
//
// Exits non-zero if any assertion fails, and prints what it checked either way.

import {
  readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync, readdirSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VOICES, appTag, packDir, packIndexPath, packClipPath } from './rumi-voices.mjs';

const APP = 'rumi-espanol-app.html';

const failures = [];
const checks = [];
const scratch = mkdtempSync(join(tmpdir(), 'rumi-ci-'));

function ok(label) { checks.push(`PASS  ${label}`); }
function bad(label, detail) { failures.push(`FAIL  ${label}\n      ${String(detail).trim()}`); }

function finish() {
  rmSync(scratch, { recursive: true, force: true });
  for (const line of checks) console.log(line);
  for (const line of failures) console.error(line);
  console.log(`\n${checks.length} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
}

// `node --check` is the same parser the runtime uses, so it agrees with the browser on what is a
// syntax error. Every block here is a classic script (no type=module anywhere in the page), so
// the scratch file gets a .js extension.
function parses(code, label) {
  const file = join(scratch, `block-${checks.length + failures.length}.js`);
  writeFileSync(file, code);
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    ok(label);
    return true;
  } catch (e) {
    bad(label, e.stderr?.toString() || e.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 1. The app file and its config are present. Everything below reads them.
// ---------------------------------------------------------------------------
for (const f of [APP, 'vercel.json']) {
  if (existsSync(f)) ok(`asset present: ${f}`);
  else bad(`asset present: ${f}`, 'file is missing from the repo');
}
if (!existsSync(APP)) finish();

const html = readFileSync(APP, 'utf8');

// ---------------------------------------------------------------------------
// 2. The page is self-contained. Rumi has to work on a laptop that is not online and on a phone
//    in a house with bad wifi, and it does that by having no subresources at all: no <link>, no
//    <script src>, no <img src>, no external audio. If a reference to a local file ever appears,
//    this repo has quietly acquired an asset pipeline it has no way to precache, and the app
//    starts failing in exactly the conditions it exists to survive.
// ---------------------------------------------------------------------------
//    TWO NAMED EXCEPTIONS, added 2026-08-24, and the shape of the exception is the point.
//
//    `apple-touch-icon` and `manifest` are not subresources of the running app. Nothing on the page
//    reads them and no code path waits on them: iOS fetches the touch icon once, at the moment
//    somebody taps "Add to Home Screen", and a browser fetches the manifest at install time. Both
//    happen while the phone is online and by definition not while the app is being used. So the
//    harm this rule exists to prevent -- the app failing in the conditions it was built to survive
//    -- cannot occur through these two, and the rule's own sentence about acquiring an unprecachable
//    asset pipeline does not describe them.
//
//    They are not inlined as data URIs, which is what the rest of this check would push you toward,
//    because iOS does not reliably honour a data-URI apple-touch-icon and Chrome dropped data-URI
//    manifests outright. An inlined icon would satisfy this gate and then not appear on the home
//    screen, which is worse than either honest outcome. The favicon IS inlined, because a data-URI
//    favicon does work.
//
//    The exception is BY REL NAME, not by file extension or by path, and the assertion below proves
//    the allowance is exactly those two and nothing else. A stylesheet, a script src, an img src, an
//    audio src or a font still fail this check exactly as before -- verified by observation, see the
//    RUMI preview-assets commit.
// ---------------------------------------------------------------------------
const ALLOWED_LINK_RELS = new Set(['apple-touch-icon', 'manifest']);

const refs = new Set();
const allowedByRel = [];
for (const [, attrs, href] of html.matchAll(/<link([^>]*)\shref\s*=\s*["']([^"']+)["']/gi)) {
  const rel = (attrs.match(/\srel\s*=\s*["']([^"']+)["']/i)?.[1] || '').trim().toLowerCase();
  if (ALLOWED_LINK_RELS.has(rel)) {
    allowedByRel.push(`${rel} -> ${href}`);
    continue;
  }
  refs.add(href);
}
for (const [, src] of html.matchAll(/<(?:script|img|audio|source|iframe)[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi)) refs.add(src);
const external = [...refs].filter((r) => !r.startsWith('data:'));
if (external.length === 0) ok('page is self-contained: 0 subresource references');
else bad('page is self-contained', `references ${external.join(', ')}. Rumi is one file on purpose — it must work with no network. Inline it or this app breaks offline.`);

// The exception is narrow on purpose, so state its size out loud rather than letting it be a hole
// nobody counts. If this number climbs, somebody widened the rule without saying so.
if (allowedByRel.length <= ALLOWED_LINK_RELS.size) {
  ok(`OS-metadata links exempt by rel name: ${allowedByRel.length} (${allowedByRel.join(', ') || 'none'})`);
} else {
  bad('OS-metadata exemption stayed narrow', `${allowedByRel.length} exempt links found, cap is ${ALLOWED_LINK_RELS.size}: ${allowedByRel.join(', ')}`);
}

// ---------------------------------------------------------------------------
// 3. Every inline script block parses, and the stylesheet is non-empty. A syntax slip in the
//    53 KB app block ships a page that loads and renders dead; an empty <style> renders an
//    unstyled page, which returns 200 and looks like a completely different bug.
// ---------------------------------------------------------------------------
const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
if (blocks.length === 0) {
  bad('page carries inline logic', 'no <script> block found — the page loads no logic at all and renders dead');
}
for (const [, attrs, code] of blocks) {
  const id = (attrs.match(/id\s*=\s*["']([^"']+)["']/) || [, '(unnamed)'])[1];
  if (/\stype\s*=/.test(attrs)) {
    // Not fatal, but it changes how the browser parses the block and therefore what this gate
    // should be checking. Say so rather than checking the wrong thing silently.
    bad(`script block ${id} is a classic script`, `it carries a type attribute (${attrs.trim()}). This gate parses every block as a classic script; a module or a JSON block needs different handling here before it can be trusted.`);
    continue;
  }
  parses(code, `js parses: script#${id} (${code.length} bytes)`);
}

const style = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/) || [, ''])[1];
if (style.trim().length > 0) ok(`inline stylesheet is non-empty (${style.length} bytes)`);
else bad('inline stylesheet is non-empty', 'the <style> block is empty — the page will render unstyled');

// ---------------------------------------------------------------------------
// 4. THE ONE THAT MATTERS. The audio banks exist, are populated, and every clip decodes to a
//    plausible mp3. Evaluated in a fresh Node vm with a stub `window`, which is enough because
//    both blocks are a single assignment of an object literal and touch nothing else.
// ---------------------------------------------------------------------------
const BANKS = [
  { id: 'rumiClips', global: 'RUMI_CLIPS', floor: 200 },
  { id: 'rumiCues', global: 'RUMI_CUES', floor: 40 },
];

// Walk the mp3 frame headers and require that the frames tile the buffer EXACTLY to its last
// byte.
//
// A header-only check is not enough here and the first version of this file got that wrong. A
// clip truncated mid-file keeps its ID3 tag and its first frame sync, so "starts with 0xFF 0xEx"
// passes on a blob that is half gone — proved on 2026-08-21 by cutting a real clip to 200 base64
// characters and watching this gate print 17/17. Frame lengths are computed from the bitrate and
// sample-rate indices, so a short paste runs the last frame past the end of the buffer and the
// walk stops with bytes left over. Measured against the real bank the same day: all 228 clips
// tile to the byte, 0 ragged.
const BR_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BR_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** @returns {{frames:number, consumed:number, why:string|null}} */
function walkMp3(b) {
  let i = 0;
  // Skip an ID3v2 tag if present. Its size is a 28-bit synchsafe integer in bytes 6..9.
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    i = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f));
  }
  let frames = 0;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return { frames, consumed: i, why: 'lost frame sync' };
    const ver = (b[i + 1] >> 3) & 3;          // 0 = MPEG2.5, 2 = MPEG2, 3 = MPEG1 (1 is reserved)
    const layer = (b[i + 1] >> 1) & 3;        // 1 = Layer III
    if (ver === 1 || layer !== 1) return { frames, consumed: i, why: 'not MPEG Layer III' };
    const bi = (b[i + 2] >> 4) & 15;
    const si = (b[i + 2] >> 2) & 3;
    const pad = (b[i + 2] >> 1) & 1;
    if (bi === 0 || bi === 15 || si === 3) return { frames, consumed: i, why: 'reserved bitrate or sample-rate index' };
    const len = Math.floor((ver === 3 ? 144 : 72) * (ver === 3 ? BR_V1 : BR_V2)[bi] * 1000 / SR[ver][si]) + pad;
    if (len < 4) return { frames, consumed: i, why: 'implausible frame length' };
    i += len;
    frames++;
  }
  return { frames, consumed: i, why: null };
}

/* RUMIVOICES2: kept so section 9 can compare each downloadable voice's pack against the bank
 * that ships inside the page. A pack short of a line is that line falling through to a device
 * voice the target iPad does not have, i.e. silence, and nothing else would report it. */
const embeddedBanks = {};

for (const bank of BANKS) {
  const block = blocks.find(([, attrs]) => new RegExp(`id\\s*=\\s*["']${bank.id}["']`).test(attrs));
  if (!block) {
    bad(`audio bank present: ${bank.id}`, `no <script id="${bank.id}"> block — that bank of clips is gone and every phrase it holds will play silence`);
    continue;
  }

  let table;
  try {
    // eslint-disable-next-line no-new-func
    const run = new Function('window', `${block[2]}\n;return window.${bank.global};`);
    table = run({});
  } catch (e) {
    bad(`audio bank evaluates: ${bank.id}`, e.message);
    continue;
  }
  if (!table || typeof table !== 'object') {
    bad(`audio bank evaluates: ${bank.id}`, `window.${bank.global} is ${typeof table}, not an object — the block ran but assigned nothing usable`);
    continue;
  }

  embeddedBanks[bank.id] = table;
  const keys = Object.keys(table);
  if (keys.length >= bank.floor) ok(`audio bank populated: ${bank.id} — ${keys.length} clips (floor ${bank.floor})`);
  else bad(`audio bank populated: ${bank.id}`, `${keys.length} clips, below the floor of ${bank.floor}. A bank that shrank is a paste that truncated; nothing else in the app will tell you.`);

  // 5. Decode every clip. This is the assertion that catches a truncated blob, and it catches it
  //    for the whole bank rather than for a sample, because a five-year-old cannot report which
  //    word went quiet.
  const bad_clips = [];
  let bytes = 0;
  for (const k of keys) {
    const v = table[k];
    if (typeof v !== 'string' || v.length === 0) { bad_clips.push(`${k} (empty)`); continue; }
    let buf;
    try { buf = Buffer.from(v, 'base64'); } catch { bad_clips.push(`${k} (not base64)`); continue; }
    bytes += buf.length;
    const w = walkMp3(buf);
    if (w.why) bad_clips.push(`${k} (${buf.length}B, ${w.why} after ${w.frames} frames)`);
    else if (w.consumed !== buf.length) bad_clips.push(`${k} (${buf.length}B, frames tile only ${w.consumed}B — cut short)`);
    else if (w.frames === 0) bad_clips.push(`${k} (${buf.length}B, zero audio frames)`);
  }
  if (bad_clips.length === 0) ok(`every clip is a complete mp3: ${bank.id} — ${keys.length} clips, ${(bytes / 1048576).toFixed(2)} MB, frames tile to the byte`);
  else bad(`every clip is a complete mp3: ${bank.id}`,
    `${bad_clips.length} of ${keys.length} are not complete playable audio: ${bad_clips.slice(0, 8).join(', ')}${bad_clips.length > 8 ? ` … and ${bad_clips.length - 8} more` : ''}. These play silence or cut off mid-word — the page renders perfectly and the child hears nothing.`);
}

// ---------------------------------------------------------------------------
// 6. The title string. The uptime monitor asserts content, never a bare 200 — a shell that
//    answers 200 while empty is the exact failure content assertions exist for. `Rumi Español`
//    is the string the monitor checks, so the gate owns it.
// ---------------------------------------------------------------------------
if (/<title>\s*Rumi Español\s*<\/title>/.test(html)) ok('title is "Rumi Español" — the string the uptime monitor asserts');
else bad('title is "Rumi Español"', 'the <title> changed. The external uptime check asserts this exact string, so changing it turns the monitor red without anything being down. Change both together or neither.');

// ---------------------------------------------------------------------------
// 7. Routing. With cleanUrls on, a rewrite destination ending in .html 404s in production —
//    cleanUrls has already rewritten that path away. Measured on the-board 2026-08-20. Both the
//    bare domain and the /rumi path must land on the app: /rumi is the shape of the URL Whit and
//    Heidi already hold from quick-tools, so it has to keep working here too.
// ---------------------------------------------------------------------------
if (existsSync('vercel.json')) {
  let vc = null;
  try {
    vc = JSON.parse(readFileSync('vercel.json', 'utf8'));
    ok('json parses: vercel.json');
  } catch (e) {
    bad('json parses: vercel.json', `${e.message} — this breaks the deploy outright`);
  }
  if (vc) {
    if (vc.cleanUrls === true) ok('vercel.json keeps cleanUrls on');
    else bad('vercel.json keeps cleanUrls on', 'cleanUrls was turned off — every extensionless URL already shared will break');

    const resolve = (d) => {
      const n = String(d).replace(/^\//, '');
      return existsSync(n) ? n : (existsSync(`${n}.html`) ? `${n}.html` : null);
    };
    for (const source of ['/', '/rumi']) {
      const rw = (vc.rewrites || []).find((r) => r.source === source);
      if (!rw) bad(`vercel.json rewrites ${source}`, `no rewrite with source "${source}" — that URL will not serve the app, and with no index.html in this repo the bare domain 404s`);
      else if (vc.cleanUrls === true && /\.html$/i.test(rw.destination)) bad(`vercel.json rewrites ${source}`,
        `destination "${rw.destination}" ends in .html while cleanUrls is on, which 404s in production. Drop the extension.`);
      else if (resolve(rw.destination) !== APP) bad(`vercel.json rewrites ${source}`,
        `it points at ${rw.destination}, which resolves to ${resolve(rw.destination) || 'no file in the repo'} rather than ${APP}`);
      else ok(`vercel.json rewrites ${source} -> ${rw.destination} (${APP})`);
    }
  }
}

// ---------------------------------------------------------------------------
// 7b. The voice bakeoff page. It came across with Rumi on 2026-08-21 because it is a Rumi
//     artifact — Whit compares candidate voices on it by ear — and leaving it in quick-tools
//     would have meant the toolchain that generates it lived in a repo the app had left. It is
//     not the product, so it gets a lighter check than the app: it must be present and its
//     inline script must parse. `cleanUrls` serves it at /rumi-voice-bakeoff with no rewrite,
//     which is the same path shape it had before the move, so Whit's existing link still works.
// ---------------------------------------------------------------------------
const BAKEOFF = 'rumi-voice-bakeoff.html';
if (existsSync(BAKEOFF)) {
  const bake = readFileSync(BAKEOFF, 'utf8');
  ok(`asset present: ${BAKEOFF} (${bake.length} bytes)`);
  const bakeBlocks = [...bake.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
  for (const [i, [, , code]] of bakeBlocks.entries()) {
    if (code.trim()) parses(code, `js parses: ${BAKEOFF} block ${i + 1} (${code.length} bytes)`);
  }
} else {
  bad(`asset present: ${BAKEOFF}`, 'the voice bakeoff page is missing. It moved here with Rumi on 2026-08-21 and Whit holds its URL; if it was deliberately retired, remove this assertion in the same commit so the gate keeps meaning something.');
}

// ---------------------------------------------------------------------------
// 8. No index.html. Root CLAUDE.md, ratified 2026-08-17: a file is only named index.html when a
//    web server requires that exact name to resolve a live URL. Here one does not — the rewrite
//    above serves the bare domain from a descriptively named file, which is what makes the app
//    findable in Spotlight. Asserted because adding index.html is the obvious "fix" for a 404 and
//    it would quietly undo that.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// The bakeoff page's own metadata block. It is served at a URL Whit holds and it shipped with a
// <title> and nothing else: a bare grey URL in a text, a blank square on a home screen. The page
// is GENERATED — by scripts/rumi-eleven-bakeoff.mjs since RUMIVOICE1 (2026-09-13), by
// scripts/rumi-bakeoff.mjs before that — so this asserts the committed output — regenerating
// needs the audio in build/, which is deliberately not in the repo, and the two can therefore
// drift without anything noticing. If you change the head, change it in the generator too.
// ---------------------------------------------------------------------------
if (existsSync(BAKEOFF)) {
  const bakeHtml = readFileSync(BAKEOFF, 'utf8');
  const need = [
    [/property="og:title" content="[^"]{2,}"/, 'og:title'],
    [/name="description" content="[^"]{10,}"/, 'a description'],
    [/property="og:description" content="[^"]{10,}"/, 'og:description'],
    [/name="twitter:card" content="summary_large_image"/, 'a large-card request'],
    [/name="apple-mobile-web-app-title" content="[^"]{2,}"/, 'a home-screen label'],
    [/name="apple-mobile-web-app-capable" content="yes"/, 'a standalone launch'],
    [/rel="apple-touch-icon"[^>]*href="[^"]+\.png"/, 'a PNG touch icon'],
    [/rel="manifest" href="[^"]+"/, 'a manifest link'],
  ];
  for (const [re, what] of need) {
    if (re.test(bakeHtml)) ok(`${BAKEOFF} carries ${what}`);
    else bad(`${BAKEOFF} carries ${what}`, 'the metadata block is incomplete. Fix it in scripts/rumi-eleven-bakeoff.mjs AND in the committed page, which cannot be regenerated without build/.');
  }
  // A relative og:image renders as a blank card in iMessage with no error anywhere.
  const bakeOg = bakeHtml.match(/property="og:image" content="([^"]+)"/);
  if (bakeOg && /^https:\/\//.test(bakeOg[1])) ok(`${BAKEOFF} og:image is absolute: ${bakeOg[1]}`);
  else bad(`${BAKEOFF} og:image is absolute`, bakeOg ? `${bakeOg[1]} is relative — a blank card, reported nowhere` : 'there is no og:image');
  // Every local file its head points at must actually be on disk.
  for (const m of bakeHtml.matchAll(/(?:rel="(?:apple-touch-icon|icon|manifest)"[^>]*href|href)="(\/[^"]+\.(?:png|json))"/g)) {
    const f = m[1].replace(/^\//, '');
    if (existsSync(f)) ok(`${BAKEOFF} -> ${m[1]} exists`);
    else bad(`${BAKEOFF} -> ${m[1]} exists`, `the head points at ${m[1]}, which is not in the repo`);
  }
}

// ---------------------------------------------------------------------------
// 9. THE FIVE VOICES (RUMIVOICES2, 2026-09-16; per-clip files, RUMITIDY1, 2026-09-17).
//    Whit: "why make me choose? let the user have like 5 options in the settings."
//
//    One voice is inside the page (section 4 walked every one of its clips). The other four are
//    a small index plus one mp3 per clip, downloaded the once a grown-up picks one. That makes
//    four new ways to ship a settings screen that is a lie, none of which any existing assertion
//    sees:
//
//    a) A name in the app that has no folder. The grown-up taps it, nothing arrives, and the app
//       falls back — correct behaviour, for a voice that should never have been offered.
//    b) An index that is SHORT. The lines it is missing have no recording in that voice, so they
//       fall through to the device's own Spanish voice, which on the iPad this app exists for
//       does not exist. The page looks perfect and those phrases are silence.
//    c) A clip file that does not match what the index promised — missing, truncated, or a byte
//       size that disagrees with the number the app trusted before it fetched anything.
//    d) An orphan clip file: rendered once, no longer named by the index, sitting in the repo
//       doing nothing but costing bytes nobody serves on purpose.
//
//    The registry is compared byte for byte against scripts/rumi-voices.mjs, which is what the
//    generator and the pack builder read, so the four copies of this list cannot drift apart.
// ---------------------------------------------------------------------------
{
  const shipped = html.match(/<script id="rumiVoices">[\s\S]*?<\/script>/);
  if (!shipped) {
    bad('the app carries its voice registry', 'no <script id="rumiVoices"> block — the settings screen will list no voices at all and the app is stuck on whatever is embedded');
  } else if (shipped[0] === appTag()) {
    ok(`voice registry matches scripts/rumi-voices.mjs (${VOICES.length} voices)`);
  } else {
    bad('voice registry matches scripts/rumi-voices.mjs',
      'the block in the app and the list in scripts/rumi-voices.mjs disagree. Regenerate it with '
      + '`node scripts/rumi-voices.mjs --tag` and paste it over the block. A name in one and not '
      + 'the other is either a voice a grown-up can tap that downloads a file nobody wrote, or a '
      + 'pack sitting on the server that nothing offers.');
  }

  const embedded = VOICES.filter((v) => v.embedded);
  if (embedded.length === 1) ok(`exactly one voice is embedded in the page: ${embedded[0].name}`);
  else bad('exactly one voice is embedded in the page', `${embedded.length} are marked embedded. The page holds one voice's clips and falls back to it whenever a download fails; zero means no fallback and two means the file is twice the size it can be.`);

  const bank = embeddedBanks.rumiClips;
  const wanted = bank ? Object.keys(bank) : [];
  for (const v of VOICES.filter((x) => !x.embedded)) {
    const dir = packDir(v.slug);
    const indexFile = packIndexPath(v.slug);
    if (!existsSync(indexFile)) {
      bad(`voice index present: ${indexFile}`, `${v.name} is offered in the settings screen and has no index beside the page. Run \`npm run rumi:11:packs\`.`);
      continue;
    }
    let index = null;
    try {
      index = JSON.parse(readFileSync(indexFile, 'utf8'));
      ok(`json parses: ${indexFile}`);
    } catch (e) {
      bad(`json parses: ${indexFile}`, `${e.message} — the fetch succeeds, the parse throws, and the app falls back to the embedded voice for a reason nobody can see`);
      continue;
    }
    if (index.voice === v.slug) ok(`${indexFile} names itself ${v.slug}`);
    else bad(`${indexFile} names itself ${v.slug}`, `it says "${index.voice}" — two voices' indexes have been swapped, and a grown-up tapping one name hears the other`);

    const entries = (index.clips && typeof index.clips === 'object') ? index.clips : {};
    const short = wanted.filter((k) => !entries[k] || typeof entries[k].file !== 'string');
    if (!wanted.length) {
      bad(`${indexFile} covers every line the embedded voice does`, 'the embedded bank could not be read, so there is nothing to compare against');
    } else if (short.length === 0) {
      ok(`${indexFile} covers every line the embedded voice does (${wanted.length})`);
    } else {
      bad(`${indexFile} covers every line the embedded voice does`,
        `${short.length} of ${wanted.length} missing: ${short.slice(0, 6).join(', ')}${short.length > 6 ? ` … and ${short.length - 6} more` : ''}. Those phrases fall through to the device's Spanish voice, which on the target iPad is silence.`);
    }

    // Every clip file the index names: on disk, its byte size matching what the index promised
    // (a fetch that trusts a wrong number before it downloads is the failure indexUsable() in
    // the app exists to prevent), and a complete, unbroken mp3 — the same frame walk assertion
    // 5 runs on the embedded voice, now run on the files that live outside the page.
    const ragged = [];
    const wantedFiles = new Set();
    let bytes = 0;
    for (const k of Object.keys(entries)) {
      const e = entries[k];
      if (!e || typeof e.file !== 'string') { ragged.push(`${k} (no file named)`); continue; }
      wantedFiles.add(e.file);
      const clipPath = packClipPath(v.slug, e.file);
      if (!existsSync(clipPath)) { ragged.push(`${k} -> ${e.file} (missing on disk)`); continue; }
      const buf = readFileSync(clipPath);
      bytes += buf.length;
      if (buf.length !== e.bytes) {
        ragged.push(`${k} -> ${e.file} (index says ${e.bytes}B, file is ${buf.length}B)`);
        continue;
      }
      const w = walkMp3(buf);
      if (w.why) ragged.push(`${e.file} (${buf.length}B, ${w.why} after ${w.frames} frames)`);
      else if (w.consumed !== buf.length) ragged.push(`${e.file} (${buf.length}B, frames tile only ${w.consumed}B — cut short)`);
      else if (w.frames === 0) ragged.push(`${e.file} (${buf.length}B, zero audio frames)`);
    }
    if (ragged.length === 0) ok(`every clip is a complete mp3, byte size as indexed: ${dir}/ — ${Object.keys(entries).length} clips, ${(bytes / 1048576).toFixed(2)} MB, frames tile to the byte`);
    else bad(`every clip is a complete mp3, byte size as indexed: ${dir}/`,
      `${ragged.length} of ${Object.keys(entries).length} are not complete playable audio at the size promised: ${ragged.slice(0, 6).join(', ')}. These play silence, cut off mid-word, or trust a byte count that lied — and the child cannot report it.`);

    // Orphans: a clip file on disk that the index no longer names — a stale render left behind
    // by a corpus edit or a voice/model/speed change, serving nobody and costing bytes anyway.
    if (existsSync(dir)) {
      const onDisk = readdirSync(dir).filter((f) => f.endsWith('.mp3'));
      const orphanFiles = onDisk.filter((f) => !wantedFiles.has(f));
      if (orphanFiles.length === 0) ok(`${dir}/ has no orphan clip files (${onDisk.length} on disk, all indexed)`);
      else bad(`${dir}/ has no orphan clip files`, `${orphanFiles.length} on disk are not named by the index: ${orphanFiles.slice(0, 5).join(', ')}. Re-run \`npm run rumi:11:packs\`, which removes these itself.`);
    }

    // Timing describes lines that are actually in the index, or it cuts words in half.
    const times = (index.times && typeof index.times === 'object') ? index.times : {};
    const orphanTimes = Object.keys(times).filter((k) => !Object.prototype.hasOwnProperty.call(entries, k));
    if (orphanTimes.length === 0) ok(`${indexFile} timing describes only clips it carries (${Object.keys(times).length} timed)`);
    else bad(`${indexFile} timing describes only clips it carries`, `${orphanTimes.length} timing entries have no clip: ${orphanTimes.slice(0, 5).join(', ')}`);

    // Machine-generated bulk, so each voice's own folder carries the marker too (root
    // .claude/rules/served-pages.md) — not just voices/ itself, since each slug folder is now
    // its own root of generated files.
    if (existsSync(`${dir}/.metadata_never_index`)) ok(`${dir}/ carries .metadata_never_index`);
    else bad(`${dir}/ carries .metadata_never_index`, 'the folder holds machine-generated bulk and must carry the marker, per .claude/rules/served-pages.md');
  }

  if (!VOICES.some((v) => !v.embedded)) {
    // no packs, nothing to mark
  } else if (existsSync('voices/.metadata_never_index')) {
    ok('voices/ carries .metadata_never_index');
  } else {
    bad('voices/ carries .metadata_never_index', 'the folder holds machine-generated bulk and must carry the marker, per .claude/rules/served-pages.md');
  }
}

if (!existsSync('index.html')) ok('no index.html — the bare domain is served by a rewrite, so the real file keeps a findable name');
else bad('no index.html', 'an index.html appeared. Root CLAUDE.md allows it only when a server requires that exact name, and the rewrite in vercel.json means one does not. Serve the descriptively named file instead.');

finish();
