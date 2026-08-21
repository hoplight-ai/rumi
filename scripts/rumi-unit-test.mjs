#!/usr/bin/env node
// rumi-unit-test.mjs — the offline gate for Rumi Español. No network, no key, no browser.
//
// The one failure this exists to catch: the generator's key and the page's key drifting
// apart. If clipKey() in rumi-espanol-app.html and normalizeKey() in rumi-strings.mjs ever stop agreeing,
// every clip silently misses, the app falls back to the device voice, and NOTHING reports it —
// the page loads, the buttons work, it just sounds like it did before the upgrade. So the
// page's own clipKey is extracted and run against the generator's on the real string set.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect, normalizeKey, expand, readModules, FIXED_STRINGS } from './rumi-strings.mjs';
import { HELP_LINES } from './rumi-cues.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'rumi-espanol-app.html'), 'utf8');

let pass = 0;
const fails = [];
function ok(name, cond) {
  if (cond) { pass += 1; } else { fails.push(name); }
}

/* ---- 1. the payload still parses and still has content ---- */
const { modules } = readModules(html);
ok('MODULES parses', Array.isArray(modules) && modules.length > 0);
ok('every module has an id', modules.every((m) => typeof m.id === 'string' && m.id));
ok('every module has cards', modules.every((m) => Array.isArray(m.cards) && m.cards.length));
const cards = modules.flatMap((m) => m.cards);
// All six render differently but every one of them voices `c.spoken || c.es` through the same
// playCard(), which is why the collector walks cards without caring about the type. A NEW type
// appearing here is the signal to re-read playCard() before trusting the clip map.
ok('every card has a known type', cards.every((c) => ['say', 'hear', 'answer', 'do', 'find', 'letter'].includes(c.t)));
ok('every card has spanish text', cards.every((c) => typeof c.es === 'string' && c.es.trim()));
ok('every answer card has a reply', cards.filter((c) => c.t === 'answer').every((c) => c.reply && c.reply.es));

/* ---- 2. the privacy fix (W1) holds ---- */
ok('no hardcoded child name anywhere in the file', !/Skylin/i.test(html));
ok('DEF ships an empty name', /const DEF = \{name:"",/.test(html));
ok('the {NAME} machinery survives', html.includes('{NAME}') && html.includes('S.name'));
ok('no spoken string carries a name placeholder', collect(html).every((it) => !it.text.includes('{')));

/* ---- 3. placeholder expansion ---- */
ok('{A} expands to both genders', expand('Estoy content{A}').join('|') === 'Estoy contenta|Estoy contento');
ok('{E} expands to e', expand('Estoy trist{E}')[0] === 'Estoy triste');
ok('{AGE} expands to the word', expand('Tengo {AGE} años')[0] === 'Tengo cinco años');
ok('{NAME} is dropped, never voiced', expand('Me llamo {NAME}')[0].trim() === 'Me llamo');

/* ---- 4. the key functions agree. THIS is the drift gate. ---- */
const pageKeyFn = html.match(/function clipKey\(s\)\{([^}]*)\}/);
ok('rumi-espanol-app.html defines clipKey', Boolean(pageKeyFn));
if (pageKeyFn) {
  // eslint-disable-next-line no-new-func
  const clipKey = new Function('s', pageKeyFn[1]);
  const items = collect(html);
  const disagree = items.filter((it) => clipKey(it.text) !== normalizeKey(it.text));
  ok('page clipKey agrees with generator normalizeKey on every string', disagree.length === 0);
  if (disagree.length) fails.push(`  first disagreement: "${disagree[0].text}"`);
  // and on the shapes the runtime actually hands it, which are fill()'s output
  ok('keys survive stray whitespace', clipKey('  Me llamo   ') === normalizeKey('Me llamo'));
  ok('keys are case-folded', clipKey('HOLA') === normalizeKey('hola'));
}

