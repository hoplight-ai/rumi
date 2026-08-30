/* rumi-stamp.mjs — write the real build identity into the page.
 *
 * The 2026-08-30 audio hunt burned four rounds on a question nobody could answer from a phone:
 * WHICH BUILD IS THIS? Every "still not working" could have meant a broken fix or a stale file,
 * and there was no way to tell them apart. The diagnostics block reports `build`; this fills it.
 *
 * It runs as the Vercel build command, so the stamp is the commit Vercel actually deployed
 * rather than something a human remembered to update. VERCEL_GIT_COMMIT_SHA is set by Vercel
 * for every git-linked deployment; locally it falls back to `git rev-parse`.
 *
 * The placeholder stays in the committed file on purpose. An unstamped page says "dev", which
 * is true. Baking a hash into the repo would mean the file claims to be a commit it cannot be
 * — the hash is not known until after the commit that would contain it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PAGE = resolve(here, '..', 'rumi-espanol-app.html');
const PLACEHOLDER = '__RUMI_BUILD__';

const sha = (
  process.env.VERCEL_GIT_COMMIT_SHA ||
  (() => { try { return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); } catch { return ''; } })()
);
const short = sha ? sha.slice(0, 7) : 'unknown';
const when = new Date().toISOString().slice(0, 16).replace('T', ' ') + 'Z';
const stamp = `${short}  ${when}`;

const html = readFileSync(PAGE, 'utf8');
if (!html.includes(PLACEHOLDER)) {
  /* Already stamped, or the placeholder was removed. Never a hard failure: a deploy must not
     die because the page cannot say its own name. */
  console.log(`rumi-stamp: no ${PLACEHOLDER} in the page — leaving it alone.`);
  process.exit(0);
}
writeFileSync(PAGE, html.replace(PLACEHOLDER, stamp));
console.log(`rumi-stamp: ${stamp}`);
