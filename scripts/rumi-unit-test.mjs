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
import { collect, normalizeKey, expand, readModules, FIXED_STRINGS, needsGloss, readGlyphs, collectCues } from './rumi-strings.mjs';
import { HELP_LINES, collectEnglish } from './rumi-cues.mjs';
import { wordSpans, wordSpansFromMarks, spanMap } from './rumi-words.mjs';
import { PACK_VOICES, packIndexPath, packClipPath } from './rumi-voices.mjs';
import { alignmentFromSpans } from './rumi-seed-cache.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'rumi-espanol-app.html'), 'utf8');

/* ---- the ONE allowance in this file, and it is named, dated and self-cleaning ----
 *
 * TRACE1, 2026-08-24. The English bank is normally required to hold every string
 * collectEnglish() finds, with zero misses and zero orphans, and that pair of assertions is
 * what keeps the bank and the corpus from drifting apart. This lane added a module and could
 * not record its clip: it had no outbound network at all — every TLS connection from the
 * machine was reset, measured against github.com, example.com and 1.1.1.1 — so edge-tts could
 * not reach speech.platform.bing.com and no audio of any kind could be generated.
 *
 * WHY THIS PARTICULAR MISS IS SAFE, stated so it can be checked rather than trusted: `numbers`
 * is the `en` of the new números module, and a module's English name is never spoken anywhere
 * in this app. Grep the page for m.en: it appears three times, all of them text — the home
 * tile caption, the module header, and the phrasebook table. No speech path reads it. The
 * collector picks it up because collectEnglish() adds every m.en (its comment claims it is
 * "spoken on the reveal path", which is not true of the shipped code — see the DEFECTS section
 * of done-2026-08-24-rumi-trace1-trace-the-letters.md).
 *
 * CLEAR IT by running `npm run rumi:cues && npm run rumi:embed` on a machine with network and
 * deleting the entry. The assertion below fails if you record it and forget to delete it. */
/* Cleared 2026-09-15 (RUMIVOICE1 phase B): the whole English bank was re-rendered on a machine
 * with network, so "numbers" has its recording and the set is empty. The assertions below still
 * stand, for the next string that arrives before its clip does. */
const PENDING_CUES = new Set();

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
ok('every card has a known type', cards.every((c) => ['say', 'hear', 'answer', 'do', 'find', 'letter', 'num'].includes(c.t)));
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
ok('{AGE} expands to the word', expand('Tengo {AGE} años').includes('Tengo cinco años'));
/* 2026-09-23, found by a live smoke test: only age five was ever recorded, so a grown-up who
 * set any other age got the robotic device voice on that one card — and silence on the iPad
 * this app exists for, which has no Spanish voice at all. Every age the app can say has to be
 * a line the generator records. AGEWORD in the page is the list of ages the app can say. */
{
  const m = html.match(/const AGEWORD = \{([^}]*)\}/);
  const range = html.match(/for\(let i = (\d+); i <= (\d+); i\+\+\)/);
  ok('the page defines the ages it can say', Boolean(m) && Boolean(range));
  const lookup = m ? Object.fromEntries(m[1].split(',').map((p) => {
    const [n, w] = p.split(':');
    return [n.trim(), w.replace(/["']/g, '').trim()];
  })) : {};
  /* The ages the GROWN-UPS SCREEN offers, not every key in the lookup: the lookup also holds 1,
   * which the picker never offers and which would be spoken as "Tengo un años". */
  const ageWords = range
    ? Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_v, i) => lookup[String(Number(range[1]) + i)])
    : [];
  const spoken = expand('Tengo {AGE} años');
  ok(`{AGE} expands to every age the app offers (${spoken.length} of ${ageWords.length})`,
     ageWords.length > 1 && ageWords.every((w) => spoken.includes(`Tengo ${w} años`)),
     `expanded: ${spoken.join(' | ')}`);
  const corpus = new Set(collect(html).map((it) => normalizeKey(it.text)));
  const missing = ageWords.filter((w) => !corpus.has(normalizeKey(`Tengo ${w} años`)));
  ok(`every age the app offers is in the recorded corpus (${ageWords.length - missing.length} of ${ageWords.length})`,
     missing.length === 0, `no line for: ${missing.join(', ')}`);

  /* The assertion above proves the COLLECTOR emits the line. That is the weaker half: a line in
   * the corpus with no recording behind it still falls through to the device voice, which is the
   * exact failure this whole change exists to end. So the page's own bank and each downloadable
   * voice's index are read here, and every age has to have a real clip in all five.
   * Added 2026-11 by RUMIAGE2; observed failing on all five voices before the render. */
  const clipTag = html.match(/<script id="rumiClips">window\.RUMI_CLIPS = ([\s\S]*?);<\/script>/);
  ok('the embedded bank parses, so its coverage can be checked', Boolean(clipTag));
  if (clipTag) {
    const shipped = JSON.parse(clipTag[1]);
    const noClip = ageWords.filter((w) => typeof shipped[normalizeKey(`Tengo ${w} años`)] !== 'string');
    ok(`every age the app offers has a clip in the page (${ageWords.length - noClip.length} of ${ageWords.length})`,
       ageWords.length > 1 && noClip.length === 0, `silent ages: ${noClip.join(', ')}`);
    /* And in every voice a grown-up can switch to. A pack short of an age is that age going quiet
     * the moment the voice changes, which is the same defect wearing a different name. */
    for (const v of PACK_VOICES) {
      const indexFile = path.join(ROOT, packIndexPath(v.slug));
      if (!fs.existsSync(indexFile)) { ok(`${v.name}'s pack index exists`, false); continue; }
      const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
      const gaps = ageWords.filter((w) => {
        const rec = index.clips && index.clips[normalizeKey(`Tengo ${w} años`)];
        return !rec || typeof rec.file !== 'string'
          || !fs.existsSync(path.join(ROOT, packClipPath(v.slug, rec.file)));
      });
      ok(`every age the app offers has a clip in ${v.name}'s pack (${ageWords.length - gaps.length} of ${ageWords.length})`,
         ageWords.length > 1 && gaps.length === 0, `silent ages: ${gaps.join(', ')}`);
    }
  }
}
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
/* Three ways in, and all three must stay: turtle, a clip the bank does not have, and a
   decode or a route that failed. A clip miss has never been allowed to be fatal. */
