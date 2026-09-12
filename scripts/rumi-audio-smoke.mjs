/* rumi-audio-smoke.mjs — the gate that actually listens.
 *
 * Whit, 2026-08-30: "i'm getting no sound in rumi at all."
 *
 * Three separate causes, and NOT ONE of them was visible to the two existing gates.
 * ci-check.mjs proved all 228 clips were complete, valid, byte-tiled mp3. rumi-unit-test.mjs
 * proved every string the app speaks is enumerated and recorded. Both were green. The app was
 * silent. What neither could see is the only question that matters — does a buffer reach the
 * speakers — because that is a property of a running browser, not of the file.
 *
 * So this drives a real Chromium and asserts on audio that actually starts. It hooks
 * AudioContext, so it observes the graph rather than the source: an assertion here fails if
 * the sound stops, however the sound stopped.
 *
 * Every case below is a REGRESSION test, not a hypothetical. Each one was observed red
 * against the build that shipped on 2026-08-29 and green against this one; the run that
 * proved it is recorded in the commit that added this file. A test nobody has seen fail is a
 * test nobody knows is connected.
 *
 * Playwright is the one dependency in this repo, and it is deliberately optional: absent, this
 * prints SKIP and exits 0, so a fresh clone still runs the other two gates with no install.
 * A skip is not a pass — nothing was played, so the app may already be silent.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { wordSpans } from './rumi-words.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PAGE = resolve(here, '..', 'rumi-espanol-app.html');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('SKIP  rumi-audio-smoke — playwright is not installed.');
  console.log('      A skip is not a pass: nothing was played, so the app may already be silent.');
  console.log('      To run it:  npm i -D playwright && npx playwright install chromium');
  process.exit(0);
}

const pass = [];
const fails = [];
const ok = (name, cond, detail) => {
  if (cond) { pass.push(name); console.log(`PASS  ${name}`); }
  else { fails.push(name); console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`); }
};

if (!existsSync(PAGE)) {
  console.log('FAIL  the app file is missing');
  process.exit(1);
}

/* Instrumentation. Counts every buffer that actually starts, and the gain it starts behind —
 * a clip playing at gain 0 is silence, and must not be allowed to read as sound. */
const INSTRUMENT = () => {
  window.__a = { starts: [], ctx: [], synth: [], errors: [] };
  /* The device with no voices, on every machine. CI's Ubuntu Chromium has none, but a Mac's
   * Chromium reports every macOS voice (180 on 2026-09-13), and on that machine every
   * "voices > 0 ||" assertion below passed without testing anything. Hiding the list is what
   * makes a local run test the iPad this app exists for. */
  try { Object.defineProperty(speechSynthesis, 'getVoices', { configurable: true, value: () => [] }); } catch (e) { /* keep going */ }
  const AC = window.AudioContext;
  const gains = new Set();
  const origGain = AC.prototype.createGain;
  AC.prototype.createGain = function () { const g = origGain.call(this); gains.add(g); return g; };
  const origBS = AC.prototype.createBufferSource;
  AC.prototype.createBufferSource = function () {
    const ctx = this;
    const src = origBS.call(this);
    const origConnect = src.connect.bind(src);
    let target = null;
    src.connect = (n, ...r) => { target = n; return origConnect(n, ...r); };
    const origStart = src.start.bind(src);
    src.start = (...a) => {
      window.__a.starts.push({
        state: ctx.state,
        dur: src.buffer ? +src.buffer.duration.toFixed(2) : 0,
        viaGain: gains.has(target),
        gain: gains.has(target) ? target.gain.value : null,
        /* Where in the buffer it starts and how much it plays: a word-by-word read is several
         * starts into ONE buffer at rising offsets, and that is the only way to tell it apart
         * from a whole clip played once. The rate is recorded because slowing by resampling
         * drops the pitch, which is ruled out. */
        offset: a.length > 1 ? +Number(a[1]).toFixed(2) : 0,
        span: a.length > 2 ? +Number(a[2]).toFixed(2) : null,
        rate: +src.playbackRate.value.toFixed(2),
      });
      return origStart(...a);
    };
    return src;
  };
  const origCtor = window.AudioContext;
  window.AudioContext = function (...a) { const c = new origCtor(...a); window.__a.ctx.push(c.state); return c; };
  window.AudioContext.prototype = origCtor.prototype;
  const os = speechSynthesis.speak.bind(speechSynthesis);
  speechSynthesis.speak = (u) => { window.__a.synth.push({ text: String(u.text).slice(0, 40), volume: u.volume }); return os(u); };
};

