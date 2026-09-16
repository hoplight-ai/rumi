// rumi-voices.mjs — the five voices Rumi can speak with, in one place.
//
// WHY A REGISTRY AND NOT FIVE CONSTANTS. This list is read by four things that must never
// disagree: the generator that renders the clips, the pack builder that writes the four files
// beside the page, the app that draws the settings list, and ci-check.mjs which asserts the two
// copies match. A voice added in one place and not the others is a name a grown-up can tap that
// downloads a file nobody ever wrote — a spinner that never ends, on a five-year-old's iPad.
//
// The app carries its own copy inside <script id="rumiVoices">, because the app is one file and
// cannot import anything. `node scripts/rumi-voices.mjs --tag` prints that block, and
// ci-check.mjs fails if the shipped block does not match this file.
//
// WHY THESE FIVE, AND WHY INÉS IS THE ONE IN THE PAGE. Whit, 2026-09-16: "why make me choose?
// let the user have like 5 options in the settings". All five are native Spanish speakers from
// the ElevenLabs public library, which the key can reach since the tier grant landed. Inés is
// embedded rather than chosen by ear: the library tags her calm and she reads slowest, which is
// the right default for a child decoding a new language. Nobody has heard her against the other
// four — that is a judgment call, stated as one, and any of the five is one tap away.
//
// usage: node scripts/rumi-voices.mjs          list them
//        node scripts/rumi-voices.mjs --tag    print the <script id="rumiVoices"> block

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** slug: the file name and the stored setting. name: what a grown-up reads. where/note: the one
 *  line under the name, which is the only thing on that row besides the name itself.
 *  embedded: this one lives inside the page, so the app works offline the first time it opens. */
export const VOICES = [
  { slug: 'ines', name: 'Inés', id: 'b8hczxpWV1VCBo2sB5jd', where: 'Spain', note: 'calm', embedded: true },
  { slug: 'alma', name: 'Alma', id: '8gK5gnQBZnJWm1ta8R8X', where: 'Spain', note: 'warm', embedded: false },
  { slug: 'valeria', name: 'Valeria', id: 'SzSUM9aqTucCylaROOmf', where: 'Spain', note: 'clear', embedded: false },
  { slug: 'sofia', name: 'Sofía', id: 'eZxqQzb5CuYo3Kl6EXfZ', where: 'Spain', note: 'natural', embedded: false },
  { slug: 'daniela', name: 'Daniela', id: 'NUEuVCKSYxEA5YrK3kmx', where: 'Latin America', note: 'bright', embedded: false },
];

export const DEFAULT_VOICE = VOICES.find((v) => v.embedded);
export const PACK_VOICES = VOICES.filter((v) => !v.embedded);

/** Where a pack lives, relative to the repo root and to the served origin. One function, so the
 *  generator writes exactly the path the app fetches. */
export function packPath(slug) { return `voices/${slug}.json`; }

/** The app's copy. The voice id is deliberately NOT in it: the page never calls ElevenLabs, and
 *  an id in a public file is a credential-shaped string sitting where nothing needs it. */
export function appTag() {
  const rows = VOICES.map((v) => JSON.stringify({
    slug: v.slug, name: v.name, where: v.where, note: v.note, embedded: v.embedded,
  }));
  return `<script id="rumiVoices">window.RUMI_VOICES = [${rows.join(',')}];</script>`;
}

function main() {
  if (process.argv.includes('--tag')) { process.stdout.write(`${appTag()}\n`); return; }
  for (const v of VOICES) {
    process.stdout.write(`${v.slug.padEnd(9)} ${v.name.padEnd(9)} ${v.id}  ${v.where}, ${v.note}`
      + `${v.embedded ? '  (embedded in the page)' : `  -> ${packPath(v.slug)}`}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
