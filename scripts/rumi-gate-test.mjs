// The lock on the voice comparison page (middleware.js). Node standard library only, no network.
// Whit, 2026-11-08: "1 yes" to "both pages go behind the password". Run: npm run test:gate
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.PRIVATE_SITE_USER = 'test-user';
process.env.PRIVATE_SITE_PASSWORD = 'test-password-for-offline-tests';

const here = new URL('../middleware.js', import.meta.url);
test('a gate file exists for the voice comparison page', () => {
  assert.ok(existsSync(here), 'middleware.js is missing, so /rumi-voice-bakeoff is served to anyone');
});
const mw = existsSync(here) ? await import(here) : { default: async () => new Response('open', { status: 200 }) };

const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
const ask = (path, headers = {}) => mw.default(new Request(`https://rumi.test${path}`, { headers }));
const passed = (res) => res.headers.get('x-middleware-next') === '1';

for (const path of ['/rumi-voice-bakeoff', '/rumi-voice-bakeoff.html', '/bakeoff-manifest.json', '/bakeoff-anchor.json',
  '/RUMI-Voice-Bakeoff', '/rumi-voice-b%61keoff', '//rumi-voice-bakeoff/']) {
  test(`no password: ${path} is refused with the Basic prompt`, async () => {
    const res = await ask(path);
    assert.equal(res.status, 401);
    assert.match(res.headers.get('www-authenticate') || '', /^Basic/);
  });
}

test('the right pair opens the comparison page', async () => {
  const res = await ask('/rumi-voice-bakeoff', { authorization: basic('test-user', 'test-password-for-offline-tests') });
  assert.ok(passed(res));
});

test('a wrong pair is refused', async () => {
  const res = await ask('/rumi-voice-bakeoff', { authorization: basic('test-user', 'nope'), 'x-forwarded-for': '198.51.100.1' });
  assert.equal(res.status, 401);
});

for (const path of ['/', '/rumi', '/rumi-espanol-app', '/manifest.json', '/icon-192.png']) {
  test(`the app stays open: ${path} passes with no password`, async () => {
    assert.ok(passed(await ask(path)));
  });
}

test('twenty wrong pairs from one address, then 429; another address is not held back', async () => {
  const wrong = { authorization: basic('test-user', 'guess') };
  for (let i = 0; i < 20; i += 1) {
    const r = await ask('/rumi-voice-bakeoff', { ...wrong, 'x-forwarded-for': '203.0.113.7' });
    assert.equal(r.status, 401, `guess ${i + 1}`);
  }
  const blocked = await ask('/rumi-voice-bakeoff', { ...wrong, 'x-forwarded-for': '203.0.113.7' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '900');
  const other = await ask('/rumi-voice-bakeoff', { ...wrong, 'x-forwarded-for': '203.0.113.99' });
  assert.equal(other.status, 401);
});

test('fails closed: with the pair unset, even an empty pair is refused', async () => {
  const keep = [process.env.PRIVATE_SITE_USER, process.env.PRIVATE_SITE_PASSWORD];
  delete process.env.PRIVATE_SITE_USER;
  delete process.env.PRIVATE_SITE_PASSWORD;
  try {
    const res = await ask('/rumi-voice-bakeoff', { authorization: basic('', ''), 'x-forwarded-for': '192.0.2.5' });
    assert.equal(res.status, 401);
  } finally {
    [process.env.PRIVATE_SITE_USER, process.env.PRIVATE_SITE_PASSWORD] = keep;
  }
});

test('the matcher leaves the voice clips alone', () => {
  const m = mw.config?.matcher?.[0];
  assert.ok(m, 'no matcher');
  const re = new RegExp('^' + m + '$');
  assert.equal(re.test('/voices/alma/index.json'), false);
  assert.equal(re.test('/rumi-voice-bakeoff'), true);
});
