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
import { collectCues } from './rumi-strings.mjs';

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
 * Turtle used to bypass the clips by design (it needed one utterance per word). On this
 * voiceless device that made it silent — and the speed is persisted, so one tap of 🐢 by a
 * five-year-old muted the app across reloads.
 *
 * RUMIVOICE1 phase B, 2026-09-15: the rule this case asserted — a voiceless device must have
 * turtle DISABLED — is deliberately retired, and it had to be, because it meant her iPad never
 * had a slow speed at all. Every Spanish line now carries per-word timing, so turtle is
 * delivered from the recording itself. What the case was always protecting is unchanged and is
 * asserted directly below: turtle is never silence. The old assertion would now fail against a
 * correct build, which is exactly why it is replaced rather than deleted. */
{
  await reset();
  await page.evaluate(() => { S.speed = 'turtle'; speak('Gracias'); });
  await page.waitForTimeout(2500);
  const t3 = await seen();
  ok('the slow speed makes sound on a voiceless device instead of being taken away',
     audible(t3.starts).length > 0
       && !await page.evaluate(() => document.querySelector('.sp[data-speed="turtle"]').disabled),
     `started: ${JSON.stringify(t3.starts)}, device-voice attempts: ${JSON.stringify(t3.synth)}`);
  await page.evaluate(() => { S.speed = 'walk'; stopSpeech(); });
}

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

  /* Eliminate until the correct chip is found: which one it is is randomised per render.
   *
   * FLAKE FIXED 2026-09-15 (RUMIVOICE1 phase B). This used to take the first chip not yet
   * ruled out, which is the correct one about one render in three — and then the loop broke on
   * "right" having never seen a red chip, so "a wrong answer turns the chip red" failed on a
   * build with nothing wrong with it. Observed failing twice in four runs on 2026-09-15. The
   * order is deterministic now: the correct chip is identified first (its English caption is
   * the card's own) and deliberately left until last, so a wrong one is always judged first.
   * A test that fails one run in three teaches a reader to re-run it, which is how a real red
   * gets waved through. */
  const rightIdx = await q.evaluate(() => {
    const want = fill(cur.cards[idx].en);
    return [...document.querySelectorAll('.opt .ow')].findIndex((e) => e.textContent === want);
  });
  ok('the correct chip can be identified before it is clicked, so the order is not luck',
     rightIdx >= 0, `index: ${rightIdx}`);
  let sawWrong = false, sawRight = false, advanced = false;
  for (let round = 0; round < 3; round += 1) {
    const c = await cls();
    const open = c.map((x, n) => [x, n]).filter(([x]) => x !== 'wrong' && x !== 'right');
    /* A wrong one while any remains; the correct one only when it is all that is left. */
    const pick = open.find(([, n]) => n !== rightIdx) || open[0];
    if (!pick) break;
    const i = pick[1];
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

/* ---- 4d. the SHIPPED app, not a fixture: the 41 drawing instructions, and timing for real ----
 * RUMIVOICE1 phase B, 2026-09-15. 4c above proves the playback path works when a timed recording
 * is spliced in. It cannot prove the app actually ships any, because it replaces both maps with
 * its own fixture. This case asks the opposite question, of the file as deployed: does the build
 * on disk carry a recording and per-word timing for the drawing instructions, so that the iPad
 * with no Spanish voice hears them at every speed?
 *
 * Observed RED against 936f90c (the phase A build): 0 of 41 drawing instructions had a recording,
 * the app's timing map was empty, and the slow-speed control was disabled on a voiceless device.
 * The free Spanish voice can answer all three — it returns word boundaries alongside the audio —
 * which is what the generator change below this test does. */
{
  const strokes = collectCues(readFileSync(PAGE, 'utf8'));
  const shipped = await page.evaluate(
    (keys) => keys.filter((k) => Object.prototype.hasOwnProperty.call(window.RUMI_CLIPS || {}, k)),
    strokes.map((c) => c.key),
  );
  ok(`every drawing instruction has a recording of its own (${shipped.length} of ${strokes.length})`,
     shipped.length === strokes.length,
     `${strokes.length - shipped.length} still fall through to a device voice, i.e. to silence on her iPad`);

  const timed = await page.evaluate(() => Object.keys(window.RUMI_TIMES || {}).length);
  ok(`the build ships per-word timing (${timed} lines timed)`, timed > 0,
     'with no timing the slow speed can only be a device voice, and that is the reported bug');

  /* The whole point, end to end, on the real file: one of the 41, at the slow speed, on a device
   * with no voices at all. It must be several starts into one buffer at rising offsets — that is
   * word-by-word from the recording — and never a device-voice attempt. */
  const line = (strokes.find((c) => c.text.split(/\s+/).length >= 4) || strokes[0]).text;
  const wordCount = String(line).split(/\s+/).filter(Boolean).length;
  await reset();
  await page.evaluate((l) => { S.speed = 'turtle'; speak(l); }, line);
  await page.waitForTimeout(9000);
  const s4d = await seen();
  const heard4d = audible(s4d.starts);
  ok(`a drawing instruction plays word by word from its own recording at the slow speed (${wordCount} words)`,
     heard4d.length === wordCount
       && heard4d.every((x, i) => !i || x.offset > heard4d[i - 1].offset)
       && heard4d.every((x) => x.rate === 1)
       && s4d.synth.length === 0,
     `line: ${line}\n      started: ${JSON.stringify(s4d.starts)}, device-voice attempts: ${JSON.stringify(s4d.synth)}`);

  ok('the slow speed is available on a device with no voices at all',
     await page.evaluate(() => !document.querySelector('.sp[data-speed="turtle"]').disabled));
  await page.evaluate(() => { S.speed = 'walk'; stopSpeech(); });
}

/* ---- 4e. five voices, chosen in Grown-ups (RUMIVOICES2, 2026-09-16) ----
 * Whit: "why make me choose? let the user have like 5 options in the settings". One voice is
 * built into the page so the app works offline on first load; the other four are downloaded
 * when a grown-up picks one, kept on the device, and restored before the first word on every
 * later load. A voice that cannot be had (offline, never downloaded) must fall back to the
 * built-in one silently, never to silence.
 *
 * Served over http, not file://, because the page fetches the pack and device storage wants a
 * real origin. The pack is a synthetic one served by the test: every line is the fixture clip,
 * whose length differs from the built-in "Gracias", so which voice actually played is a
 * measurement rather than a guess. The real pack files are checked separately at the end.
 *
 * Observed RED against 68beda6 (the build this lane started from): Grown-ups listed 0 voices,
 * nothing fetched a pack, nothing was remembered, and there was no fallback to observe. The
 * full red run is in _handoffs/done-2026-09-16-rumi-rumivoices2-five-voices-in.md. */
{
  const http = await import('node:http');
  const ROOT = resolve(here, '..');
  const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    const f = resolve(ROOT, rel || 'rumi-espanol-app.html');
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[f.slice(f.lastIndexOf('.'))] || 'application/octet-stream' });
    res.end(readFileSync(f));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}`;

  const fx = JSON.parse(readFileSync(resolve(here, 'fixtures', 'eleven-baja-una-linea-grande.json'), 'utf8'));
  /* Only the key list and the ONE clip this case measures against cross the bridge. Shipping
   * the whole 7MB map back into node takes seconds and proves nothing extra. */
  const keys = await page.evaluate(() => Object.keys(window.RUMI_CLIPS || {}));
  const graciasB64 = await page.evaluate(() => (window.RUMI_CLIPS || {}).gracias || '');
  const pack = { voice: 'alma', clips: Object.fromEntries(keys.map((k) => [k, fx.mp3_base64])), times: {} };
  let packHits = 0;
  const servePack = (cx) => cx.route('**/voices/alma.json', (r) => {
    packHits += 1;
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pack) });
  });

  const durOf = (p, b64) => p.evaluate(async (s) => {
    if (!s) return null;
    const bin = atob(s);
    const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) a[i] = bin.charCodeAt(i);
    const c = new OfflineAudioContext(1, 1, 22050);
    const b = await c.decodeAudioData(a.buffer);
    return +b.duration.toFixed(2);
  }, b64);
  const lastDur = async (p) => {
    const st = audible((await p.evaluate(() => window.__a)).starts);
    return st.length ? st[st.length - 1].dur : null;
  };
  const near = (x, y) => x !== null && y !== null && Math.abs(x - y) < 0.06;
  const sayGracias = async (p) => {
    await p.evaluate(() => { stopSpeech(); S.speed = 'walk'; window.__a.starts = []; speak('Gracias'); });
    await p.waitForTimeout(1500);
    return lastDur(p);
  };
  const boot = async (p) => {
    p.on('pageerror', (e) => console.log(`      pageerror: ${e.message.slice(0, 200)}`));
    await p.addInitScript(INSTRUMENT);
    await p.goto(`${BASE}/rumi-espanol-app.html`);
    await p.waitForTimeout(500);
    await p.click('#unlockBtn');
    await p.waitForTimeout(300);
  };

  const cx = await browser.newContext();
  await servePack(cx);
  const v = await cx.newPage();
  await boot(v);
  const fxDur = await durOf(v, fx.mp3_base64);
  const builtInDur = await durOf(v, graciasB64);
  console.log(`      built-in "Gracias" ${builtInDur}s, test pack clip ${fxDur}s`);
  /* If these two were the same length every assertion below would pass on a build that never
   * swapped anything, so the case has to prove its own instrument first. */
  ok('the two voices in this case are distinguishable by ear-length',
     fxDur !== null && builtInDur !== null && Math.abs(fxDur - builtInDur) > 0.2,
     `pack clip ${fxDur}s vs built-in ${builtInDur}s — too close to tell apart`);

  await v.click('#toSettings');
  await v.waitForTimeout(300);
  const rows = await v.$$eval('#voiceList .voiceopt', (els) => els.map((e) => ({ slug: e.dataset.voice, text: e.textContent })));
  ok(`Grown-ups lists five voices (${rows.length})`, rows.length === 5, JSON.stringify(rows));
  ok('every voice says where it is from, Spain or Latin America',
     rows.length === 5 && rows.every((r) => /Spain|Latin America/.test(r.text)), JSON.stringify(rows));
  ok('the built-in voice is the one selected on a fresh device',
     await v.evaluate(() => { const e = document.querySelector('#voiceList .voiceopt.on'); return !!e && e.dataset.voice === 'ines'; }));

  await v.evaluate(() => { window.__a.starts = []; });
  const almaRow = await v.$('#voiceList .voiceopt[data-voice="alma"]');
  if (almaRow) await almaRow.click();
  await v.waitForTimeout(3000);
  ok('choosing a downloadable voice fetches its pack once', packHits === 1, `requests: ${packHits}`);
  ok('the chosen voice is marked selected',
     await v.evaluate(() => { const e = document.querySelector('#voiceList .voiceopt.on'); return !!e && e.dataset.voice === 'alma'; }));
  ok('tapping a voice plays a sample of that voice', near(await lastDur(v), fxDur),
     `last start ${await lastDur(v)}s, pack clip ${fxDur}s`);
  const after = await sayGracias(v);
  ok('after choosing it, Rumi speaks with the chosen voice', near(after, fxDur), `played ${after}s, pack clip ${fxDur}s`);
  ok('the choice is remembered', await v.evaluate(() => { try { return localStorage.getItem('rumi.voice') === 'alma'; } catch (e) { return false; } }));

  /* Reload with the network for voices cut: the voice must come back from the device. */
  await cx.unroute('**/voices/alma.json');
  await cx.route('**/voices/**', (r) => r.abort());
  await v.reload();
  await v.waitForTimeout(800);
  await v.click('#unlockBtn');
  await v.waitForTimeout(300);
  const restored = await sayGracias(v);
  ok('the chosen voice survives a reload, from the device, with no network', near(restored, fxDur),
     `played ${restored}s, pack clip ${fxDur}s, built-in ${builtInDur}s`);
  await cx.close();

  /* A voice that cannot be downloaded: the built-in voice carries on and the setting says so. */
  const cf = await browser.newContext();
  await cf.route('**/voices/**', (r) => r.abort());
  const w = await cf.newPage();
  await boot(w);
  await w.click('#toSettings');
  await w.waitForTimeout(300);
  const valRow = await w.$('#voiceList .voiceopt[data-voice="valeria"]');
  if (valRow) await valRow.click();
  await w.waitForTimeout(2500);
  const fb = await sayGracias(w);
  ok('a failed download falls back to the built-in voice, not to silence', near(fb, builtInDur),
     `played ${fb}s, built-in ${builtInDur}s`);
  ok('the setting shows the built-in voice is the one in use',
     await w.evaluate(() => {
       const on = document.querySelector('#voiceList .voiceopt.on');
       const note = (document.getElementById('voiceNote') || {}).textContent || '';
       return !!on && on.dataset.voice === 'ines' && /Valeria/.test(note);
     }));

  /* A saved choice that is not on the device and cannot be fetched, at boot. */
  await w.evaluate(() => { try { localStorage.setItem('rumi.voice', 'sofia'); } catch (e) { /* keep going */ } });
  await w.reload();
  await w.waitForTimeout(1200);
  await w.click('#unlockBtn');
  await w.waitForTimeout(300);
  const fb2 = await sayGracias(w);
  ok('a saved voice that cannot be had at startup falls back to the built-in voice', near(fb2, builtInDur),
     `played ${fb2}s, built-in ${builtInDur}s`);
  await cf.close();

  /* The real files, on disk and served: every downloadable voice has a pack beside the page,
   * and it covers the same lines the built-in one does. A pack short of a line is that line
   * falling back to a device voice, i.e. to silence on the iPad this app exists for. */
  const registry = await page.evaluate(() => (window.RUMI_VOICES || []).map((x) => ({ slug: x.slug, embedded: !!x.embedded })));
  ok(`the app carries a registry of five voices (${registry.length})`, registry.length === 5, JSON.stringify(registry));
  ok('exactly one of them is the built-in voice',
     registry.filter((x) => x.embedded).length === 1, JSON.stringify(registry));
  for (const r of registry.filter((x) => !x.embedded)) {
    /* eslint-disable no-await-in-loop */
    const real = await fetch(`${BASE}/voices/${r.slug}.json`).then((res) => (res.ok ? res.json() : null)).catch(() => null);
    const n = real ? Object.keys(real.clips || {}).length : 0;
    ok(`the real pack is served beside the page (voices/${r.slug}.json, ${n} clips)`,
       n === keys.length, real ? `${n} clips vs ${keys.length} built in` : 'not served');
    /* eslint-enable no-await-in-loop */
  }
  server.close();
}

/* ---- 5. the setting survives a reload, which is how all three bugs became permanent ---- */
await page.reload();
await page.waitForTimeout(500);
ok('the app comes back unmuted after a reload',
   await page.evaluate(() => JSON.parse(localStorage.getItem('rumi.v1') || '{}').muted === false));

await browser.close();

console.log(`\n${pass.length} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