/* Only buffers longer than a frame count as speech: ensureAudio() primes the output route
 * with a deliberate one-sample buffer, and that is plumbing, not audio. */
const audible = (s) => s.filter((x) => x.dur > 0.05 && x.state === 'running' && x.gain !== 0);

/* RUMI_CHROMIUM lets a sandbox with a pre-installed browser point at it rather than having
 * playwright download its own pinned build. Unset — CI, and any normal clone — it is
 * playwright's default and this is a plain launch(). */
const browser = await chromium.launch(
  process.env.RUMI_CHROMIUM ? { executablePath: process.env.RUMI_CHROMIUM } : {});
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log(`      pageerror: ${e.message.slice(0, 200)}`));
await page.addInitScript(INSTRUMENT);
await page.goto(`file://${PAGE}`);
await page.waitForTimeout(400);

const reset = () => page.evaluate(() => { window.__a.starts = []; window.__a.synth = []; });
const seen = () => page.evaluate(() => window.__a);

/* This environment has no speech-synthesis voices at all, which is not a limitation of the
 * test — it IS the device that matters. The README's own reason for embedding the clips is
 * the iPad whose Spanish voice is "absent entirely, leaving the app silent". So every
 * assertion below runs on a machine that can only make sound via the recorded clips. */
const voices = await page.evaluate(() => speechSynthesis.getVoices().length);
console.log(`      device voices available: ${voices}${voices === 0 ? '  (the case the clips exist for)' : ''}`);

await page.click('#unlockBtn');
await page.waitForTimeout(200);

/* ---- 1. baseline: the app makes sound at all ---- */
await reset();
await page.click('.tile');
await page.waitForTimeout(1500);
let a = await seen();
ok('a card speaks a recorded clip', audible(a.starts).length > 0,
   `started: ${JSON.stringify(a.starts)}`);
ok('clips play through the master gain, not raw destination',
   a.starts.filter((x) => x.dur > 0.05).every((x) => x.viaGain));

/* ---- 2. THE REGRESSION. An iOS interruption used to be permanent. ----
 * iOS suspends the context on background, screen lock, a call, or another app taking audio.
 * Before ensureAudio() the only resume() lived in unlock(), whose overlay is display:none by
 * then — so every later start() ran against a dead context: silent, no error, no fallback,
 * and onended never fired, which stranded the tracing and sandwich callbacks too. */
const suspended = await page.evaluate(async () => {
  const AC = window.AudioContext;
  let found = null;
  const orig = AC.prototype.createBufferSource;
  AC.prototype.createBufferSource = function () { found = this; return orig.call(this); };
  document.querySelector('.play').click();
  await new Promise((r) => setTimeout(r, 400));
  AC.prototype.createBufferSource = orig;
  if (!found) return 'no context found';
  await found.suspend();
  window.__ctx = found;
  return found.state;
});
ok('the test really did suspend the context', suspended === 'suspended', `state: ${suspended}`);

await reset();
await page.click('.play');                 /* exactly what she does next: taps the cat */
await page.waitForTimeout(1800);
a = await seen();
ok('a tap revives audio after an iOS-style interruption', audible(a.starts).length > 0,
   `context is ${await page.evaluate(() => window.__ctx.state)}, started: ${JSON.stringify(a.starts)}`);

/* ---- 3. turtle must never be the reason the app is silent ----
 * Turtle bypasses the clips by design (it needs one utterance per word). On this voiceless
 * device that made it silent — and the speed is persisted, so one tap of 🐢 by a
 * five-year-old muted the app across reloads. */
