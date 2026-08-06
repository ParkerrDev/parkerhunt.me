#!/usr/bin/env node
/**
 * Download the photographs and book covers the site shows, convert them to
 * WebP, and write site/data/media.json with the credit line each one needs.
 *
 * RUN LOCALLY, COMMIT THE OUTPUT. Same two reasons as fetch-steam-art.mjs: it
 * shells out to cwebp, which is not on Cloudflare's builder, and the entire
 * point is that a visitor's browser never resolves upload.wikimedia.org or
 * covers.openlibrary.org.
 *
 * TWO SOURCES, TWO DIFFERENT SITUATIONS
 *
 * The mountain photographs come from Wikimedia Commons and are freely licensed
 * — CC BY or CC BY-SA — which is not the same as free of obligations. Every one
 * of those licences REQUIRES attribution, so the author, the licence and a link
 * back to the file page are pulled from the API alongside the image and land in
 * media.json. The template renders them. Do not drop the credit line; that is
 * the price of the picture, and it is a fair one.
 *
 * The book covers come from Open Library. Jacket art is the publisher's, not
 * ours and not Open Library's; it is shown here at thumbnail size to identify a
 * specific edition on a personal reading list, which is the ordinary use every
 * library catalogue and bookshop makes of it. Nothing is redistributed at print
 * resolution and no cover is presented as this site's own work.
 *
 * EVERY ID BELOW IS PINNED on purpose. Searching at build time would mean the
 * pictures could silently change under the site whenever Commons re-ranked its
 * results. These were chosen by hand once; a pinned id is reproducible.
 *
 * Usage:  node scripts/fetch-media.mjs [outDir] [dataFile]
 * Needs:  cwebp  (brew install webp)
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

const DIR = resolve(process.argv[2] || "site/static/imgs/media");
const DATA = resolve(process.argv[3] || "site/data/media.json");

const UA = {
  "User-Agent": "parkerhunt.me-build/1.0 (https://parkerhunt.me; email@parkerhunt.me)",
};

/* The summits, in the order they were climbed. `file` is the exact Commons
   filename — pinned, see above. */
const PEAKS = [
  {
    key: "half-dome",
    name: "Half Dome",
    where: "Yosemite, California",
    height: "8,839 ft",
    age: 6,
    file: "Half Dome from Glacier Point, Yosemite NP - Diliff.jpg",
  },
  {
    key: "el-capitan",
    name: "El Capitan",
    where: "Yosemite, California",
    height: "7,573 ft",
    age: 8,
    file: "Yosemite El Capitan.jpg",
  },
  {
    key: "mount-whitney",
    name: "Mt. Whitney",
    where: "Sierra Nevada, California",
    height: "14,505 ft",
    age: 13,
    file: "Mount Whitney September 2009.JPG",
  },
];

/* Open Library cover ids, pinned to the edition. Resolved once by searching
   Open Library and taking the match with the most editions, then written down —
   searching at build time would let the jackets change under the site. A book
   with no id here simply gets a text tile on the shelf, which is the right
   failure: a shelf with one blank rectangle on it is fine. */
const COVERS = [
  { key: "zero-to-one", id: 9002334 },
  { key: "einstein", id: 474440 },
  { key: "steve-jobs", id: 12374726 },
  { key: "power-of-positive-thinking", id: 14570194 },
  { key: "atomic-habits", id: 12539702 },
  { key: "screw-business-as-usual", id: 8845523 },
  { key: "fahrenheit-451", id: 12993656 },
  { key: "1984", id: 14351142 },
  { key: "hatchet", id: 11240448 },
  { key: "kjv", id: 10654346 },
  { key: "lord-of-the-flies", id: 8684447 },
  { key: "ready-player-one", id: 8737626 },
  { key: "holes", id: 19797 },
  { key: "the-outsiders", id: 7263662 },
  { key: "wonder", id: 8223160 },
  { key: "the-odyssey", id: 12474938 },
  { key: "romeo-and-juliet", id: 8257991 },
  { key: "robinson-crusoe", id: 368541 },
  { key: "just-for-fun", id: 6933170 },
  { key: "sleep-smarter", id: 11504647 },
  { key: "astrophysics", id: 7984709 },
];

