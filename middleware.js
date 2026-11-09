// The lock on Rumi's voice comparison page. Whit, 2026-11-07: "all the pages need to be behind
// passwords and not served on public links from any of my sites"; 2026-11-08: "1 yes" to "both
// pages go behind the password". The app itself (/, /rumi, the voices) is not touched here.
//
// The comparison page (/rumi-voice-bakeoff, its .html spelling, and the two bakeoff-*.json files
// beside it) asks for the shared site pair as Basic Auth: the same PRIVATE_SITE_USER and
// PRIVATE_SITE_PASSWORD that quick-tools, hoplight.ai and Gut Check read. Env var names only, never a
// value in a file. FAILS CLOSED: when either variable is missing nothing matches and the page stays
// shut. A wrong pair counts against the same guess limit as every other sign-in on Whit's sites,
// twenty per address per fifteen minutes, then 429 (soft and per instance; the hard limit is a
// Vercel Firewall rule, Whit's to set). No dependencies: this repo has none, on purpose.
//
// Every path but the voice clips runs through here, and the decision is made in code on a
// normalized path, so /RUMI-voice-bakeoff, /rumi-voice-b%61keoff and a doubled slash are the
// same address as the plain one.

export const config = { matcher: ['/((?!voices/).*)'] };

const GRANT_LIMIT = { max: 20, windowMs: 15 * 60 * 1000 };
const buckets = new Map();

export function normalizePath(pathname) {
  let p = pathname;
  try {
    p = decodeURIComponent(p);
  } catch {
    // an undecodable path is compared as written
  }
  p = p.replace(/\/{2,}/g, '/').toLowerCase();
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p || '/';
}

export function isGated(pathname) {
  return normalizePath(pathname).includes('bakeoff');
}

export function checkLimitIn(bucket, key, max, windowMs, now = Date.now()) {
  const id = bucket + '\u0000' + key;
  const recent = (buckets.get(id) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    buckets.set(id, recent);
    return false;
  }
  recent.push(now);
  buckets.set(id, recent);
  return true;
}

function clientIp(request) {
  const xff = request.headers.get('x-forwarded-for');
  return xff ? xff.split(',')[0].trim() : 'unknown';
}

async function digest(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

// Constant time over two digests, so the timing says nothing about how much matched.
async function sameText(a, b) {
  const [da, db] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < da.length; i += 1) diff |= da[i] ^ db[i];
  return diff === 0;
}

async function basicOk(header, user, pass) {
  if (!user || !pass || !header || !/^Basic\s+/i.test(header)) return false;
  let decoded;
  try {
    decoded = atob(header.replace(/^Basic\s+/i, '').trim());
  } catch {
    return false;
  }
  return sameText(decoded, `${user}:${pass}`);
}

const pass = () => new Response(null, { headers: { 'x-middleware-next': '1' } });

export default async function middleware(request) {
  const url = new URL(request.url);
  if (!isGated(url.pathname)) return pass();

  const header = request.headers.get('authorization');
  if (await basicOk(header, process.env.PRIVATE_SITE_USER, process.env.PRIVATE_SITE_PASSWORD)) return pass();

  // Only a wrong pair is a guess; a first visit with no pair just gets the prompt.
  if (header && !checkLimitIn('basic-ip', clientIp(request), GRANT_LIMIT.max, GRANT_LIMIT.windowMs)) {
    return new Response('Too many sign-in attempts from your address. Wait fifteen minutes and try again.', {
      status: 429,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '900' },
    });
  }
  return new Response('This page needs the site password.', {
    status: 401,
    headers: {
      'www-authenticate': 'Basic realm="Hoplight", charset="UTF-8"',
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}