ok('an undeliverable turtle cannot be selected in the first place',
   voices > 0 || await page.evaluate(() => document.querySelector('.sp[data-speed="turtle"]').disabled));

/* The state Whit's iPad is actually in: turtle was tapped and SAVED by the build that let
 * it be, so the fix has to rescue a device that already carries it, not merely stop new
 * ones arriving there. Seeded straight into storage, because the button is disabled now. */
{
  /* Its OWN context, so its own localStorage. Sharing the first page's context let that page —
   * still holding speed "walk" in memory — save over the seeded turtle about 1.2s into this
   * case, and "rescuing it does not rewrite the setting" failed on a build that rewrote
   * nothing. Measured 2026-09-13: this page's own S.speed stayed "turtle" throughout. */
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.addInitScript(INSTRUMENT);
  await p2.goto(`file://${PAGE}`);
  await p2.evaluate(() => localStorage.setItem('rumi.v1', JSON.stringify(
    { name: '', age: 5, gender: 'f', speed: 'turtle', muted: false, stars: {} })));
  await p2.reload();
  await p2.waitForTimeout(400);
  await p2.click('#unlockBtn');
  await p2.click('.tile');
  await p2.waitForTimeout(1800);
  const a2 = await p2.evaluate(() => window.__a);
  ok('a device that already has turtle saved still makes sound',
     voices > 0 || audible(a2.starts).length > 0,
     `started: ${JSON.stringify(a2.starts)}, synth: ${JSON.stringify(a2.synth)}`);
  ok('rescuing it does not rewrite the setting underneath her',
     await p2.evaluate(() => JSON.parse(localStorage.getItem('rumi.v1') || '{}').speed === 'turtle'));
  await ctx2.close();
}

/* ---- 4. the mute control, and the iOS ring/silent switch it compensates for ---- */
ok('the mute control is reachable from the module screen without going home',
   await page.evaluate(() => !!document.querySelector('.screen.on .mute')));
ok('the silent loop holds the playback audio session while unmuted',
   await page.evaluate(() => { const e = document.getElementById('silentLoop'); return !!e && !e.paused; }));

await reset();
await page.click('.screen.on .mute');
await page.waitForTimeout(1200);
a = await seen();
ok('muting silences the clips', audible(a.starts).length === 0,
   `started: ${JSON.stringify(a.starts)}`);
ok('muting releases the audio session',
   await page.evaluate(() => document.getElementById('silentLoop').paused));
ok('mute is persisted', await page.evaluate(() => JSON.parse(localStorage.getItem('rumi.v1') || '{}').muted === true));

/* Muted must mean gain 0, NOT "don't play": the buffer still has to run so onended still
 * fires and the sandwich, the stroke instruction and the auto-advance keep their timing. */
await reset();
await page.click('.play');
await page.waitForTimeout(1200);
a = await seen();
ok('a muted card still runs its buffer, so its completions still fire',
   a.starts.some((x) => x.dur > 0.05 && x.gain === 0),
   `started: ${JSON.stringify(a.starts)}`);

await page.click('.screen.on .mute');      /* back on */
await reset();
await page.click('.play');
await page.waitForTimeout(1500);
a = await seen();
ok('unmuting brings the sound back', audible(a.starts).length > 0, `started: ${JSON.stringify(a.starts)}`);
ok('unmuting retakes the audio session',
   await page.evaluate(() => !document.getElementById('silentLoop').paused));

