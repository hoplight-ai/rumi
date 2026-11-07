// npm run proof:signal: Rumi's anonymous usage and the grown-ups' feedback box, proven in a headless
// browser against the live Hoplight signal kit (KIDSIGNAL1, 2026-11-07).
//
// Default: the page is served from this repo's files AT ITS REAL ADDRESS (the browser is told to
// answer https://rumi-rouge.vercel.app from disk), so the kit and hoplight.ai/api/signal are the live
// ones and the Origin is the one the store accepts. `-- --live`: the deployed site itself.
// `-- --url <address>`: any other copy (a preview); sig() logs only on the live address, so there
// the proof checks that the kit loads and that NOTHING is sent, and skips the feedback note.
//
// It taps through the way a child would (start, one deck, the 🔊 again, home), then a grown-up
// opens the gear and sends one feedback note that says "proof run, ignore". A name is stored on the
// device first, and the proof fails if that name, or any value outside the app's fixed words, is
// in anything sent. Every event it sends is real: about seven events and one feedback note.
//
// Needs playwright: `npm i --no-save playwright` (package.json stays dependency-free, as in CI).
// Uses playwright's own Chromium when installed, otherwise the Google Chrome already on the machine.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

let chromium;
try { ({ chromium } = await import('playwright')); } catch {
  console.log('SKIP  proof:signal needs playwright: npm i --no-save playwright. A skip is not a pass.');
  process.exit(2);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIVE_ORIGIN = 'https://rumi-rouge.vercel.app';
const urlArg = process.argv.indexOf('--url');
const OTHER = urlArg > 0 ? process.argv[urlArg + 1].replace(/\/$/, '') : null;
const LIVE = process.argv.includes('--live');
const ORIGIN = OTHER || LIVE_ORIGIN;
const FROM_DISK = !LIVE && !OTHER;
const SIGNAL_URL = 'https://hoplight.ai/api/signal';
const KIT_URL = 'https://hoplight.ai/kit/signal.js';
const CARD = 'https://hoplight.ai/api/og/tool/rumi';
const NAME = 'Zelda Proofname';
const NOTE = 'proof run, ignore';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon' };

let fails = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!cond) fails++; };
const waitFor = async (fn, ms = 10000, each = async () => {}) => { const end = Date.now() + ms; while (Date.now() < end) { await each(); if (fn()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };

async function serveFromDisk(context) {
  await context.route(`${LIVE_ORIGIN}/**`, (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname === '/' || url.pathname === '/rumi' ? '/rumi-espanol-app.html'
      : (extname(url.pathname) ? url.pathname : `${url.pathname}.html`);
    const file = join(ROOT, decodeURIComponent(path));
    if (!file.startsWith(ROOT) || !existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, body: readFileSync(file), headers: { 'content-type': TYPES[extname(file)] || 'application/octet-stream' } });
  });
}

let browser;
try { browser = await chromium.launch(); } catch { browser = await chromium.launch({ channel: 'chrome' }); }
try {
  const cx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (FROM_DISK) await serveFromDisk(cx);
  await cx.addInitScript((name) => {
    try { if (!localStorage.getItem('rumi.v1')) localStorage.setItem('rumi.v1', JSON.stringify({ name, age: 5, stars: {} })); } catch {}
  }, NAME);
  // The kit sends events with sendBeacon and a Blob body, and against the deployed site the browser
  // does not show that body to playwright (it did when the page came from disk; seen 2026-11-07, all
  // eight posts answered 202 with empty bodies). So a spy in this test browser copies each beacon's
  // body as it is sent, and the beacon rows below take those bodies in order. The page is untouched.
  await cx.addInitScript(() => {
    window.__beacons = [];
    const send = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
    if (send) navigator.sendBeacon = (url, data) => {
      if (String(url).endsWith('/api/signal') && data instanceof Blob) data.text().then((t) => window.__beacons.push(t));
      return send(url, data);
    };
  });
  const seen = [];
  cx.on('request', (req) => {
    if (req.url() === SIGNAL_URL && req.method() === 'POST') {
      const row = { body: req.postData() || '', status: null, beacon: !req.postData() };
      seen.push(row);
      req.response().then((res) => { row.status = res ? res.status() : null; }).catch(() => {});
    }
  });
  const fillBeacons = async (page) => {
    const bodies = await page.evaluate(() => window.__beacons.slice()).catch(() => []);
    seen.filter((r) => r.beacon).forEach((r, i) => { if (bodies[i]) r.body = bodies[i]; });
  };
  const parsed = () => seen.map((r) => { try { return { ...JSON.parse(r.body), status: r.status, raw: r.body }; } catch { return { status: r.status, raw: r.body }; } });
  const events = () => parsed().filter((s) => s.kind === 'event');

  const page = await cx.newPage();
  const kitRes = page.waitForResponse((r) => r.url() === KIT_URL, { timeout: 30000 });
  await page.goto(`${ORIGIN}/`, { waitUntil: 'load', timeout: 60000 });
  const kit = await kitRes;
  ok('the kit script loads from hoplight.ai', kit.status() === 200, String(kit.status()));
  ok('window.hoplightSignal is on the page', await page.evaluate(() => typeof window.hoplightSignal?.track === 'function'));
  const html = await page.content();
  ok('og:image is the Hoplight card', html.includes(`property="og:image" content="${CARD}"`));
  ok('og:title reads "Rumi Español by Hoplight"', html.includes('property="og:title" content="Rumi Español by Hoplight"'));

  // The child: start, one deck, the 🔊 again, home.
  await page.locator('#unlockBtn').click();
  await page.locator('#grid .tile').first().click();
  await page.waitForTimeout(1200);
  await page.locator('#stage .play').first().click();
  await page.waitForTimeout(600);
  await page.locator('#toHome').click();
  await page.waitForTimeout(400);

  if (OTHER) {
    await page.waitForTimeout(1500);
    ok('a copy that is not the live address sends nothing', seen.length === 0, `${seen.length} posts`);
  } else {
    const want = ['open', 'deck-open', 'play', 'replay', 'screen'];
    await waitFor(() => want.every((a) => events().some((s) => s.action === a && s.status)), 10000, () => fillBeacons(page));
    for (const a of want) {
      const e = events().find((s) => s.action === a);
      ok(`${a} is logged and answered 202`, e && e.status === 202, e ? `${e.status} ${JSON.stringify(e.props)}` : 'none');
    }
    const open = events().find((s) => s.action === 'open');
    ok('every event names the tool rumi', events().every((s) => s.tool === 'rumi'));
    ok('open carries voice, speed, muted and returning only', open && Object.keys(open.props).sort().join() === 'muted,returning,speed,voice');
  }

  // The grown-up: the gear, the box, one note.
  await page.locator('#toSettings').click();
  const box = page.locator('[data-hoplight-feedback]');
  await box.scrollIntoViewIfNeeded();
  ok('the feedback box is in Grown-ups', await page.locator('#scSet [data-hoplight-feedback]').isVisible());
  ok('the anonymous-usage line is under it', await page.locator('#scSet .tell-note', { hasText: 'Anonymous usage is logged to make this better. No names, no addresses.' }).isVisible());
  ok('the home screen and the cards carry no feedback box', (await page.locator('#scHome [data-hoplight-feedback], #scMod [data-hoplight-feedback]').count()) === 0);
  const shot = join(tmpdir(), `rumi-feedback-box-${LIVE ? 'live' : OTHER ? 'other' : 'local'}.png`);
  await box.screenshot({ path: shot });
  console.log(`      the box: ${shot}`);
  const sendBox = await page.locator('#tellSend').boundingBox();
  ok('the Send button is at least 44px tall', sendBox && sendBox.height >= 44, sendBox ? String(sendBox.height) : 'none');

  if (!OTHER) {
    const fbRes = page.waitForResponse((r) => r.url() === SIGNAL_URL && r.request().method() === 'POST' && (r.request().postData() || '').includes('"kind":"feedback"'), { timeout: 20000 });
    await page.locator('#tellMsg').fill(NOTE);
    await page.locator('#tellSend').click();
    const fb = await fbRes;
    await page.locator('#tellSaid', { hasText: 'Sent.' }).waitFor({ timeout: 8000 }).catch(() => {});
    ok('the feedback note answers 202', fb.status() === 202, String(fb.status()));
    ok('the box says it was sent', (await page.locator('#tellSaid').textContent()).startsWith('Sent.'));
    await waitFor(() => events().some((s) => s.action === 'screen' && s.props.screen === 'grown-ups' && s.status), 5000, () => fillBeacons(page));
    const sc = events().find((s) => s.action === 'screen' && s.props.screen === 'grown-ups');
    ok('opening Grown-ups is logged', !!sc && sc.status === 202, sc ? String(sc.status) : 'none');
  }

  // Nothing typed and never the name: the stored name appears in no body, and every string prop
  // is one of the app's fixed words.
  await page.waitForTimeout(800);
  await fillBeacons(page);
  const words = await page.evaluate(() => [...sigWords()]);
  const strayStrings = events().flatMap((s) => Object.entries(s.props || {}).filter(([, v]) => typeof v === 'string' && !words.includes(v)).map(([k, v]) => `${s.action}.${k}=${v}`));
  ok('the stored name is in nothing sent', seen.every((r) => !r.body.includes(NAME)));
  ok('every string prop is one of the app\'s fixed words', strayStrings.length === 0, strayStrings.join(', '));
  const all = parsed();
  ok('every post answered 202', all.every((s) => s.status === 202), all.map((s) => `${s.action}:${s.status}`).join(', '));
  console.log(`      posts sent: ${all.length} (${events().length} events, ${all.length - events().length} feedback)`);
  await cx.close();
} finally {
  await browser.close();
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