try {
  execFileSync("cwebp", ["-version"], { stdio: "ignore" });
} catch {
  console.error("ERROR: cwebp not found. brew install webp");
  process.exit(1);
}

mkdirSync(DIR, { recursive: true });

async function download(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(45000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 2000) throw new Error(`suspiciously small response from ${url}`);
  return buf;
}

/** Convert to WebP at `width` px wide. Returns the byte size written. */
function toWebp(buf, out, width, quality) {
  const tmp = join(tmpdir(), `media-${Date.now()}-${Math.floor(buf.length)}.bin`);
  writeFileSync(tmp, buf);
  try {
    execFileSync("cwebp", ["-quiet", "-q", String(quality), "-resize", String(width), "0", tmp, "-o", out]);
  } finally {
    try {
      unlinkSync(tmp);
    } catch {}
  }
  return statSync(out).size;
}

/* Commons wraps Artist and LicenseShortName in HTML, sometimes with a link and
   sometimes with nested spans. Strip tags, collapse whitespace, unescape the
   handful of entities that actually turn up. */
function plain(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const media = { fetched: new Date().toISOString().slice(0, 10), peaks: [], covers: {} };
let bytes = 0;

// ---------------------------------------------------------------- peaks --
for (const p of PEAKS) {
  const api = new URL("https://commons.wikimedia.org/w/api.php");
  api.search = new URLSearchParams({
    action: "query",
    format: "json",
    titles: `File:${p.file}`,
    prop: "imageinfo",
    iiprop: "url|extmetadata|size",
    // Ask Commons for the scaled render rather than the 5-megapixel original.
    iiurlwidth: "1600",
  });

  let info;
  try {
    const j = await (await fetch(api, { headers: UA, signal: AbortSignal.timeout(30000) })).json();
    info = Object.values(j?.query?.pages || {})[0]?.imageinfo?.[0];
    if (!info) throw new Error("no imageinfo");
  } catch (err) {
    console.error(`ERROR: could not look up "${p.file}": ${err.message}`);
    process.exitCode = 1;
    continue;
  }

  const m = info.extmetadata || {};
  const credit = {
    author: plain(m.Artist?.value) || "Unknown",
    licence: plain(m.LicenseShortName?.value) || "see source",
    source: info.descriptionurl || `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(p.file)}`,
  };

  /* Two widths, fed to a srcset so the browser picks. The tiles render at
     roughly 370 CSS px on a wide screen and full-bleed on a phone, so 480
     covers the small case and 960 covers retina without anyone downloading a
     1400px landscape to show it 370px wide. */
  const out = { ...p, ...credit, art: {} };
  delete out.file;
  try {
    const buf = await download(info.thumburl || info.url);
    for (const [label, w, q] of [["sm", 480, 70], ["lg", 960, 68]]) {
      const file = join(DIR, `${p.key}-${w}.webp`);
      bytes += toWebp(buf, file, w, q);
      out.art[label] = `/imgs/media/${p.key}-${w}.webp`;
    }
  } catch (err) {
    console.error(`ERROR: could not fetch art for ${p.name}: ${err.message}`);
    process.exitCode = 1;
    continue;
  }
  media.peaks.push(out);
  console.log(`  ${p.name.padEnd(14)} ${credit.licence.padEnd(14)} by ${credit.author}`);
}

// --------------------------------------------------------------- covers --
for (const c of COVERS) {
  const file = join(DIR, `book-${c.key}.webp`);
  try {
    const buf = await download(`https://covers.openlibrary.org/b/id/${c.id}-L.jpg`);
    bytes += toWebp(buf, file, 400, 74);
    media.covers[c.key] = `/imgs/media/book-${c.key}.webp`;
  } catch (err) {
    console.error(`ERROR: no cover for ${c.key}: ${err.message}`);
    process.exitCode = 1;
  }
}

mkdirSync(resolve(DATA, ".."), { recursive: true });
writeFileSync(DATA, JSON.stringify(media, null, 2) + "\n");

console.log(
  `Media: ${media.peaks.length} summit photos, ${Object.keys(media.covers).length} book covers, ` +
    `${(bytes / 1024).toFixed(0)} KB total -> ${DATA}`
);
