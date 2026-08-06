#!/usr/bin/env node
/**
 * The places pipeline.
 *
 *   site/data/places.json   in   — a list of places, hand-written
 *   site/data/been.json     out  — the same list with a photograph attached
 *   site/static/imgs/been/  out  — the photographs
 *
 * ADDING A PLACE IS ONE LINE: {"name": "Crater Lake", "where": "Oregon"}. Run
 * this and it comes back with a photograph, if Wikimedia Commons has a freely
 * licensed one — which for national parks, landmarks and most towns, it does.
 *
 * Same shape as fetch-titles.mjs and for the same reasons: Wikidata is CC0,
 * Commons files carry a licence that can be checked, and everything ends up
 * served from this origin rather than hotlinked.
 *
 * CC BY and CC BY-SA REQUIRE ATTRIBUTION. Every photographer's name and licence
 * comes back with the image and the template renders them. That credit line is
 * the price of the picture.
 *
 * RUN LOCALLY, COMMIT THE OUTPUT — needs cwebp.
 *
 * Usage:  node scripts/fetch-places.mjs [in] [out] [outDir]
 */

import { readFileSync, writeFileSync, mkdirSync, unlinkSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";

const IN = resolve(process.argv[2] || "site/data/places.json");
const OUT = resolve(process.argv[3] || "site/data/been.json");
const DIR = resolve(process.argv[4] || "site/static/imgs/been");

const UA = {
  "User-Agent": "parkerhunt.me-build/1.0 (https://parkerhunt.me; email@parkerhunt.me)",
  Accept: "application/json",
};

const ALLOWED = [/^cc0/i, /^public domain/i, /^pd/i, /^cc by/i, /^cc-by/i, /^gfdl/i];

let hasCwebp = true;
try {
  execFileSync("cwebp", ["-version"], { stdio: "ignore" });
} catch {
  hasCwebp = false;
  console.warn("WARNING: cwebp not found — no images will be written.");
}

const plain = (h) =>
  String(h || "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function getJSON(url, ms = 25000) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function entity(qid) {
  const j = await getJSON(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
  return j?.entities?.[qid] || null;
}

/* P18 is "image" — for a place that is a photograph of the place, which is
   exactly what is wanted here. (For a television series it is usually a photo
   of the cast at a convention, which is why fetch-titles.mjs asks for P154
   instead.) */
async function photoFor(qid) {
  const e = await entity(qid);
  if (!e) return null;
  const file = e.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  return file || null;
}

async function commons(file, key) {
  const api = new URL("https://commons.wikimedia.org/w/api.php");
  api.search = new URLSearchParams({
    action: "query", format: "json", titles: `File:${file}`,
    prop: "imageinfo", iiprop: "url|extmetadata|mime", iiurlwidth: "900",
  });
  const info = Object.values((await getJSON(api))?.query?.pages || {})[0]?.imageinfo?.[0];
  if (!info) return null;

  const m = info.extmetadata || {};
  const licence = plain(m.LicenseShortName?.value) || "unknown";
  if (!ALLOWED.some((re) => re.test(licence))) return { refused: licence };
  if (!hasCwebp) return null;

  const res = await fetch(info.thumburl || info.url, { headers: UA, signal: AbortSignal.timeout(40000) });
  if (!res.ok) return null;
  const tmp = join(tmpdir(), `place-${key}.bin`);
  writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  const out = join(DIR, `${key}.webp`);
  try {
    // 560px wide at q72: these render around 260 CSS px in the grid, so this is
    // retina and no more. Thirty of them come to well under a megabyte.
    execFileSync("cwebp", ["-quiet", "-q", "72", "-resize", "560", "0", tmp, "-o", out]);
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
  return {
    src: `/imgs/been/${key}.webp`,
    licence,
    author: plain(m.Artist?.value) || "Unknown",
    source: info.descriptionurl,
    credit_required: /^cc by|^cc-by|^gfdl/i.test(licence),
    bytes: statSync(out).size,
  };
}

const input = JSON.parse(readFileSync(IN, "utf8"));
mkdirSync(DIR, { recursive: true });

let withPhoto = 0, refused = 0, bytes = 0;

/* Two lists, one loop. A ski resort is a place with a photograph, so there is
   no reason for it to have its own script — only its own section. */
async function collect(rows, label) {
  const out = [];
  for (const p of rows) {
    const key = slug(`${p.name}-${p.where}`);
    const row = { ...p, key };
    delete row.q;

    if (!p.no_photo) {
      try {
      /* `file` pins a Commons filename outright. Needed where the Wikidata
         item carries no P18 at all — both Aspen Snowmass and Sun Valley are
         like that — and it skips the item lookup entirely. */
      if (p.file) {
        const img = await commons(p.file, key);
        if (img?.refused) refused++;
        else if (img) { row.photo = img; withPhoto++; bytes += img.bytes; }
        out.push(row);
        process.stdout.write(`  ${label} ${p.name.padEnd(22)} ${(p.where || "").padEnd(20)} ${row.photo ? "photo (pinned)" : "—"}\n`);
        await sleep(200);
        continue;
      }

      let qid = p.qid;
      if (!qid) {
        const u =
          "https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&limit=4&type=item&search=" +
          encodeURIComponent(p.q || p.name);
        qid = ((await getJSON(u))?.search || [])[0]?.id || null;
      }
      if (qid) {
        row.qid = qid;
        const file = await photoFor(qid);
        if (file) {
          const img = await commons(file, key);
          if (img?.refused) refused++;
          else if (img) { row.photo = img; withPhoto++; bytes += img.bytes; }
        }
      }
      } catch (err) {
      console.warn(`  ${p.name}: ${err.message}`);
      }
    }

    out.push(row);
    process.stdout.write(`  ${label} ${p.name.padEnd(22)} ${(p.where || "").padEnd(20)} ${row.photo ? "photo" : "—"}\n`);
    await sleep(200);
  }
  return out;
}

const places = await collect(input.places, "place");
const skiing = await collect(input.skiing || [], "ski  ");

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      fetched: new Date().toISOString().slice(0, 10),
      source: "https://www.wikidata.org (CC0); photographs from Wikimedia Commons",
      count: places.length,
      ski_count: skiing.length,
      with_photo: withPhoto,
      places,
      skiing,
    },
    null,
    2
  ) + "\n"
);

console.log(
  `Places: ${places.length} + ${skiing.length} resorts, ${withPhoto} with a photograph (${(bytes / 1024).toFixed(0)} KB)` +
    (refused ? `, ${refused} refused as non-free` : "") + ` -> ${OUT}`
);
