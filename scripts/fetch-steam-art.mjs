#!/usr/bin/env node
/**
 * Download the store header for every game in site/data/steam.json, convert it
 * to WebP and write it to site/static/imgs/steam/<appid>.webp.
 *
 * RUN THIS LOCALLY, NOT ON THE BUILDER, AND COMMIT THE RESULT.
 *
 * Two reasons it is not part of build-zola.sh:
 *
 *   1. It shells out to cwebp, which is not on Cloudflare's build image.
 *   2. The whole point of the exercise is that no visitor's browser ever
 *      resolves a Steam CDN hostname. Fetching the art at build time and
 *      serving it from this origin is what makes that true; fetching it in the
 *      page would not.
 *
 * 268px wide is deliberate: the rows render the capsule at ~134 CSS px, so this
 * is exactly 2x for retina and nothing more. At q70 that lands around 4 KB a
 * game — the whole 100-game set is smaller than one uncompressed screenshot.
 *
 * Usage:  node scripts/fetch-steam-art.mjs [snapshot] [outDir]
 * Needs:  cwebp  (brew install webp)
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync, unlinkSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

const SNAP = resolve(process.argv[2] || "site/data/steam.json");
const DIR = resolve(process.argv[3] || "site/static/imgs/steam");
const WIDTH = 268;
const QUALITY = 70;

if (!existsSync(SNAP)) {
  console.error(`ERROR: no snapshot at ${SNAP}. Run scripts/fetch-steam.mjs first.`);
  process.exit(1);
}

try {
  execFileSync("cwebp", ["-version"], { stdio: "ignore" });
} catch {
  console.error("ERROR: cwebp not found. brew install webp");
  process.exit(1);
}

/* by_appid is every game in the snapshot — owned, wishlisted and the
   played-elsewhere extras — so it is the only list to walk. */
const snap = JSON.parse(readFileSync(SNAP, "utf8"));
const jobs = Object.values(snap.by_appid || {});

mkdirSync(DIR, { recursive: true });

/* Prefer the exact URL the store API gave us: apps published in the last couple
   of years put their art under a content hash
   (store_item_assets/steam/apps/<id>/<sha>/header.jpg) that cannot be guessed
   from the appid. The two flat paths are the fallback for older apps and for
   snapshots written before art_src existed. */
function candidates(app) {
  return [
    app.art_src,
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${app.appid}/header.jpg`,
    `https://cdn.akamai.steamstatic.com/steam/apps/${app.appid}/header.jpg`,
  ].filter(Boolean);
}

let written = 0;
let skipped = 0;
const failed = [];

for (const app of jobs) {
  const out = join(DIR, `${app.appid}.webp`);
  if (existsSync(out) && statSync(out).size > 0 && !process.env.FORCE) {
    skipped++;
    continue;
  }

  let buf = null;
  for (const url of candidates(app)) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "parkerhunt.me-build" },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) continue;
      const ab = await res.arrayBuffer();
      if (ab.byteLength > 1000) {
        buf = Buffer.from(ab);
        break;
      }
    } catch {
      /* try the next host */
    }
  }

  if (!buf) {
    failed.push(`${app.appid} ${app.name}`);
    continue;
  }

  const tmp = join(tmpdir(), `steam-${app.appid}.jpg`);
  writeFileSync(tmp, buf);
  try {
    execFileSync("cwebp", ["-quiet", "-q", String(QUALITY), "-resize", String(WIDTH), "0", tmp, "-o", out]);
    written++;
  } catch (err) {
    failed.push(`${app.appid} ${app.name} (cwebp: ${err.message})`);
  } finally {
    try {
      unlinkSync(tmp);
    } catch {}
  }
}

const bytes = jobs.reduce((n, a) => {
  const p = join(DIR, `${a.appid}.webp`);
  return n + (existsSync(p) ? statSync(p).size : 0);
}, 0);

console.log(
  `Steam art: ${written} written, ${skipped} already present, ${failed.length} failed — ` +
    `${(bytes / 1024).toFixed(0)} KB total for ${jobs.length} games`
);

/* A missing capsule is a broken <img> on the page, so say which one loudly
   rather than letting it slip through into a deploy. */
if (failed.length) {
  console.warn("Missing art for:");
  for (const f of failed) console.warn(`  - ${f}`);
  process.exitCode = 1;
}
