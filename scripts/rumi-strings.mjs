#!/usr/bin/env node
// rumi-strings.mjs — enumerate every string Rumi Español ever speaks.
//
// This is the half of the audio pipeline that has to be exactly right, so it is its
// own file with its own gate. It parses the MODULES array straight out of rumi-espanol-app.html
// rather than keeping a second copy of the content, because a second copy is a second
// thing to forget to update: a card added to the app and not here just misses the clip
// map and falls back to speechSynthesis, which is the correct failure, but a card
// REWORDED here and not in the app would generate audio nobody ever plays.
//
// The runtime lookup key and this generator's key must agree exactly. Both call
// normalizeKey(). Do not change it in one place.
//
// usage: node scripts/rumi-strings.mjs [path/to/rumi-espanol-app.html]     prints one string per line
//        node scripts/rumi-strings.mjs --json                  prints the array as JSON

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The default settings the app ships with (DEF in rumi-espanol-app.html). {AGE} is spoken as a word
// via AGEWORD, and 5 is the only age we pre-generate — any other age misses the map and
// falls back to speechSynthesis, which is why the fallback path is kept intact.
export const AGE_WORD = 'cinco';

// Strings the app speaks that live in code, not in MODULES. Found by grepping every
// speak() call site. The third one is the wake-up greeting on the ¡Vamos! button and is
// therefore the FIRST thing the child ever hears from this app.
export const FIXED_STRINGS = [
  '¡Muy bien!',
  '¡Muy bien! Adiós, hasta luego.',
  'Hola, me llamo Rumi. Vamos a hablar español.',
];

/** The one key function. Runtime and generator must both use it. */
export function normalizeKey(s) {
  return String(s).replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Does this card's meaning need an English voice? The emoji cannot carry a phrase.
 *
 * RUMI L4, 2026-08-22 (Whit's ruling: "the single words can be only spanish but the
 * phrases are too hard to figure out without the english"). The rule, in order:
 *   1. An explicit `gloss: true` / `gloss: false` on the card wins. Nothing else is consulted.
 *   2. `letter` cards never gloss — reading the letter is the point, and `en` there is the
 *      example word's meaning, which its own emoji already carries.
 *   3. Otherwise a phrase is anything whose Spanish has two or more whitespace-separated
 *      tokens. Token count is a proxy; `gloss:` exists for where it is wrong.
 * `answer` replies are checked by callers through a `{t:'reply', es, gloss}` pseudo-card.
 *
 * The SAME logic exists as needsGloss() in rumi-espanol-app.html, which decides what to
 * PLAY while this copy decides what to RECORD. The drift assertion in rumi-unit-test.mjs
 * runs both over the real card set — change them together or not at all. */
export function needsGloss(card) {
  if (card.gloss === true) return true;
  if (card.gloss === false) return false;
  if (card.t === 'letter') return false;
  return String(card.es || '').trim().split(/\s+/).filter(Boolean).length >= 2;
}

/** Pull the `const MODULES = [ ... ];` literal out of the HTML and evaluate it. */
export function readModules(html) {
  const start = html.indexOf('const MODULES = [');
  if (start < 0) throw new Error('MODULES array not found in rumi-espanol-app.html');
  const open = html.indexOf('[', start);
  let depth = 0;
  let end = -1;
  let inStr = null;
  for (let i = open; i < html.length; i += 1) {
    const ch = html[i];
    if (inStr) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) throw new Error('MODULES array literal is unbalanced');
  const literal = html.slice(open, end + 1);
  // eslint-disable-next-line no-new-func
  return { modules: new Function(`return ${literal};`)(), literal };
}

/**
 * Expand one template into every form the app can actually speak.
 * {A} is the gender ending — both `a` and `o`, because the settings screen offers both.
 * {E} is always `e` (triste is invariable; the app's own fill() says so).
 * {AGE} is the age WORD, and only 5 is pre-generated.
 * {NAME} is removed: the app deliberately never voices the child's name, and after the
 * RUMI1 privacy fix the default name is empty anyway.
 */
export function expand(template) {
  if (!template) return [];
  const withoutName = String(template).replace(/\{NAME\}/g, '');
  const base = withoutName.replace(/\{E\}/g, 'e').replace(/\{AGE\}/g, AGE_WORD);
  if (!base.includes('{A}')) return [base];
  return [base.replace(/\{A\}/g, 'a'), base.replace(/\{A\}/g, 'o')];
}

/** Every distinct spoken string, in a stable order. */
export function collect(html) {
  const { modules } = readModules(html);
  const out = new Map(); // normalized key -> display string

  const add = (s) => {
    for (const variant of expand(s)) {
      const key = normalizeKey(variant);
      if (!key) continue;
      if (!out.has(key)) out.set(key, variant.replace(/\s+/g, ' ').trim());
    }
  };

  for (const m of modules) {
    // RUMI3: the module's own Spanish name. Tapping a home tile now speaks it, so she
    // learns the map of the app by ear instead of by reading two lines she cannot read.
    // Without this the tile tap misses the clip map and falls back to the device voice.
    add(m.es);
    for (const c of m.cards || []) {
      // playCard(): spokenOf(c) is `c.spoken || c.es`.
      add(c.spoken || c.es);
      // playCard() / reveal(): `c.replySpoken || c.reply.es`.
      if (c.reply) add(c.replySpoken || c.reply.es);
    }
  }
  for (const s of FIXED_STRINGS) add(s);

  return [...out.entries()].map(([key, text]) => ({ key, text }));
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const file = args.find((a) => !a.startsWith('--')) || path.join(ROOT, 'rumi-espanol-app.html');
  const items = collect(fs.readFileSync(file, 'utf8'));
  if (asJson) {
    process.stdout.write(`${JSON.stringify(items, null, 2)}\n`);
  } else {
    for (const it of items) process.stdout.write(`${it.text}\n`);
    process.stderr.write(`${items.length} distinct spoken strings\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