/* ---- 4b. the listening drill (RUMI L7) ----
 * Whit, 2026-08-31: "right now the only way to know what an answer chip is is to read it in
 * english and that's no good." A tap used to BE the answer, so the only way to choose was to
 * read the English caption — in a listening drill, for a child who cannot read. These hold the
 * new contract: a tap is a LISTEN, ▶︎ is the commit. */
{
  const q = await ctx.newPage();
  await q.addInitScript(INSTRUMENT);
  await q.goto(`file://${PAGE}`);
  await q.waitForTimeout(300);
  await q.click('#unlockBtn');
  for (const t of await q.$$('.tile')) {
    if ((await t.textContent()).includes('La profe dice')) { await t.click(); break; }
  }
  await q.waitForTimeout(900);
  for (let i = 0; i < 12 && !(await q.$('.opt')); i += 1) { await q.click('#nextBtn'); await q.waitForTimeout(600); }
  const cls = () => q.evaluate(() => [...document.querySelectorAll('.opt')].map((o) => o.className.replace('opt', '').trim() || '-'));
  ok('a listening card renders options', (await q.$$('.opt')).length === 3);

  await q.evaluate(() => { window.__a.starts = []; });
  (await q.$$('.opt'))[0].click();
  await q.waitForTimeout(900);
  const tapped = await q.evaluate(() => window.__a);
  ok('tapping an option SPEAKS it', audible(tapped.starts).length > 0,
     `started: ${JSON.stringify(tapped.starts)}`);
  ok('tapping an option does NOT judge it', (await cls())[0] === 'sel');
  ok('a pending choice turns the advance button affirmative',
     (await q.evaluate(() => document.getElementById('nextBtn').className)).includes('go'));

  (await q.$$('.opt'))[1].click();
  await q.waitForTimeout(500);
  const moved = await cls();
  ok('choosing another option moves the selection', moved[0] === '-' && moved[1] === 'sel');

  /* Eliminate until the correct chip is found: which one it is is randomised per render. */
  let sawWrong = false, sawRight = false, advanced = false;
  for (let round = 0; round < 3; round += 1) {
    const c = await cls();
    const i = c.findIndex((x) => x !== 'wrong' && x !== 'right');
    if (i < 0) break;
    (await q.$$('.opt'))[i].click();
    await q.waitForTimeout(400);
    await q.click('#nextBtn');
    await q.waitForTimeout(900);
    const after = await cls();
    if (after[i] === 'wrong') {
      sawWrong = true;
      ok('a wrong chip stops being tappable',
         (await q.evaluate((n) => getComputedStyle(document.querySelectorAll('.opt')[n]).pointerEvents, i)) === 'none');
      ok('a wrong answer stays on the card', (await q.$$('.opt')).length === 3);
    } else if (after[i] === 'right') {
      sawRight = true;
      await q.waitForTimeout(5000);
      advanced = JSON.stringify(await cls()) !== JSON.stringify(after);
      break;
    }
  }
  ok('a wrong answer turns the chip red', sawWrong);
  ok('a right answer turns the chip green', sawRight);
  ok('a right answer advances the card on its own', advanced);
  await q.close();
}

