// Render the link-preview card and the icons from their HTML sources to the PNGs that ship.
//
// WHY THE PNGs ARE COMMITTED AND THIS SCRIPT IS NOT PART OF THE BUILD. Rumi has no build step and
// no dependencies by design -- the whole app is one HTML file that Vercel serves verbatim. There is
// nothing to hang a render on, and adding a headless browser to the deploy path of a repo whose
// selling point is that it has no deploy path would be a bad trade for five images. So the PNGs are
// artefacts in git and this script is the thing that regenerates them.
//
// PLAYWRIGHT IS BORROWED, NOT DEPENDED ON. This repo has no node_modules and should not grow one
// for five PNGs. The script resolves Chromium out of a sibling repo that already has Playwright
// installed for its own tests. If that is missing it says so and exits 2 -- it never fails quietly
// or half-writes an image, because a truncated PNG in an og:image renders as a blank card, which is
// the exact failure this whole change exists to fix.
//
// Run it from the repo root:  node scripts/build-preview-assets.mjs
// Then look at the PNGs before committing. Nothing here checks that a card is legible.

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

// Sibling repos that carry Playwright for their own test suites, in the order they are tried.
const BORROW_FROM = ["bet-appetit", "vault", "roam", "rayli"];

const TARGETS = [
  {
    source: "scripts/rumi-og-card-2026-08-24.html",
    out: "rumi-og-card.png",
    width: 1200,
    height: 630,
    what: "link-preview card (og:image)",
  },
  {
    source: "scripts/rumi-icon-2026-08-24.html",
    out: "apple-touch-icon.png",
    width: 180,
    height: 180,
    what: "iOS home-screen icon",
  },
  {
    source: "scripts/rumi-icon-2026-08-24.html",
    out: "icon-32.png",
    width: 32,
    height: 32,
    what: "browser-tab icon",
  },
  // 192 and 512 are what a web-app manifest is expected to offer: Android's launcher picks 192,
  // and 512 is what a splash screen and the install prompt are generated from. Neither is optional
  // in practice -- omit them and the install prompt falls back to a screenshot of the page.
  {
    source: "scripts/rumi-icon-2026-08-24.html",
    out: "icon-192.png",
    width: 192,
    height: 192,
    what: "manifest icon, launcher",
  },
  {
    source: "scripts/rumi-icon-2026-08-24.html",
    out: "icon-512.png",
    width: 512,
    height: 512,
    what: "manifest icon, splash and install prompt",
  },
];

function findPlaywright() {
  for (const sibling of BORROW_FROM) {
    const entry = resolve(REPO, "..", sibling, "node_modules", "playwright", "index.js");
    if (existsSync(entry)) return { sibling, entry };
  }
  return null;
}

const found = findPlaywright();
if (!found) {
  console.error(
    `FAIL: no sibling repo with Playwright installed. Tried: ${BORROW_FROM.join(", ")}.\n` +
      `      Run 'npm install' in one of them, or 'npx playwright install chromium'.\n` +
      `      Nothing was written.`,
  );
  process.exit(2);
}

console.log(`playwright borrowed from ../${found.sibling}`);
// Playwright's entry point is CommonJS, so `import()` hands back a module whose named exports may
// live on `.default` depending on how Node interops it. Reach for both rather than assuming one --
// the failure mode is `undefined.launch()`, which says nothing useful about the cause.
const playwright = await import(pathToFileURL(found.entry).href);
const chromium = playwright.chromium ?? playwright.default?.chromium;
if (!chromium) {
  console.error(`FAIL: playwright at ../${found.sibling} exports no chromium. Nothing was written.`);
  process.exit(2);
}

const browser = await chromium.launch();
let wrote = 0;

try {
  for (const target of TARGETS) {
    const sourcePath = resolve(REPO, target.source);
    if (!existsSync(sourcePath)) {
      console.error(`FAIL: source missing: ${target.source}`);
      process.exit(2);
    }

    const page = await browser.newPage({
      viewport: { width: target.width, height: target.height },
      // 1 device pixel per CSS pixel. og:image dimensions are declared in the meta tags as
      // 1200x630, and a 2x render would make the file four times the size while every consumer
      // scales it back down.
      deviceScaleFactor: 1,
    });

    await page.goto(pathToFileURL(sourcePath).href, { waitUntil: "load" });
    // The mark is inline SVG and the type is a system stack, so there is no font or network wait to
    // do here. If a webfont is ever added to a card source, this is where it has to be awaited --
    // Playwright will happily screenshot a page mid-font-swap.
    await page.screenshot({
      path: resolve(REPO, target.out),
      type: "png",
      clip: { x: 0, y: 0, width: target.width, height: target.height },
    });
    await page.close();

    console.log(`wrote ${target.out}  ${target.width}x${target.height}  ${target.what}`);
    wrote += 1;
  }
} finally {
  await browser.close();
}

if (wrote !== TARGETS.length) {
  console.error(`FAIL: wrote ${wrote} of ${TARGETS.length}`);
  process.exit(1);
}
console.log(`build-preview-assets: ${wrote}/${TARGETS.length} written`);
