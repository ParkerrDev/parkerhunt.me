#!/usr/bin/env node
/**
 * The places pipeline.
 *
 *   site/data/places.json   in , a list of places, hand-written
 *   site/data/been.json     out, the same list with a photograph attached
 *   site/static/imgs/been/  out, the photographs
 *
 * ADDING A PLACE IS ONE LINE: {"name": "Crater Lake", "where": "Oregon"}. Run
 * this and it comes back with a photograph, if Wikimedia Commons has a freely
 * licensed one, which for national parks, landmarks and most towns, it does.
 *
 * Same shape as fetch-titles.mjs and for the same reasons: Wikidata is CC0,
 * Commons files carry a licence that can be checked, and everything ends up
 * served from this origin rather than hotlinked.
 *
 * CC BY and CC BY-SA REQUIRE ATTRIBUTION. Every photographer's name and licence
 * comes back with the image and the template renders them. That credit line is
 * the price of the picture.
 *
 * RUN LOCALLY, COMMIT THE OUTPUT, needs cwebp.
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
  console.warn("WARNING: cwebp not found, no images will be written.");
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

/* P18 is "image", for a place that is a photograph of the place, which is
   exactly what is wanted here. (For a television series it is usually a photo
   of the cast at a convention, which is why fetch-titles.mjs asks for P154
   instead.) P625 is "coordinate location", which every one of these has.
   One entity fetch, both answers. */
async function factsFor(qid) {
  const e = await entity(qid);
  if (!e) return {};
  const c = e.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
  return {
    file: e.claims?.P18?.[0]?.mainsnak?.datavalue?.value || null,
    // Six decimal places is ~11 cm. Four is ~11 m and is plenty for "I went
    // here"; it also keeps been.json from growing a kilobyte of noise.
    lat: c ? Math.round(c.latitude * 1e4) / 1e4 : null,
    lon: c ? Math.round(c.longitude * 1e4) / 1e4 : null,
  };
}

/* Wikidata has two searches and they disagree. `wbsearchentities` matches
   labels and aliases only, so "Row River Trail" finds nothing even though the
   item exists, it is filed under "Row River National Recreation Trail". The
   full-text search finds it. Try the precise one first, fall back to the broad
   one.

   The two calls take DIFFERENT terms, and that is load-bearing. The label
   search wants the name on its own, adding ", Oregon" to "Timberline Lodge"
   makes it miss an item it would otherwise hit exactly. The full-text search
   wants the opposite: the place plus its state, or "Sanger" comes back as a
   German engineer. */
async function findQid(exact, broad) {
  const a =
    "https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&limit=4&type=item&search=" +
    encodeURIComponent(exact);
  const hit = ((await getJSON(a))?.search || [])[0]?.id;
  if (hit) return hit;
  const b =
    "https://www.wikidata.org/w/api.php?action=query&format=json&list=search&srlimit=3&srsearch=" +
    encodeURIComponent(broad);
  return ((await getJSON(b))?.query?.search || [])[0]?.title || null;
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

let withPhoto = 0, withCoords = 0, refused = 0, bytes = 0;

/* Two lists, one loop. A ski resort is a place with a photograph, so there is
   no reason for it to have its own script, only its own section. */
async function collect(rows, label) {
  const out = [];
  for (const p of rows) {
    const key = slug(`${p.name}-${p.where}`);
    const row = { ...p, key };
    delete row.q;

    /* A hand-written coordinate wins outright, for the one place whose Wikidata
       item has none: Aspen/Snowmass (Q4807795) is filed as a "winter resort
       complex" with no P625 at all. */
    if (Array.isArray(p.latlon)) {
      row.lat = p.latlon[0];
      row.lon = p.latlon[1];
    }

    try {
      /* `file` pins a Commons filename outright, for items carrying no P18. It
         skips the photo lookup but NOT the item lookup any more, the item is
         still where the coordinates come from. */
      let qid = p.qid;
      if (!qid && !p.no_lookup) qid = await findQid(p.q || p.name, `${p.q || p.name} ${p.where || ""}`.trim());

      if (qid) {
        row.qid = qid;
        const facts = await factsFor(qid);
        if (row.lat == null && facts.lat != null) { row.lat = facts.lat; row.lon = facts.lon; }
        if (!p.no_photo && !p.file && facts.file) {
          const img = await commons(facts.file, key);
          if (img?.refused) refused++;
          else if (img) { row.photo = img; withPhoto++; bytes += img.bytes; }
        }
      }

      if (!p.no_photo && p.file) {
        const img = await commons(p.file, key);
        if (img?.refused) refused++;
        else if (img) { row.photo = img; withPhoto++; bytes += img.bytes; }
      }
    } catch (err) {
      console.warn(`  ${p.name}: ${err.message}`);
    }

    /* A plain link, not an embed. The Maps Embed API is genuinely free and
       genuinely unlimited, but it needs a Google Cloud project with a card on
       file, and forty-odd iframes would put forty-odd third-party requests and
       a tracking cookie on a page whose whole claim is that it has neither.
       A link costs nothing and does the same job on the one click in a hundred
       where somebody actually wants the map. */
    if (row.lat != null) {
      row.map = `https://www.google.com/maps/search/?api=1&query=${row.lat}%2C${row.lon}`;
      withCoords++;
    }

    out.push(row);
    process.stdout.write(
      `  ${label} ${p.name.padEnd(24)} ${(p.where || "").padEnd(20)} ` +
        `${row.lat != null ? String(row.lat).padStart(8) + "," + String(row.lon).padStart(10) : "  no coords        "} ` +
        `${row.photo ? "photo" : ", "}\n`
    );
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
      source: "https://www.wikidata.org (CC0): P625 coordinates and P18 images; photographs from Wikimedia Commons",
      count: places.length,
      ski_count: skiing.length,
      with_photo: withPhoto,
      with_coords: withCoords,
      // Per list, because the template's kicker says "31 places, N of them
      // photographed" and a combined total made that read "31 places, 38 of
      // them photographed", which is arithmetic nobody should have to forgive.
      places_with_photo: places.filter((p) => p.photo).length,
      ski_with_photo: skiing.filter((p) => p.photo).length,
      places,
      skiing,
    },
    null,
    2
  ) + "\n"
);

console.log(
  `Places: ${places.length} + ${skiing.length} resorts, ${withCoords} with coordinates, ${withPhoto} with a photograph (${(bytes / 1024).toFixed(0)} KB)` +
    (refused ? `, ${refused} refused as non-free` : "") + ` -> ${OUT}`
);