/* ---- 4c. the slow speed and the drawing instructions, on a device with no Spanish voice ----
 * RUMIVOICE1, 2026-09-13. The brief's one reported bug: the slow speed went silent on a device
 * with no Spanish voice, because it could only be spoken by a device voice. L5 stopped the
 * silence by switching turtle OFF on such a device — so her iPad has never had a slow speed at
 * all — and the 41 drawing instructions are still spoken only by a device voice, so on that
 * iPad every one of them is silence.
 *
 * The fixture is a real ElevenLabs recording of one of the 41, with the per-character timing the
 * service returned beside it (scripts/fixtures/). It is spliced into a temporary copy of the app,
 * so the case runs whether or not the production clips have been re-rendered yet. */
{
  const fx = JSON.parse(readFileSync(resolve(here, 'fixtures', 'eleven-baja-una-linea-grande.json'), 'utf8'));
  const spans = wordSpans(fx.text, fx.alignment);
  const key = fx.text.replace(/\s+/g, ' ').trim().toLowerCase();
  let html = readFileSync(PAGE, 'utf8');
  const clipTag = `<script>window.RUMI_CLIPS[${JSON.stringify(key)}] = ${JSON.stringify(fx.mp3_base64)};</script>`;
  const timesBody = `window.RUMI_TIMES = ${JSON.stringify({ [key]: spans })};`;
  const TIMES_TAG = /(<script id="rumiTimes">)([\s\S]*?)(<\/script>)/;
  /* After the cue tag and before the app script, which reads both maps once at boot. */
  const at = html.indexOf('</script>', html.indexOf('<script id="rumiCues">')) + '</script>'.length;
  html = TIMES_TAG.test(html)
    ? html.slice(0, at) + clipTag + html.slice(at).replace(TIMES_TAG, (_m, o, _b, c) => `${o}${timesBody}${c}`)
    : html.slice(0, at) + clipTag + `<script id="rumiTimes">${timesBody}</script>` + html.slice(at);
  const FIXTURE = join(mkdtempSync(join(tmpdir(), 'rumi-timed-')), 'rumi-fixture-timed.html');
  writeFileSync(FIXTURE, html);

  const cx = await browser.newContext();
  const t = await cx.newPage();
  t.on('pageerror', (e) => console.log(`      pageerror: ${e.message.slice(0, 200)}`));
  await t.addInitScript(INSTRUMENT);
  await t.goto(`file://${FIXTURE}`);
  await t.waitForTimeout(400);
  await t.click('#unlockBtn');
  await t.waitForTimeout(300);
  const words = fx.text.split(/\s+/).length;
  const clear = () => t.evaluate(() => { stopSpeech(); window.__a.starts = []; window.__a.synth = []; });

  await clear();
  await t.evaluate((line) => speakStroke(line), fx.text);
  await t.waitForTimeout(7000);
  let s = await t.evaluate(() => window.__a);
  ok('a drawing instruction is audible on a device with no Spanish voice', audible(s.starts).length > 0,
     `started: ${JSON.stringify(s.starts)}, device-voice attempts: ${JSON.stringify(s.synth)}`);

  ok('the slow speed is offered on a device with no Spanish voice once recordings carry timing',
     await t.evaluate(() => !document.querySelector('.sp[data-speed="turtle"]').disabled));

  await clear();
  await t.evaluate((line) => { S.speed = 'turtle'; speak(line); }, fx.text);
  await t.waitForTimeout(7000);
  s = await t.evaluate(() => window.__a);
  const heard = audible(s.starts);
  const offsets = heard.map((x) => x.offset);
  ok(`the slow speed plays the real recording one word at a time (${words} words, ${words} starts)`,
     heard.length === words && offsets.every((o, i) => !i || o > offsets[i - 1]),
     `started: ${JSON.stringify(s.starts)}, device-voice attempts: ${JSON.stringify(s.synth)}`);
  ok('a word-by-word read keeps the pitch (no resampling)', heard.length > 0 && heard.every((x) => x.rate === 1),
     `rates: ${JSON.stringify(heard.map((x) => x.rate))}`);

  /* The fallback is today's behaviour, exactly: a line with a clip and no timing, on a device
   * with no voice, plays its whole clip once. "Gracias" is a shipped clip with no timing. */
  await clear();
  await t.evaluate(() => { S.speed = 'turtle'; speak('Gracias'); });
  await t.waitForTimeout(2500);
  s = await t.evaluate(() => window.__a);
  ok('a line with no timing still plays its whole clip at the slow speed, as it does today',
     audible(s.starts).length === 1 && audible(s.starts)[0].offset === 0,
     `started: ${JSON.stringify(s.starts)}`);

  /* Mute is a gain change, never a refusal: every word still runs, so what follows keeps time. */
  await clear();
  await t.evaluate((line) => { S.muted = true; S.speed = 'turtle'; speak(line); }, fx.text);
  await t.waitForTimeout(7000);
  s = await t.evaluate(() => window.__a);
  ok('a muted word-by-word read still runs every word at gain 0',
     s.starts.filter((x) => x.dur > 0.05 && x.gain === 0).length === words,
     `started: ${JSON.stringify(s.starts)}`);
  await t.evaluate(() => { S.muted = false; });
  await cx.close();
}

/* ---- 5. the setting survives a reload, which is how all three bugs became permanent ---- */
await page.reload();
await page.waitForTimeout(500);
ok('the app comes back unmuted after a reload',
   await page.evaluate(() => JSON.parse(localStorage.getItem('rumi.v1') || '{}').muted === false));

await browser.close();

console.log(`\n${pass.length} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