/* ---- 5. every fixed string in the code is one we enumerate ---- */
const items = collect(html);
const keys = new Set(items.map((it) => it.key));
for (const s of FIXED_STRINGS) ok(`fixed string enumerated: ${s}`, keys.has(normalizeKey(s)));
const spokenCalls = [...html.matchAll(/\bspeak\(\s*"([^"]+)"/g)].map((m) => m[1]);
const unenumerated = spokenCalls.filter((s) => !keys.has(normalizeKey(s)));
ok('no literal speak() call is missing from the string list', unenumerated.length === 0);
if (unenumerated.length) fails.push(`  unenumerated: ${unenumerated.join(' | ')}`);

/* ---- 6. the fallback path is intact. A clip miss must never be fatal. ---- */
ok('speakSynth still exists', html.includes('function speakSynth(text, finish)'));
ok('speak falls through to speakSynth', /speakSynth\(text, finish\);\s*\n\}/.test(html));
ok('a decode failure falls back', html.includes('.catch(() => { if(speaking) speakSynth(text, finish); })'));
ok('turtle speed never uses a clip', html.includes('(S.speed === "turtle") ? null : clipFor(text)'));
ok('stopSpeech stops a playing clip', /function stopSpeech\(\)\{[\s\S]*?stopClip\(\);/.test(html));
ok('clipFor refuses without an AudioContext', /function clipFor\(text\)\{[\s\S]*?!actx\) return null;/.test(html));

/* ---- 7. the embed tag is well-formed whether or not it is filled ---- */
const tag = html.match(/<script id="rumiClips">([\s\S]*?)<\/script>/);
ok('the clip tag exists', Boolean(tag));
if (tag) {
  ok('the clip tag assigns window.RUMI_CLIPS', tag[1].startsWith('window.RUMI_CLIPS = {'));
  ok('the clip tag is one statement', tag[1].trim().endsWith('};'));
  ok('no clip value is empty', !/:""/.test(tag[1]));
}

/* ---- 8. the two runtime defects found on 2026-08-20, each with a standing gate ----
   Both shipped in the Cowork payload, both were invisible to node --check, and both were
   total: one clipped every tile title away, the other threw on every tile tap so the app
   could never leave its home screen. */
ok('grid rows are pinned to max-content, so tiles cannot collapse',
  /\.grid\{[\s\S]*?grid-auto-rows:max-content/.test(html));
{
  // The crash was `modName.textContent = ...` wiping <small id="modEn"> before it was read.
  const nested = /<div class="mname" id="modName">[^<]*<small id="modEn">/.test(html);
  ok('modEn is still nested inside modName (the condition that made this a bug)', nested);
  ok('modName is never assigned textContent while modEn lives inside it',
    !/getElementById\("modName"\)\.textContent\s*=/.test(html));
  ok('openModule writes modEn before touching the parent text node',
    /getElementById\("modEn"\)\.textContent = cur\.en;[\s\S]{0,200}firstChild/.test(html));
}

/* ---- 9. Rumi must open with no credential ----
   RUMI2, 2026-08-21. This used to read quick-tools' middleware.js and assert that its Basic Auth
   matcher did not catch '/rumi'. That file does not exist here and neither does any other gate:
   this repo has no middleware, no auth, and Vercel Authentication is disabled on the project. So
   the assertion keeps its intent — a five-year-old must never meet a login screen — and changes
   its evidence to match the new home. It is now stricter than the old one, because it forbids a
   gate from appearing at all rather than checking that one list omits one path. */
{
  const gateFiles = ['middleware.js', 'middleware.ts', '_middleware.js'].filter((f) => fs.existsSync(path.join(ROOT, f)));
  ok('no middleware file exists (the user is five — she must never meet a login screen)', gateFiles.length === 0);

  const vercelPath = path.join(ROOT, 'vercel.json');
  const vercel = fs.existsSync(vercelPath) ? JSON.parse(fs.readFileSync(vercelPath, 'utf8')) : {};
  // A `has`/`missing` condition on a rewrite is how a cookie or header gate gets added without a
  // middleware file, so it is checked rather than assumed absent.
  const conditional = [...(vercel.rewrites || []), ...(vercel.redirects || [])].filter((r) => r.has || r.missing);
  ok('no rewrite or redirect is conditional on a cookie or header', conditional.length === 0);
}

/* ================= RUMI3: no reading required =================
   The user is five and pre-literate, so every English sentence that gates an action is a
   blank card to her. These assertions hold that line. The one that earns the file is the
   emoji-collision check: once the HEAR options became pictures, two options sharing a glyph
   stopped being "hard" and became UNANSWERABLE, and the shipped data really does contain
   repeated glyphs across modules. */

/* --- D: buildOptions can never return two options sharing an emoji --- */
{
  const src = html.match(/function buildOptions\(c\)\{([\s\S]*?)\n\}/);
  ok('rumi-espanol-app.html defines buildOptions', Boolean(src));
  if (src) {
    // Run the page's own function against the real corpus, with the globals it closes over.
    const make = new Function('MODULES', 'cur', 'fill', `return function buildOptions(c){${src[1]}\n}`);
    const fillStub = (s) => String(s == null ? '' : s).replace(/\{NAME\}/g, '').replace(/\{AGE\}/g, 'cinco')
      .replace(/\{A\}/g, 'a').replace(/\{E\}/g, 'e');
    let collisions = 0, answerMissing = 0, checked = 0;
    // Deterministic across many draws: the function shuffles, so one pass proves little.
    for (let round = 0; round < 40; round += 1) {
      for (const m of modules) {
        const fn = make(modules, m, fillStub);
        for (const c of m.cards.filter((x) => x.t === 'hear')) {
          const opts = fn(c);
          checked += 1;
          const emos = opts.map((o) => o.emo);
          if (new Set(emos).size !== emos.length) collisions += 1;
          if (opts.filter((o) => o.correct).length !== 1) answerMissing += 1;
        }
      }
    }
    ok(`no HEAR card can render two options sharing an emoji (${checked} draws)`, collisions === 0);
    ok('every HEAR card renders exactly one correct option', answerMissing === 0);
    if (collisions) fails.push(`  ${collisions} of ${checked} draws collided`);
  }
}

/* --- A1: the HEAR option is a picture, and the English is demoted, not deleted --- */
ok('HEAR options render the emoji big and the English as a caption',
  html.includes('<span class="oe">') && html.includes('<span class="ow">'));
ok('the English caption survives for the adult in the room', /\.opt \.ow\{/.test(html));

/* --- A2/A3 + C: instruction is a glyph that moves, not a sentence --- */
ok('a state glyph exists and is installed centrally', /function installState\(c\)\{/.test(html));
ok('every card type has a start glyph',
  ['say', 'hear', 'find', 'do', 'letter', 'answer'].every((t) => new RegExp(`${t}:"`).test(html.match(/const START = \{[^}]*\}/)[0])));
ok('the glyph animates, so it reads as "touch this"', /\.state\.go,\.bigemo\.go\{animation:bob/.test(html));
// A hear/find card's hero emoji IS the instruction, so it animates in place rather than
// having a second, smaller copy of the same picture stacked underneath it.
ok('a card whose hero emoji is already the instruction does not duplicate it',
  /hero\.textContent\.trim\(\) === glyph/.test(html));

/* --- A4/A5/A6: no English word gates an action --- */
// Assert on the ASSIGNMENT, not on the bare string. The old labels still appear in comments
// that record what each control used to be, and that history is worth more than a grep that
// is easy to satisfy by deleting a comment.
for (const banned of ['SIGUIENTE →', 'A CASA 🏠', 'Show me 👀', '¡Lo hice! ⭐']) {
  const rendered = new RegExp(`(textContent|innerHTML)\\s*=\\s*"${banned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`);
  ok(`no text-gated control rendered: ${banned}`, !rendered.test(html) && !html.includes(`>${banned}<`));
}
ok('the advance control is a glyph', /id="nextBtn"[^>]*>▶︎</.test(html));
ok('its two states differ by colour as well as glyph', /\.next\.go\{background:var\(--green\)/.test(html));

/* --- A7/A8: the home screen structures itself with pictures --- */
ok('section headers carry a glyph', /const GROUP_ICON = \{/.test(html) && /class="sicon"/.test(html));
ok('every group in MODULES has an icon', (() => {
  const map = html.match(/const GROUP_ICON = \{([^}]*)\}/)[1];
  return [...new Set(modules.map((m) => m.group))].every((g) => map.includes(`"${g}"`));
})());
ok('the EARS/MOUTH pill is emoji only', !html.includes('👂 EARS') && !html.includes('👄 MOUTH'));
ok('the pill keeps its meaning for a screen reader',
  /aria-label="' \+\s*\n?\s*\(m\.ears \? "listening" : "speaking"\)/.test(html));

/* --- W2: audio twins --- */
ok('tapping a home tile speaks the module name', /b\.onclick = \(\) => \{ speak\(m\.es\); openModule/.test(html));
ok('module Spanish names are in the clip corpus', (() => {
  const keys = new Set(collect(html).map((i) => i.key));
  return modules.every((m) => keys.has(normalizeKey(m.es)));
})());
ok('a correct answer plays the English once', /function sayEnglishOnce\(c\)\{/.test(html));
ok('both reveal paths call it', (html.match(/sayEnglishOnce\(c\)/g) || []).length >= 3);

/* --- the English cue channel is separate from the Spanish one --- */
ok('CUES is its own map', /const CUES = \(window\.RUMI_CUES/.test(html));
ok('the cue tag is separate from the clip tag',
  html.includes('<script id="rumiCues">') && html.includes('<script id="rumiClips">'));
ok('the decoder namespaces its cache so the two maps cannot collide',
  /const cacheKey = \(ns \|\| "es"\) \+ "\|" \+ k;/.test(html));
ok('English help fires on IDLE, not on arrival', /const IDLE_MS = 5000;/.test(html) && /armIdleHelp/.test(html));
ok('any tap stands the help line down', /addEventListener\("pointerdown", cancelIdleHelp, true\)/.test(html));
ok('help never talks over Rumi', /if\(speaking\)\{ armIdleHelp\(c\); return; \}/.test(html));
ok('every CUE_KEY has a generated line', (() => {
  const keys = html.match(/const CUE_KEY = \{([\s\S]*?)\};/)[1];
  const wanted = [...keys.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  return wanted.length >= 6 && wanted.every((w) => HELP_LINES.some((h) => normalizeKey(h) === w));
})());

/* ---- RUMI3b: the clip cache must be keyed on the VOICE and RATE, not just the phrase ----
   Caught live on 2026-08-21 while switching Elvira -> Ximena. With the phrase alone in the
   hash, every clip of the old voice is reused: the generator reports "reused 228", the run
   takes two seconds, and the page ships the previous voice with nothing anywhere saying so.
   This is the single most dangerous shape of bug in this app — the audio is plausible, the
   child hears the wrong thing, and no gate that checks counts or sizes would notice. */
{
  const audio = fs.readFileSync(path.join(ROOT, 'scripts/rumi-audio.mjs'), 'utf8');
  const cues = fs.readFileSync(path.join(ROOT, 'scripts/rumi-cues.mjs'), 'utf8');
  ok('spanish clip filenames are keyed on voice and rate', /\$\{VOICE\}\|\$\{RATE_OFFSET\}\|/.test(audio));
  ok('english cue filenames are keyed on voice and rate', /\$\{VOICE\}\|\$\{RATE_OFFSET\}\|/.test(cues));
  ok('the two generators use different voices', (() => {
    const a = audio.match(/export const VOICE = '([^']+)'/)[1];
    const c = cues.match(/export const VOICE = '([^']+)'/)[1];
    return a !== c && a.startsWith('es-') && c.startsWith('en-');
  })());
  // The rabbit multiplier has to move whenever the base rate does, or "fast" stops being fast.
  const rate = Number(audio.match(/export const RATE_OFFSET = '([-+]?\d+)%'/)[1]);
  const rabbit = Number(html.match(/const RABBIT_PLAYBACK = ([\d.]+);/)[1]);
  const effective = (1 + rate / 100) * rabbit;
  ok(`rabbit is faster than walk but not chipmunked (base ${rate}%, x${rabbit} -> ${Math.round((effective - 1) * 100)}%)`,
    rabbit > 1 && effective > 1 + rate / 100 && rabbit <= 1.35);
}

console.log(`${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  FAIL  ${f}`);
process.exit(fails.length ? 1 : 0);
