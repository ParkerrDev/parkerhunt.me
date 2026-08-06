#!/usr/bin/env node
/**
 * Pull real brand logos from Wikimedia Commons into site/static/imgs/logos/
 * and record what each one is licensed under in site/data/logos.json.
 *
 * RUN LOCALLY, COMMIT THE OUTPUT (needs cwebp for the raster ones).
 *
 * WHY THIS EXISTS ALONGSIDE fetch-icons.mjs
 *
 * Simple Icons is a monochrome set. It carries the big software brands and
 * nothing else, and the marks in it are single-colour silhouettes. Commons
 * carries the rest — including full-colour logos, and a surprising number of
 * company wordmarks that are outright public domain because a wordmark set in a
 * typeface is below the threshold of originality in US copyright law.
 *
 * So: Simple Icons for the monochrome software marks, this for everything else.
 *
 * EVERY FILE BELOW WAS CHECKED BY HAND and every licence recorded. CC BY and
 * CC BY-SA require attribution and the credit is rendered on the page; GPL and
 * public-domain files do not, and are credited anyway. Nothing is downloaded
 * unless its licence is on the ALLOWED list, which is the guardrail: adding a
 * file whose licence turns out to be "fair use" fails loudly instead of quietly
 * putting a non-free logo on a public site.
 *
 * STILL MISSING, AND NOT FOR WANT OF LOOKING: Chipotle, Cattlemens, Butterfish
 * and Kuppa Joy. Commons has no free file for any of them — the first is a
 * pictorial mark that is above the originality threshold, and the other three
 * are local businesses nobody has uploaded. Those keep their lettermarks.
 *
 * Usage:  node scripts/fetch-logos.mjs [outDir] [dataFile]
 */

import { writeFileSync, mkdirSync, unlinkSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";

const DIR = resolve(process.argv[2] || "site/static/imgs/logos");
const DATA = resolve(process.argv[3] || "site/data/logos.json");

const UA = {
  "User-Agent": "parkerhunt.me-build/1.0 (https://parkerhunt.me; email@parkerhunt.me)",
};

/* key -> exact Commons filename. `pad` leaves breathing room inside the disc
   for wordmarks, which are much wider than they are tall. */
const WANT = [
  { key: "dutchbros", file: "Dutch Bros Coffee wordmark.svg", pad: true },
  { key: "nobara", file: "Nobara logotype.png", pad: true },
  { key: "cachyos", file: "CachyOS Logo.svg" },
  { key: "windows", file: "Windows logo - 2021 (Black).svg" },
];

/* Licences that may be redistributed from this site. Anything else — most
   importantly Commons' "fair use" tags — is refused. */
const ALLOWED = [
  /^cc0/i, /^public domain/i, /^pd/i, /^cc by/i, /^cc-by/i,
  /^gpl/i, /^lgpl/i, /^gfdl/i, /^mit/i, /^apache/i,
];

try {
  execFileSync("cwebp", ["-version"], { stdio: "ignore" });
} catch {
  console.error("ERROR: cwebp not found. brew install webp");
  process.exit(1);
}

const plain = (h) =>
  String(h || "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

mkdirSync(DIR, { recursive: true });
const logos = {};
let failed = 0;

for (const w of WANT) {
  const api = new URL("https://commons.wikimedia.org/w/api.php");
  api.search = new URLSearchParams({
    action: "query",
    format: "json",
    titles: `File:${w.file}`,
    prop: "imageinfo",
    iiprop: "url|extmetadata|mime|size",
    // Commons renders SVG to PNG on request, which is what we want: an SVG
    // pulled straight in would drag its own <style> and fonts along with it.
    iiurlwidth: "512",
  });

  let info;
  try {
    const j = await (await fetch(api, { headers: UA, signal: AbortSignal.timeout(30000) })).json();
    info = Object.values(j?.query?.pages || {})[0]?.imageinfo?.[0];
    if (!info) throw new Error("no such file on Commons");
  } catch (err) {
    console.error(`ERROR: ${w.key}: ${err.message}`);
    failed++;
    continue;
  }

  const m = info.extmetadata || {};
  const licence = plain(m.LicenseShortName?.value) || "unknown";

  if (!ALLOWED.some((re) => re.test(licence))) {
    console.error(`REFUSED: ${w.key} is "${licence}" — not a licence this site can redistribute.`);
    failed++;
    continue;
  }

  try {
    const res = await fetch(info.thumburl || info.url, { headers: UA, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const tmp = join(tmpdir(), `logo-${w.key}.bin`);
    writeFileSync(tmp, buf);
    const out = join(DIR, `${w.key}.webp`);
    // -q 90 because these are flat-colour marks, where webp's chroma
    // subsampling shows up as fringing long before it does on a photograph.
    execFileSync("cwebp", ["-quiet", "-q", "90", "-resize", "256", "0", tmp, "-o", out]);
    unlinkSync(tmp);

    logos[w.key] = {
      src: `/imgs/logos/${w.key}.webp`,
      pad: !!w.pad,
      licence,
      author: plain(m.Artist?.value) || "Unknown",
      source: info.descriptionurl || `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(w.file)}`,
      // CC BY / CC BY-SA / GFDL oblige us to name the author on the page; CC0
      // and public domain do not. The template reads this rather than guessing.
      credit_required: /^cc by|^cc-by|^gfdl/i.test(licence),
      bytes: statSync(out).size,
    };
    console.log(`  ${w.key.padEnd(12)} ${licence.padEnd(16)} ${(logos[w.key].bytes / 1024).toFixed(1)} KB`);
  } catch (err) {
    console.error(`ERROR: ${w.key}: ${err.message}`);
    failed++;
  }
}

mkdirSync(dirname(DATA), { recursive: true });
writeFileSync(
  DATA,
  JSON.stringify({ fetched: new Date().toISOString().slice(0, 10), logos }, null, 2) + "\n"
);

console.log(`Logos: ${Object.keys(logos).length} fetched, ${failed} failed -> ${DATA}`);
if (failed) process.exitCode = 1;