ok('speak falls through to speakSynth on a clip miss',
   /if\(!k\)\{ speakSynth\(text, finish\); return; \}/.test(html));
ok('a decode failure falls back',
   html.includes('.catch(() => { if(speaking && gen === speechGen) speakSynth(text, finish); })'));
/* RUMIVOICE1 retired "turtle speed never uses a clip": turtle now plays the real recording word
   by word when the line has timing. What stays is the fallback — with a device voice and no
   timing, turtle is still the device voice, exactly as before. */
ok('turtle uses the device voice only when it has one and the line has no timing',
   html.includes('if(!CLIP_COUNT || (sp === "turtle" && voice && !hasTiming(text))){ speakSynth(text, finish); return; }'));
ok('stopSpeech stops a playing clip', /function stopSpeech\(\)\{[\s\S]*?stopClip\(\);/.test(html));
ok('clipFor refuses without a RUNNING context',
   /function clipFor\(text\)\{[\s\S]*?!audioReady\(\)\) return null;/.test(html));

/* ---- 6b. the three ways the app went silent, 2026-08-30, each with a standing gate ----

   Whit: "i'm getting no sound in rumi at all." Three independent causes, all of which
   survived a reload. Every one of them is a runtime condition that neither this suite nor
   ci-check could observe directly, so what is held here is the SHAPE of each fix. A
   structural assertion is a weak proxy for a behavioural one; scripts/rumi-audio-smoke.mjs
   is the test that actually drives a browser, and it is the one that would have caught
   these. These exist so that a future edit cannot quietly delete a fix and stay green. */

/* ONE: a suspended or interrupted context must always be revivable. */
ok('ensureAudio exists', html.includes('function ensureAudio()'));
ok('audioReady demands a running context',
   /function audioReady\(\)\{ return !!actx && actx\.state === "running"; \}/.test(html));
ok('exactly one place constructs an AudioContext',
   (html.match(/new AC\(\)/g) || []).length === 1);
ok('the only construction site is ensureAudio',
   /function ensureAudio\(\)\{[\s\S]*?new AC\(\)/.test(html));
ok('resume is reachable outside the unlock overlay',
   /addEventListener\("pointerdown", \(\) => \{\s*ensureAudio\(\);/.test(html));
ok('coming back into view revives the audio',
   /addEventListener\("visibilitychange"[\s\S]*?\}else\{\s*ensureAudio\(\);/.test(html));
/* RUMIVOICES2, 2026-09-16: this went red on a correct build and had to be retuned rather than
   deleted. The rule it holds is unchanged — speak() must not conclude it has no clip until the
   audio route has actually been revived, because concluding early falls through to a device
   voice the target iPad does not have. What changed is what comes FIRST: speak() now also waits
   on voiceReady, so a voice chosen in Grown-ups is restored from the device before the first
   word. The shape is `voiceReady.then(() => ensureAudio()).then(` instead of `ensureAudio().then(`.
   Both are accepted below, and both satisfy the original rule; a build that decides synchronously
   still fails. */
ok('speak WAITS for the revived context before deciding it has no clip',
   /function speak\(text, done\)\{[\s\S]*?(?:voiceReady\.then\(\(\) => ensureAudio\(\)\)|ensureAudio\(\))\.then\(/.test(html));
ok('speak also waits for a voice saved in Grown-ups, so the first word after a reload is hers',
   /function speak\(text, done\)\{[\s\S]*?voiceReady\.then\(\(\) => ensureAudio\(\)\)\.then\(/.test(html));
ok('ensureAudio reports a promise, because resume() is async',
   /return p\.then\(\(\) => \{ syncMuteButton\(\); return audioReady\(\); \}, \(\) => false\);/.test(html));
ok('a clip that never ends still finishes the card',
   /let guard = setTimeout\(\(\) => \{[\s\S]*?finish\(\);/.test(html));
ok('the watchdog cannot fire for cancelled speech',
   /guard = null;\s*if\(gen !== speechGen\) return;/.test(html));

/* TWO: the iOS ring/silent switch. The element IS the workaround. */
ok('the silent keepalive element exists', /<audio id="silentLoop"/.test(html));
ok('the keepalive loops', /<audio id="silentLoop"[^>]*\sloop\b/.test(html));
ok('the keepalive is inline, not fullscreen', /<audio id="silentLoop"[^>]*\splaysinline\b/.test(html));
ok('the keepalive carries real audio data', /<audio id="silentLoop"[\s\S]{0,200}src="data:audio\/wav;base64,[A-Za-z0-9+/=]{200,}"/.test(html));
ok('the keepalive is released when muted', /function keepaliveOn\(\)\{[\s\S]*?if\(!el \|\| S\.muted\) return;/.test(html));
ok('the keepalive is released when hidden',
   /if\(document\.hidden\)\{[\s\S]*?keepaliveOff\(\);/.test(html));

/* THREE: turtle must never be the reason the app is silent. */
ok('turtleUsable exists', html.includes('function turtleUsable()'));
ok('turtle degrades to walk rather than to silence',
   /function effectiveSpeed\(\)\{\s*return \(S\.speed === "turtle" && !turtleUsable\(\)\) \? "walk" : S\.speed;/.test(html));
ok('the stored speed is never rewritten underneath her',
   !/S\.speed = "walk"; save\(\)/.test(html));
ok('an undeliverable turtle button is disabled',
   /b\.disabled = isTurtle && !turtleOk;/.test(html));

/* The mute control Whit asked for alongside the switch workaround. */
ok('a mute control exists on both screens', (html.match(/<button class="mute"/g) || []).length === 2);
ok('mute is persisted', /const DEF = \{[^}]*muted:false/.test(html));
/* Was a fixed count of 3. RUMIVOICE1 added a fourth player (the word-by-word read), and a fixed
   count would have let a fifth player skip the gain node the day someone also removed one. So:
   every buffer source except the one-sample primer connects through outputNode(). */
ok('every clip plays through the master gain',
   (html.match(/src\.connect\(outputNode\(\)\)/g) || []).length
     === (html.match(/actx\.createBufferSource\(\)/g) || []).length - 1);
ok('nothing but the gain node and the primer touches destination raw',
   (html.match(/connect\(actx\.destination\)/g) || []).length === 2);
/* Muting by gain and by utterance volume — never by refusing to play — is what keeps the
   completion chain (sandwich, stroke instruction, auto-advance) identical when muted. */
ok('muting a clip is a gain change', /masterGain\.gain\.value = S\.muted \? 0 : 1;/.test(html));
ok('muting the device voice is a volume change', /u\.volume = S\.muted \? 0 : 1;/.test(html));
ok('a blocked mute button revives instead of toggling',
   /if\(!audioReady\(\) && !S\.muted\)\{ ensureAudio\(\); syncMuteButton\(\); return; \}/.test(html));

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
    let collisions = 0, answerMissing = 0, checked = 0, sayMissing = 0;
    // Deterministic across many draws: the function shuffles, so one pass proves little.
    for (let round = 0; round < 40; round += 1) {
      for (const m of modules) {
        const fn = make(modules, m, fillStub);
        for (const c of m.cards.filter((x) => x.t === 'hear')) {
          const opts = fn(c);
          checked += 1;
          /* RUMI L7: an option that cannot say itself in Spanish is the bug this whole
             change exists to remove — it would send her back to reading the English. */
          if (opts.some((o) => !o.say || !String(o.say).trim())) sayMissing += 1;
          const emos = opts.map((o) => o.emo);
          if (new Set(emos).size !== emos.length) collisions += 1;
          if (opts.filter((o) => o.correct).length !== 1) answerMissing += 1;
        }
      }
    }
    ok(`no HEAR card can render two options sharing an emoji (${checked} draws)`, collisions === 0);
    ok('every HEAR card renders exactly one correct option', answerMissing === 0);
    ok('every option can speak itself in Spanish', sayMissing === 0);
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
/* RUMI L4 widened this check: the beats inside the sandwich are silent on purpose, and
   the help line must not mistake them for "stuck". */
ok('help never talks over Rumi (or over a sandwich beat)', /if\(speaking \|\| glossing\)\{ armIdleHelp\(c\); return; \}/.test(html));
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

/* ================= RUMI L4: phrases get an English voice =================
   Whit's ruling, 2026-08-22: single words can be Spanish-only, phrases cannot. These
   assertions hold the three invariants that make it safe: generator and runtime agree on
   WHICH cards gloss, every gloss the runtime can ask for is really in the bank, and the
   sandwich retires (star) and ends in Spanish (what she repeats). */
{
  /* --- drift gate #2: needsGloss agrees between generator and runtime --- */
  const src = html.match(/function needsGloss\(card\)\{([^}]*)\}/);
  ok('rumi-espanol-app.html defines needsGloss', Boolean(src));
  const pageNeedsGloss = src ? new Function('card', src[1]) : null;
  if (pageNeedsGloss) {
    const subjects = [];
    for (const c of cards) {
      subjects.push(c);
      if (c.reply) subjects.push({ t: 'reply', es: c.reply.es, gloss: c.reply.gloss });
    }
    const disagree = subjects.filter((s) => Boolean(pageNeedsGloss(s)) !== Boolean(needsGloss(s)));
    ok(`page needsGloss agrees with generator needsGloss on every card and reply (${subjects.length} subjects)`, disagree.length === 0);
    if (disagree.length) fails.push(`  first disagreement: "${disagree[0].es}"`);

    const singles = cards.filter((c) => c.gloss === undefined && String(c.es).trim().split(/\s+/).filter(Boolean).length < 2);
    ok(`no untagged single-word card ever glosses (${singles.length} cards)`, singles.length > 0 && singles.every((c) => !pageNeedsGloss(c)));
    ok('letter cards are never glossed', cards.filter((c) => c.t === 'letter').every((c) => !pageNeedsGloss(c)));
    ok('an explicit gloss:true wins over the token rule', pageNeedsGloss({ t: 'say', es: 'uno', gloss: true }) === true);
    ok('an explicit gloss:false wins over the token rule', pageNeedsGloss({ t: 'say', es: 'dos palabras', gloss: false }) === false);
  }

  /* --- the bank: zero misses, zero orphans --- */
  const cueTag = html.match(/<script id="rumiCues">window\.RUMI_CUES = ([\s\S]*?);<\/script>/);
  ok('the English bank is embedded and populated', Boolean(cueTag));
  if (cueTag) {
    const bank = new Set(Object.keys(JSON.parse(cueTag[1])));
    const wanted = collectEnglish(html);
    const missing = wanted.filter((it) => !bank.has(it.key));
    const unexpected = missing.filter((it) => !PENDING_CUES.has(it.key));
    ok(`every English string the gate collects is in the bank — zero misses (${wanted.length} wanted, ${PENDING_CUES.size} named pending)`, unexpected.length === 0);
    if (unexpected.length) fails.push(`  first miss: "${unexpected[0].text}"`);
    // Self-cleaning: the moment a pending key is actually recorded, this fails until the name
    // is deleted from the list above. An allowance that outlives its reason is how a gate rots.
    const stale = [...PENDING_CUES].filter((k) => bank.has(k));
    ok(`no PENDING_CUES entry is already recorded (${PENDING_CUES.size} pending)`, stale.length === 0);
    if (stale.length) fails.push(`  recorded but still listed as pending: ${stale.join(', ')} — delete it from PENDING_CUES`);
    for (const k of PENDING_CUES) console.log(`  PENDING  english clip not recorded: "${k}" — run npm run rumi:cues && npm run rumi:embed`);
    const wantedKeys = new Set(wanted.map((it) => it.key));
    const orphans = [...bank].filter((k) => !wantedKeys.has(k));
    ok(`no orphan English clip that no card can ask for (${bank.size} in bank)`, orphans.length === 0);
    if (orphans.length) fails.push(`  first orphan: "${orphans[0]}"`);

    /* and through the page's OWN lookup: every glossed card and reply lands on a clip,
       so the sandwich can actually play rather than degrading everywhere. */
    const gk = html.match(/function glossKey\(en\)\{([\s\S]*?)\n\}/);
    ok('rumi-espanol-app.html defines glossKey', Boolean(gk));
    if (gk) {
      const pageGlossKey = new Function('en', 'clipKey', gk[1]);
      const glossed = [];
      for (const c of cards) {
        if (needsGloss(c)) glossed.push(c.en);
        if (c.reply && needsGloss({ t: 'reply', es: c.reply.es, gloss: c.reply.gloss })) glossed.push(c.reply.en);
      }
      const unreachable = glossed.filter((en) => {
        const k = pageGlossKey(en, normalizeKey);
        return !k || !bank.has(k);
      });
      ok(`every glossed card and reply reaches a real clip (${glossed.length} glosses)`, glossed.length > 0 && unreachable.length === 0);
      if (unreachable.length) fails.push(`  first unreachable: "${unreachable[0]}"`);
    }
  }

  /* --- the sandwich shape, EXECUTED with the page's own function --- */
  const ss = html.match(/function speakSandwich\(text, enKey, done\)\{([\s\S]*?)\n\}/);
  ok('rumi-espanol-app.html defines speakSandwich', Boolean(ss));
  if (ss) {
    const run = (enKey) => {
      const calls = [];
      const speakStub = (t, cb) => { calls.push('es'); if (cb) cb(); };
      const cueStub = (k, cb) => { calls.push('en'); if (cb) cb(); };
      const timeoutStub = (fn) => { fn(); return 0; };
      const fn = new Function('text', 'enKey', 'done', 'speak', 'playCueDone', 'setTimeout', 'GLOSS_GAP_MS', 'glossing', 'glossTimer', ss[1]);
      fn('hola amigo', enKey, null, speakStub, cueStub, timeoutStub, 0, false, null);
      return calls;
    };
    const sandwich = run('some-key');
    ok('the sandwich is Spanish, English once, Spanish', sandwich.join(',') === 'es,en,es');
    ok('the last thing she hears is Spanish', sandwich[sandwich.length - 1] === 'es');
    ok('no gloss key means plain Spanish, once', run(null).join(',') === 'es');
  }

  /* --- the two retirement gates live where the key is chosen --- */
  const sk = html.match(/function sandwichKeyFor\(c\)\{([\s\S]*?)\n\}/);
  ok('rumi-espanol-app.html defines sandwichKeyFor', Boolean(sk));
  if (sk) {
    ok('a card that does not need a gloss never sandwiches', /if\(!needsGloss\(c\)\) return null;/.test(sk[1]));
    ok('a starred card never sandwiches', /\(S\.stars\[cur\.id\] \|\| \[\]\)\.indexOf\(idx\) >= 0\) return null;/.test(sk[1]));
  }

  /* --- wiring --- */
  ok('playCard speaks through the sandwich', /speakSandwich\(spokenOf\(c\), sandwichKeyFor\(c\),/.test(html));
  ok('the reveal decides the reply sandwich BEFORE markDone stars the card',
    /const firstMeeting = \(S\.stars\[cur\.id\] \|\| \[\]\)\.indexOf\(idx\) < 0;[\s\S]{0,900}markDone\(\);/.test(html));
  ok('the reply sandwich goes through the same needsGloss rule',
    /needsGloss\(\{t:"reply", es:c\.reply\.es, gloss:c\.reply\.gloss\}\)/.test(html));

  /* --- W3b: the repeat control, emoji only --- */
  ok('the repeat control is emoji only', /b\.textContent = "🇬🇧";/.test(html) && html.includes('className = "glossbtn"'));
  ok('the repeat control renders only on cards whose gloss is really in the bank',
    /const k = needsGloss\(c\) \? reachableGlossKey\(c\.en\) : null;\s*\n\s*if\(!k\) return;/.test(html));
  ok('every card builder offers the repeat control (say, hear, find, do, answer)',
    (html.match(/addGlossBtn\(row, c\);/g) || []).length === 5);
  ok('the repeat control keeps its meaning for a screen reader', html.includes('"hear what it means in English"'));
}

/* ================= TRACE1, 2026-08-24: tracing, and the cues are Spanish =================
   Three things are held here. The stroke dataset is well-formed; every card that claims a
   trace can actually get one; and Rumi's copy of the shared geometry still agrees, field by
   field, with the file that authored it. */
{
  const glyphs = readGlyphs(html);
  const keys = Object.keys(glyphs);
  ok('the stroke geometry block is present and populated', keys.length >= 60);

  /* --- the dataset is well-formed. A malformed stroke renders a perfect page and traces
         nothing, or worse, traces something backwards. --- */
  const strokes = keys.flatMap((k) => (glyphs[k].strokes || []).map((s) => ({ k, s })));
  ok(`every stroke has a path, a start point, an order and a direction (${strokes.length} strokes)`,
    strokes.length > 0 && strokes.every(({ s }) => typeof s.path === 'string' && /^M /.test(s.path)
      && Array.isArray(s.start) && s.start.length === 2 && Number.isFinite(s.order) && typeof s.direction === 'string'));
  ok('every glyph numbers its strokes 1..n in order',
    keys.every((k) => glyphs[k].strokes.every((s, i) => s.order === i + 1)));
  ok('every glyph carries a minAge, so the age gate can never read undefined',
    keys.every((k) => typeof glyphs[k].minAge === 'number' && glyphs[k].minAge > 0));
  /* The declared start point must BE the start of the path. When it is not, the numbered dot
     sits somewhere the stroke does not begin and the app teaches a start point that is a lie —
     one of the two defects the letters CI was proven red against. */
  const liars = strokes.filter(({ s }) => {
    const m = s.path.match(/^M\s+(-?[\d.]+)\s+(-?[\d.]+)/);
    return !m || Math.abs(Number(m[1]) - s.start[0]) > 0.5 || Math.abs(Number(m[2]) - s.start[1]) > 0.5;
  });
  ok('every declared start point is where its path actually starts', liars.length === 0);
  if (liars.length) fails.push(`  first liar: ${liars[0].k} stroke ${liars[0].s.order}`);

  /* --- the cues. They are the teaching, not labels. --- */
  ok('every stroke carries a cue', strokes.every(({ s }) => typeof s.cue === 'string' && s.cue.trim()));
  // Spanish, not the English the geometry arrived with. Checked on characters and function
  // words rather than on a word list, so it cannot be satisfied by one translated string.
  const english = strokes.filter(({ s }) => /\b(down|line|across|curve|around|slide|bump|dot|the|and)\b/i.test(s.cue || ''));
  ok('no stroke cue is still in English', english.length === 0);
  if (english.length) fails.push(`  first English cue: "${english[0].s.cue}" on ${english[0].k}`);
  ok('the Spanish cues are enumerated for the audio pipeline',
    collectCues(html).length > 0 && collect(html).length > collectCues(html).length);
  {
    // BYTE-IDENTICAL REPETITION IS THE MECHANISM. The same stroke on two glyphs must carry the
    // same words: a child guiding her own hand out loud only benefits if the words do not move.
    const byDirection = new Map();
    for (const { s } of strokes) {
      const sig = `${s.direction}|${s.path.replace(/[\d.]+/g, '#')}`;
      if (!byDirection.has(sig)) byDirection.set(sig, new Set());
      byDirection.get(sig).add(s.cue);
    }
    ok('no cue differs only by wording (leading and trailing space, casing)',
      strokes.every(({ s }) => s.cue === s.cue.trim() && s.cue === s.cue.replace(/\s+/g, ' ')));
  }

  /* --- Ñ and ñ, authored here because letters/ is an English alphabet ---
     THE TILDE-GAP ASSERTION IS THE ONE THAT EARNS ITS PLACE. The first authored tilde was
     shallow and sat right on the cap line, and at a 60-unit stroke weight its two ends fused
     into the tops of the N's stems: the whole thing rendered as one blobby roof, not as a
     letter with a mark above it. Nothing in either gate saw it and it was caught by looking at
     a 390x844 render, 2026-08-24. Written and observed failing against the shipped geometry
     before the geometry was changed — the old paths cleared 47 units (Ñ) and 57 units (ñ),
     against the 75 required here.
     STROKE_W is the stroke-width the tracing CSS actually paints, so the threshold is
     "at least a quarter of a stroke of daylight" rather than an arbitrary number. */
  const STROKE_W = Number((html.match(/\.tr-ghost\{[^}]*stroke-width:(\d+)/) || [, 0])[1]);
  ok('the tracing stylesheet declares the stroke weight this test reasons about', STROKE_W === 60);
  {
    // Sample a path made of M plus cubic C segments. Enough for the two tildes, which are the
    // only cubics in the dataset; anything else is refused rather than silently mis-measured.
    const sampleCubics = (d) => {
      const nums = d.match(/-?[\d.]+/g).map(Number);
      if (!/^M[^A-Za-z]*(C[^A-Za-z]*)+$/.test(d.replace(/\s+/g, ''))) return null;
      const ys = [];
      let cx = nums[0], cy = nums[1], i = 2;
      while (i + 5 < nums.length) {
        const [x1, y1, x2, y2, x3, y3] = nums.slice(i, i + 6);
        for (let t = 0; t <= 1.0001; t += 0.02) {
          const u = 1 - t;
          ys.push(u*u*u*cy + 3*u*u*t*y1 + 3*u*t*t*y2 + t*t*t*y3);
        }
        cx = x3; cy = y3; i += 6;
      }
      return ys;
    };
    const metrics = JSON.parse(html.match(/window\.RUMI_GLYPH_METRICS = (\{[^;]*\});/)[1]);
    for (const [k, topKey] of [['Ñ', 'capTop'], ['ñ', 'xHeightTop']]) {
      const g = glyphs[k];
      if (!g) continue;
      const t = g.strokes[g.strokes.length - 1];
      const ys = sampleCubics(t.path);
      ok(`${k}'s tilde is a measurable curve`, Array.isArray(ys) && ys.length > 0);
      if (ys) {
        const gap = metrics[topKey] - Math.max(...ys);
        ok(`${k}'s tilde clears the letter below it by more than a stroke width (${Math.round(gap)} units, need > ${STROKE_W * 1.25})`,
          gap > STROKE_W * 1.25);
        // and it is narrower than the letter it sits on, which is what stops the ends reading
        // as a continuation of the stems
        const xs = t.path.match(/-?[\d.]+/g).map(Number).filter((_, i2) => i2 % 2 === 0);
        const base = glyphs[k === 'Ñ' ? 'N' : 'n'];
        const bxs = base.strokes.flatMap((s) => s.path.match(/-?[\d.]+/g).map(Number).filter((_, i2) => i2 % 2 === 0));
        ok(`${k}'s tilde is narrower than the letter it sits on`,
          (Math.max(...xs) - Math.min(...xs)) < (Math.max(...bxs) - Math.min(...bxs)));
      }
    }
  }

  for (const k of ['Ñ', 'ñ']) {
    ok(`the alphabet has ${k}`, Boolean(glyphs[k]));
    if (glyphs[k]) {
      const st = glyphs[k].strokes;
      ok(`${k} puts the tilde last, after the base letter`, st[st.length - 1].direction === 'tilde-right');
      const base = glyphs[k === 'Ñ' ? 'N' : 'n'];
      ok(`${k} is ${k === 'Ñ' ? 'N' : 'n'} plus one stroke, with the base geometry unchanged`,
        st.length === base.strokes.length + 1
        && base.strokes.every((b, i) => b.path === st[i].path));
      // The tilde sits ABOVE the letter it belongs to, and inside the box.
      const t = st[st.length - 1];
      ok(`${k}'s tilde sits above the letter and inside the frame`,
        t.start[1] > 0 && t.start[1] < (k === 'Ñ' ? 192 : 432));
    }
  }

  /* --- every card that claims a trace can get one --- */
  {
    const traceCards = cards.filter((c) => c.trace);
    ok(`the letter module traces all 27 letters (${traceCards.filter((c) => c.t === 'letter').length})`,
      traceCards.filter((c) => c.t === 'letter').length === 27);
    const unresolvable = traceCards.filter((c) => String(c.trace).split('').some((g) => !glyphs[g]));
    ok(`every trace target resolves to a real glyph (${traceCards.length} cards)`, unresolvable.length === 0);
    if (unresolvable.length) fails.push(`  first unresolvable: ${unresolvable[0].es} -> ${unresolvable[0].trace}`);
    // The letter card's trace target must be the letter the card is about, not a neighbour.
    const wrong = cards.filter((c) => c.t === 'letter' && c.trace !== String(c.es).trim().charAt(0));
    ok('every letter card traces its own letter', wrong.length === 0);
    if (wrong.length) fails.push(`  first mismatch: card "${wrong[0].es}" traces "${wrong[0].trace}"`);
  }

  /* --- the numbers module --- */
  {
    const nums = cards.filter((c) => c.t === 'num');
    ok(`the numbers module exists and covers 1 to 10 (${nums.length} cards)`, nums.length === 10);
    ok('every number card counts something, and the count matches the numeral',
      nums.every((c) => Number(c.count) === Number(c.trace) && Number(c.count) >= 1));
    ok('the thing counted changes from card to card, so the number is the invariant',
      new Set(nums.map((c) => c.emo)).size === nums.length);
    ok('every number card carries ONE emoji, which buildNum repeats',
      nums.every((c) => [...c.emo].filter((ch) => ch.codePointAt(0) > 0x2000).length <= 2));
    ok('no number card glosses — the row of pictures is the meaning',
      nums.every((c) => !needsGloss(c)));
    ok('num is wired into every place a card type has to appear',
      /const START = \{[^}]*num:"/.test(html) && /const TURN {2}= \{[^}]*num:"/.test(html)
      && /num: {4}"say it with rumi"/.test(html)
      && /if\(c\.t === "num"\) buildNum\(stage, c\); else buildLetter\(stage, c\);/.test(html));
  }

  /* --- the trace flag drives the card, and the age gate drives the trace --- */
  // Asserted on the DATA, not on a substring of the page: this file is heavily commented and a
  // naive grep for t:"trace" goes red on the comment explaining why there is no such type.
  ok('tracing is a flag on the existing letter card, not a seventh card type',
    cards.every((c) => c.t !== 'trace')
    && /else if\(c\.t === "letter" \|\| c\.t === "num"\)\{[\s\S]{0,1200}if\(!enterTrace\(c, true\)\)\{/
      .test(html));

  /* THE DEFECT THIS PAIR EXISTS TO CATCH, found in the field on 2026-08-25 and reported as
     "rumi doesn't have the tracing yet". It was there. It only appeared once Rumi had
     finished speaking, so anyone who landed on a letter and looked saw an ordinary card,
     and anyone who tapped forward never saw it at all. The whole feature was invisible.
     The rule now: the glyph is painted BEFORE a word is spoken, from renderCard and not
     from a speech callback, and the stroke instruction is what waits its turn instead. */
  ok('the letter to trace is on screen before Rumi speaks, not after she finishes',
    /if\(!enterTrace\(c, true\)\)\{/.test(html)
    && /if\(!defer\) setTimeout\(trBegin, 300\);/.test(html)
    && !/speakSandwich\([\s\S]{0,2000}if\(!enterTrace\(c\)\)/.test(html));
  ok('the stroke instruction waits for the end of the sentence, so the two never overlap',
    /function trBegin\(\)\{[\s\S]{0,200}trSayCue\(\);[\s\S]{0,80}trDemo\(\);/.test(html)
    && /if\(tr\) trBegin\(\);/.test(html));
  ok('a card with nothing traceable still stars and still advances',
    /if\(!enterTrace\(c, true\)\)\{[\s\S]{0,160}buildNum\(stage, c\); else buildLetter\(stage, c\);/
      .test(html)
    && /if\(tr\) trBegin\(\);\s*\n\s*else\{[\s\S]{0,240}markDone\(\);[\s\S]{0,160}"next go";/.test(html));
  ok('the trace 🔊 replays the letter AND the stroke instruction, not the stroke alone',
    /btn\.onclick = \(\) => \{ stopSpeech\(\); speak\(spokenOf\(c\), trBegin\);( sig\("replay", sigCard\(\)\);)? \};/.test(html));
  ok('the age gate reads the stored age, never a hardcoded list of letters',
    /\(g\.minAge \|\| 0\) > \(S\.age \|\| 5\)\) return null;/.test(html)
    && !/diagonalsOn|DIAGONAL_LETTERS/.test(html));
  ok('the star moves to the end of the tracing', /function trFinish\(\)\{[\s\S]*?markDone\(\);/.test(html));
  ok('a stroke drawn backwards is rejected', /return "backwards";/.test(html));
  ok('no punitive messaging: three attempts advance anyway, silently',
    /tr\.tries >= TR_TRIES\)\{ setTimeout\(trNext, 300\); return; \}/.test(html));
  ok('the view window is fitted per card, never the raw 1024 authoring box',
    /function trFit\(\)\{[\s\S]*?setAttribute\("viewBox"/.test(html) && /TR_VIEW_FRAME = 640/.test(html));
  ok('the trace stage is torn down when the card changes',
    /if\(tr\)\{ clearTimeout\(tr\.demoTimer\); tr = null; \}/.test(html));
  ok('the tracing pad never becomes a subresource — the geometry is inline like everything else',
    /<script id="rumiGlyphs">/.test(html));

  /* --- 12. THE DRIFT GATE. letters/letters-app.html is the AUTHOR of every shared glyph. ---
     Both apps are one self-contained HTML file with no build step, so there is no shared
     import to make and the data has to be copied. What is not acceptable is two copies that
     can silently disagree — a glyph corrected in one app and not the other teaches a
     five-year-old two different motor plans for one letter.

     It compares GEOMETRY ONLY. `cue` is deliberately excluded: Rumi's cues are Spanish and
     that difference is the entire point of this module. Rumi's extra glyphs (Ñ, ñ) are
     excluded by construction, because letters/ does not have them.

     IT SKIPS, LOUDLY, WHEN THE SIBLING CHECKOUT IS ABSENT — CI clones this repo alone. A skip
     is not a pass and this prints that sentence rather than counting a passed assertion. */
  {
    const LETTERS = path.join(ROOT, '..', 'letters', 'letters-app.html');
    if (!fs.existsSync(LETTERS)) {
      console.log('  SKIP  glyph drift vs letters/letters-app.html — sibling checkout not present.');
      console.log('        A skip is not a pass: nothing was compared, so the two copies may already disagree.');
    } else {
      const lhtml = fs.readFileSync(LETTERS, 'utf8');
      const lm = lhtml.match(/<script id="letterGlyphs">([\s\S]*?)<\/script>/);
      const lw = {};
      if (lm) new Function('window', lm[1])(lw);
      const L = lw.LETTER_GLYPHS || {};
      ok('the letters dataset could be read', Object.keys(L).length > 0);
      const shared = Object.keys(L).filter((k) => glyphs[k]);
      ok(`every glyph letters/ authors is present here (${Object.keys(L).length})`,
        shared.length === Object.keys(L).length);
      const drifted = [];
      for (const k of shared) {
        const a = L[k], b = glyphs[k];
        if (a.case !== b.case || a.minAge !== b.minAge
          || JSON.stringify(a.strokeFamily) !== JSON.stringify(b.strokeFamily)
          || a.strokes.length !== b.strokes.length) { drifted.push(k); continue; }
        for (let i = 0; i < a.strokes.length; i += 1) {
          const x = a.strokes[i], y = b.strokes[i];
          if (x.path !== y.path || x.order !== y.order || x.direction !== y.direction
            || JSON.stringify(x.start) !== JSON.stringify(y.start)) { drifted.push(k); break; }
        }
      }
      ok(`shared stroke geometry agrees with letters/letters-app.html, field by field (${shared.length} glyphs)`, drifted.length === 0);
      if (drifted.length) fails.push(`  drifted: ${drifted.join(', ')} — letters/ is the author; fix it there and re-copy`);
      // And the cues really did change, which is what makes this a Spanish tracing app.
      const sameCue = shared.filter((k) => L[k].strokes.some((s, i) => s.cue === glyphs[k].strokes[i].cue));
      ok('no shared stroke kept its English cue', sameCue.length === 0);
      if (sameCue.length) fails.push(`  still English: ${sameCue.slice(0, 5).join(', ')}`);
    }
  }
}

/* ---- 13. per-word timing (RUMIVOICE1) ----
 * The slow speed plays the real recording one word at a time, from spans that rumi-words.mjs
 * builds out of ElevenLabs' per-character timing. A span that is wrong cuts a word in half and she
 * repeats what she hears, so the converter must refuse anything it cannot line up exactly. The
 * fixture is a real render from the service, not a hand-written shape. */
{
  const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'fixtures', 'eleven-baja-una-linea-grande.json'), 'utf8'));
  const sp = wordSpans(fx.text, fx.alignment);
  const words = fx.text.split(/\s+/);
  ok('word spans: a real ElevenLabs timing converts', Array.isArray(sp));
  ok('word spans: one start/end pair per word of the spoken line', sp && sp.length === 1 + 2 * words.length);
  ok('word spans: every word ends after it starts, and words run in order',
    sp && words.every((_, i) => sp[2 + 2 * i] > sp[1 + 2 * i] && (!i || sp[1 + 2 * i] >= sp[2 * i])));
  ok('word spans: the clip end is the last character end',
    sp && sp[0] === Math.round(fx.alignment.character_end_times_seconds.at(-1) * 100) / 100);
  ok('word spans: a recording that said a different word is refused',
    wordSpans('Baja una línea pequeña', fx.alignment) === null);
  ok('word spans: a recording with a different word count is refused',
    wordSpans('Baja una línea muy grande', fx.alignment) === null);
  ok('word spans: case and punctuation do not count as a different word',
    Array.isArray(wordSpans('¡baja una LÍNEA grande!', fx.alignment)));
  ok('word spans: no alignment is no timing, not a crash', wordSpans(fx.text, null) === null);
  const { map, dropped } = spanMap(
    [{ key: 'baja una línea grande', text: fx.text }, { key: 'otra', text: 'Otra vez' }],
    { 'baja una línea grande': fx.alignment, otra: fx.alignment });
  ok('word spans: a map keeps what lines up and names what it dropped',
    Object.keys(map).length === 1 && dropped.length === 1 && dropped[0] === 'otra');
  // The app reads the same shape back. Its tag must exist, or the embed step refuses.
  ok('the app carries a rumiTimes tag for the embed step to fill', /<script id="rumiTimes">[\s\S]*?<\/script>/.test(html));
  ok('the app plays timed lines word by word from the recording',
    /function playWords\(/.test(html) && /function wordTiming\(/.test(html));
  ok('the slow speed no longer needs a device voice once timing exists',
    /function turtleUsable\(\)\{ return !!voice \|\| !CLIP_COUNT \|\| TIME_COUNT > 0; \}/.test(html));
}

/* ---- 13b. the free voice's own word timing (RUMIVOICE1 phase B, 2026-09-15) ----
 * The ElevenLabs key turned out to be a free-plan key that cannot speak Spanish at all, so the
 * recordings stay with the Microsoft voice Whit picked by ear in August — and that service
 * returns one word-boundary event per word if you ask it for one. Same checks as above: this
 * converter refuses everything it cannot line up, because a wrong span cuts a word in half. */
{
  const marks = {
    text: 'Baja hacia la izquierda',
    words: [
      { text: 'Baja', start: 0.1, end: 0.77 },
      { text: 'hacia', start: 0.79, end: 1.12 },
      { text: 'la', start: 1.14, end: 1.27 },
      { text: 'izquierda', start: 1.29, end: 2.16 },
    ],
  };
  const sp = wordSpansFromMarks(marks.text, marks);
  ok('free-voice timing: word boundaries convert to spans', Array.isArray(sp) && sp.length === 9);
  ok('free-voice timing: the same flat shape the app already reads',
    sp && sp[0] === 2.16 && sp[1] === 0.1 && sp[2] === 0.77);
  ok('free-voice timing: a different word count is refused',
    wordSpansFromMarks('Baja hacia la izquierda, pasa la raya', marks) === null);
  ok('free-voice timing: a line the recording did not say is refused',
    wordSpansFromMarks('Baja hacia la derecha', marks) === null);
  ok('free-voice timing: punctuation the service drops is not a mismatch',
    Array.isArray(wordSpansFromMarks('Baja hacia la izquierda,', marks)));
  ok('free-voice timing: a word that ends before it starts is refused',
    wordSpansFromMarks('Baja', { words: [{ text: 'Baja', start: 0.9, end: 0.4 }] }) === null);
  ok('free-voice timing: no marks is no timing, not a crash',
    wordSpansFromMarks('Baja', null) === null && wordSpansFromMarks('Baja', {}) === null);
  /* One map, two recorders: whichever made a line, the app gets one format back. */
  const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'fixtures', 'eleven-baja-una-linea-grande.json'), 'utf8'));
  const { map } = spanMap(
    [{ key: 'a', text: marks.text }, { key: 'b', text: fx.text }],
    { a: marks, b: fx.alignment });
  ok('free-voice timing: one timing map holds both recorders',
    Object.keys(map).length === 2 && Array.isArray(map.a) && Array.isArray(map.b));
}

/* ---- 13c. seeding the render cache from what already shipped (2026-09-23) ----
 * build/ is gitignored, so an empty one makes the generator re-record all 288 lines in all five
 * voices — 20,000 credits, and a fresh take of every line Whit has already heard. The seed step
 * puts the shipped recordings back. Word timing is the hard half: an mp3 carries none, and what
 * ships is the CONVERTED word spans, so the seeder rebuilds the character-level timing from them.
 * If that inverse ever stops being exact, every seeded line's slow speed reads the wrong slice of
 * its own recording, so it is asserted here as well as gated at run time. */
{
  const text = 'Tengo cinco años';
  const spans = [1.94, 0.09, 0.53, 0.58, 1.08, 1.15, 1.61];
  const back = wordSpans(text, alignmentFromSpans(text, spans));
  ok('seed: word spans survive the round trip through a rebuilt alignment',
    Array.isArray(back) && back.length === spans.length && back.every((n, i) => n === spans[i]));
  ok('seed: the clip end is kept, not collapsed onto the last word',
    Array.isArray(back) && back[0] === 1.94 && back[back.length - 1] === 1.61);
  ok('seed: spans that do not describe the text are refused rather than guessed',
    alignmentFromSpans('Tengo cinco años muy largos', spans) === null
    && alignmentFromSpans(text, [1.94, 0.09]) === null);
  // And on the real thing: every line the page ships must round-trip, or seeding it would hand
  // the app a clip whose spans no longer match it.
  const shippedTimes = html.match(/<script id="rumiTimes">window\.RUMI_TIMES = ([\s\S]*?);<\/script>/);
  if (shippedTimes) {
    const t = JSON.parse(shippedTimes[1]);
    const corpus = new Map(collect(html).map((it) => [it.key, it.text]));
    const broke = Object.keys(t).filter((k) => {
      if (!corpus.has(k)) return false;
      const r = wordSpans(corpus.get(k), alignmentFromSpans(corpus.get(k), t[k]));
      return !(Array.isArray(r) && r.length === t[k].length && r.every((n, i) => n === t[k][i]));
    });
    ok(`seed: every timed line the page ships round-trips exactly (${Object.keys(t).length})`,
      broke.length === 0, `broke: ${broke.slice(0, 3).join(', ')}`);
  }
}

console.log(`${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  FAIL  ${f}`);
process.exit(fails.length ? 1 : 0);
