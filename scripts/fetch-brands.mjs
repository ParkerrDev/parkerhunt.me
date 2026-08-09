#!/usr/bin/env node
/**
 * Business logos, from each business's own website.
 *
 *   site/data/brands.json          out, the manifest
 *   site/static/imgs/brands/*.webp out, the logos
 *
 * RUN LOCALLY, COMMIT THE OUTPUT (needs cwebp).
 *
 * WHY THIS AND NOT COMMONS
 *
 * Wikimedia Commons only has a company's logo when the logo is simple enough to
 * be public domain. That gets you Starbucks' wordmark and nothing else, not
 * the siren, not Chipotle's pepper, and obviously nothing at all for a
 * six-branch coffee chain in Fresno. What every company DOES publish is its own
 * site icon: an apple-touch-icon or a large favicon, which for a restaurant is
 * almost always the actual logo at 180-256px on a transparent or brand-coloured
 * background. icon.horse resolves that in one request, with no key.
 *
 * A logo is a trademark, and this uses each one to refer to the business it
 * names ("this is my Chipotle order") which is nominative use and the same
 * basis as scripts/fetch-icons.mjs. Nothing is altered and nothing suggests any
 * of these companies endorse anything. Each file is fetched once here and
 * served from this origin, so no visitor's browser ever contacts icon.horse.
 *
 * Usage:  node scripts/fetch-brands.mjs [outDir] [dataFile]
 */

import { writeFileSync, mkdirSync, unlinkSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";

const DIR = resolve(process.argv[2] || "site/static/imgs/brands");
const DATA = resolve(process.argv[3] || "site/data/brands.json");

/* key -> the company's own domain. That is the whole configuration. */
const WANT = [
  { key: "starbucks", domain: "starbucks.com" },
  /* icon.horse only finds a 32px favicon for Kuppa Joy, so their logo comes
     straight off their own homepage instead, it is right there in the header,
     at 400px, which is exactly the mark and exactly the size wanted. `url`
     exists for this case and skips the icon lookup entirely. */
  { key: "kuppajoy", domain: "kuppajoy.com",
    url: "https://kuppajoy.com/wp-content/uploads/2016/08/Kuppa-Joy_Dark-Logo-Sticky-HD.png" },
  { key: "dutchbros", domain: "dutchbros.com" },
  { key: "chipotle", domain: "chipotle.com" },
  { key: "butterfish", domain: "butterfishpoke.com" },
  { key: "takis", domain: "takisusa.com" },
];

try {
  execFileSync("cwebp", ["-version"], { stdio: "ignore" });
} catch {
  console.error("ERROR: cwebp not found. brew install webp");
  process.exit(1);
}

/* PLATE, BY HAND, ON PURPOSE.
 *
 * Two rounds were spent trying to derive this, average ink luminance, then
 * opaque-pixel fraction, and both got it wrong in opposite directions:
 * Starbucks' green siren on white was classified as light ink and put on a
 * black tile, while Butterfish's white B was classified as self-contained and
 * left invisible on a white one. The pixels do not carry the answer, because
 * "what does this picture need behind it" is a judgement about a picture.
 *
 * There are five marks. Looking at them takes less time than the heuristic did.
 */
const PLATE = {
  starbucks: "light",   // green siren, white ground
  dutchbros: "light",   // navy windmill, pale blue ground
  chipotle: "light",    // dark red roundel
  butterfish: "light",  // grey B on its own pale ground
  kuppajoy: "light",    // dark wordmark on transparent
  takis: "dark",        // white mark on transparent
};

/* Wide or square? A site icon is usually a square with the mark inset in it,
   so capping every logo at one height makes the square ones look shrunken and
   the wordmarks look enormous. Read the dimensions out of the PAM header,
   which is a text line, so this needs no decoding at all. */
function isWide(webpPath) {
  try {
    const head = execFileSync("dwebp", ["-quiet", "-pam", webpPath, "-o", "-"], { maxBuffer: 8 * 1024 * 1024 })
      .subarray(0, 120).toString("latin1");
    const w = +(head.match(/WIDTH (\d+)/)?.[1] || 0);
    const h = +(head.match(/HEIGHT (\d+)/)?.[1] || 0);
    return w && h ? w / h > 1.6 : false;
  } catch {
    return false;
  }
}

mkdirSync(DIR, { recursive: true });
const brands = {};
let failed = 0;

for (const w of WANT) {
  try {
    const res = await fetch(w.url || `https://icon.horse/icon/${w.domain}`, {
      headers: { "User-Agent": "parkerhunt.me-build/1.0 (https://parkerhunt.me)" },
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());

    /* A 32×32 favicon is a favicon, not a logo, it will look like mush at the
       size these render. Anything under 1 KB is almost always that, or a
       placeholder, so refuse it rather than ship a blurry square. */
    if (buf.length < 1000) throw new Error(`only ${buf.length} bytes, probably a 32px favicon, not a logo`);

    const tmp = join(tmpdir(), `brand-${w.key}.bin`);
    writeFileSync(tmp, buf);
    const out = join(DIR, `${w.key}.webp`);
    // -q 92 and no resize: these arrive at 180-256px, which is already the
    // right size, and hard-edged marks show webp artefacts early.
    execFileSync("cwebp", ["-quiet", "-q", "92", tmp, "-o", out]);
    unlinkSync(tmp);

    brands[w.key] = { src: `/imgs/brands/${w.key}.webp`, domain: w.domain, plate: PLATE[w.key] || "light", wide: isWide(out), bytes: statSync(out).size };
    console.log(`  ${w.key.padEnd(12)} ${w.domain.padEnd(22)} ${(brands[w.key].bytes / 1024).toFixed(1)} KB`);
  } catch (err) {
    console.error(`  ${w.key.padEnd(12)} ${w.domain.padEnd(22)} FAILED: ${err.message}`);
    failed++;
  }
}

mkdirSync(dirname(DATA), { recursive: true });
writeFileSync(
  DATA,
  JSON.stringify(
    {
      fetched: new Date().toISOString().slice(0, 10),
      source: "each company's own site icon, resolved via icon.horse",
      note: "Trademarks of their owners, used nominatively to name the business. Served from this origin, never hotlinked.",
      brands,
    },
    null,
    2
  ) + "\n"
);

console.log(`Brands: ${Object.keys(brands).length} logos, ${failed} failed -> ${DATA}`);
