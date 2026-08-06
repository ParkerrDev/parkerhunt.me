#!/usr/bin/env node
/**
 * The watch-list pipeline.
 *
 *   site/data/watching.json   in   — a list of titles, hand-written
 *   site/data/titles.json     out  — the same list with everything filled in
 *   site/static/imgs/titles/  out  — title logos, where a free one exists
 *
 * ADDING A SHOW IS ONE LINE: {"title": "Severance"}. Run this and it comes back
 * with a year, an IMDb link, its genres and — if Wikimedia Commons happens to
 * have a freely-licensed title logo — a picture. That is the whole point of the
 * script: the interesting part of a watch list is the list, and nobody should
 * have to look up eleven-digit IMDb ids by hand.
 *
 * WHERE THE DATA COMES FROM, AND WHY NOT SOMEWHERE EASIER
 *
 * Wikidata, which is CC0 — the facts are free to take and free to republish.
 * TMDb and OMDb would be less work and both would be a mistake here: they need
 * an API key, which means a secret in the build, and their artwork is the
 * studios' rather than theirs to license on.
 *
 * WHY THERE ARE STILL NO POSTERS. Key art is copyrighted, full stop, and no
 * free source for it exists at any size. Wikipedia's own poster files are
 * tagged non-free and are fair use ON WIKIPEDIA, which does not travel. What
 * Commons does often have is the *title logo* — a wordmark set in a typeface is
 * frequently below the threshold of originality and therefore public domain.
 * That is what this fetches, and it is why some shows get a real logo and most
 * get the typographic card.
 *
 * Every downloaded file has its licence checked against ALLOWED before it is
 * written, so a non-free file fails loudly instead of quietly appearing on a
 * public site.
 *
 * RUN LOCALLY, COMMIT THE OUTPUT — it needs cwebp, and there is no reason to
 * re-ask Wikidata about Seinfeld on every deploy.
 *
 * Usage:  node scripts/fetch-titles.mjs [in] [outData] [outDir]
 */

import { readFileSync, writeFileSync, mkdirSync, unlinkSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";

const IN = resolve(process.argv[2] || "site/data/watching.json");
const OUT = resolve(process.argv[3] || "site/data/titles.json");
const DIR = resolve(process.argv[4] || "site/static/imgs/titles");

const UA = {
  "User-Agent": "parkerhunt.me-build/1.0 (https://parkerhunt.me; email@parkerhunt.me)",
};

const ALLOWED = [/^cc0/i, /^public domain/i, /^pd/i, /^cc by/i, /^cc-by/i, /^gpl/i, /^gfdl/i];

/* Wikidata classes worth matching. This list is longer than it looks like it
   needs to be because P31 on a television series is not one value — Wikidata
   distinguishes "television series", "animated series", "animated sitcom",
   "anime television series" and several more, and The Simpsons uses a class
   that none of the obvious guesses cover. */
const KINDS = [
  "Q5398426",    // television series
  "Q117467246",  // animated sitcom
  "Q581714",     // animated series
  "Q63952888",   // anime television series
  "Q11086742",   // television series season -> still a screen work
  "Q1366112",    // television programme
  "Q15416",      // television programme (broad)
  "Q11424",      // film
  "Q24856",      // film series
  "Q220898",     // OVA
];

/* Things that share a title with a show and are NOT one. A video game or a
   manga can carry an IMDb id, so the P345 fallback below needs this guard or
   "Naruto" resolves to the manga and "The Simpsons" to the 1991 arcade game. */
const NOT_A_SHOW = ["Q7889", "Q21198342", "Q8261", "Q571", "Q482994", "Q12308941", "Q101352", "Q3957", "Q494721"];

let hasCwebp = true;
try {
  execFileSync("cwebp", ["-version"], { stdio: "ignore" });
} catch {
  hasCwebp = false;
  console.warn("WARNING: cwebp not found — metadata will refresh, images will not.");
}

const plain = (h) =>
  String(h || "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, ms = 30000) {
  const res = await fetch(url, { headers: { ...UA, Accept: "application/json" }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Find the Wikidata item for a title, or null. */
async function resolve_qid(title) {
  /* Two passes. A bare title search for "Barry" returns a given name, a family
     name and a town in the Vale of Glamorgan before it returns the show, so if
     the plain search yields nothing usable, ask again with the disambiguator
     people actually type. */
  for (const q of [title, `${title} television series`, `${title} anime`]) {
    const u =
      "https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&limit=8&type=item&search=" +
      encodeURIComponent(q);
    let hits = [];
    try { hits = (await getJSON(u))?.search || []; } catch { continue; }

    const scored = [];
    for (const h of hits.slice(0, 6)) {
      const e = await entity(h.id);
      if (!e) continue;
      const p31 = (e.claims?.P31 || []).map((c) => c.mainsnak?.datavalue?.value?.id);
      if (p31.some((id) => NOT_A_SHOW.includes(id))) continue;
      if (p31.some((id) => KINDS.includes(id))) return h.id;
      // Weaker signal, kept as a fallback: an IMDb id on something that is not
      // on the blocklist is almost always the screen work we are looking for.
      if (e.claims?.P345) scored.push(h.id);
    }
    if (scored.length) return scored[0];
  }
  return null;
}

const cache = new Map();
async function entity(qid) {
  if (cache.has(qid)) return cache.get(qid);
  let e = null;
  try {
    const j = await getJSON(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
    e = j?.entities?.[qid] || null;
  } catch {}
  cache.set(qid, e);
  return e;
}

const claim = (e, p) => e?.claims?.[p]?.[0]?.mainsnak?.datavalue?.value ?? null;
const claims = (e, p) => (e?.claims?.[p] || []).map((c) => c.mainsnak?.datavalue?.value).filter(Boolean);

/** Download a Commons file if its licence allows it. Returns the local path. */
async function commonsImage(file, key) {
  const api = new URL("https://commons.wikimedia.org/w/api.php");
  api.search = new URLSearchParams({
    action: "query", format: "json", titles: `File:${file}`,
    prop: "imageinfo", iiprop: "url|extmetadata|mime", iiurlwidth: "512",
  });
  const j = await getJSON(api);
  const info = Object.values(j?.query?.pages || {})[0]?.imageinfo?.[0];
  if (!info) return null;

  const m = info.extmetadata || {};
  const licence = plain(m.LicenseShortName?.value) || "unknown";
  if (!ALLOWED.some((re) => re.test(licence))) return { refused: licence };
  if (!hasCwebp) return null;

  const res = await fetch(info.thumburl || info.url, { headers: UA, signal: AbortSignal.timeout(30000) });
  if (!res.ok) return null;
  const tmp = join(tmpdir(), `title-${key}.bin`);
  writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  const out = join(DIR, `${key}.webp`);
  try {
    execFileSync("cwebp", ["-quiet", "-q", "88", "-resize", "480", "0", tmp, "-o", out]);
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
  return {
    src: `/imgs/titles/${key}.webp`,
    dark: isDark(out),
    licence,
    author: plain(m.Artist?.value) || "Unknown",
    source: info.descriptionurl,
    credit_required: /^cc by|^cc-by|^gfdl/i.test(licence),
    bytes: statSync(out).size,
  };
}


/* Is this logo drawn in dark ink or light?
 *
 * It matters because these are transparent PNGs of wordmarks and the card
 * behind them is a hand-picked colour. Get it wrong and the logo disappears:
 * Better Call Saul is black type, The Walking Dead is white type, and no single
 * card colour can carry both. So measure it.
 *
 * dwebp ships with cwebp, decodes to PAM, and PAM is four bytes per pixel after
 * a short text header — which makes this about fifteen lines rather than a
 * reason to add an image library. Only pixels that are actually opaque count;
 * averaging in the transparent background would report every logo as mid-grey.
 */
function isDark(webpPath) {
  let pam;
  try {
    pam = execFileSync("dwebp", ["-quiet", "-pam", webpPath, "-o", "-"], { maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return false; // no dwebp, no opinion — the hand-picked colour stands
  }
  const head = pam.subarray(0, 200).toString("latin1");
  const start = head.indexOf("ENDHDR\n");
  if (start < 0) return false;
  const px = pam.subarray(start + 7);
  let lum = 0, n = 0;
  for (let i = 0; i + 3 < px.length; i += 4) {
    if (px[i + 3] < 128) continue; // transparent
    lum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    n++;
  }
  if (!n) return false;
  return lum / n < 128;
}

const slug = (s) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const input = JSON.parse(readFileSync(IN, "utf8"));
mkdirSync(DIR, { recursive: true });

const shows = [];
let withLogo = 0, withImdb = 0, refused = 0;

for (const s of input.shows) {
  const key = slug(s.title);
  const row = { ...s, key };
  delete row.qid;

  /* A hand-written imdb wins outright, and no_imdb stops the search dead. Both
     exist because a wrong link is worse than a missing one: "Tom and Jerry"
     resolves to a 1960s folk-rock duo's person page, which is a link nobody
     wants to follow from a list of cartoons. */
  if (s.imdb) { row.imdb_url = `https://www.imdb.com/title/${s.imdb}/`; withImdb++; }
  if (s.no_imdb) { delete row.no_imdb; shows.push(row); process.stdout.write(`  ${s.title.padEnd(26)} (no imdb, by hand)\n`); continue; }

  let qid = s.qid || null;
  try {
    if (!qid) qid = await resolve_qid(s.title);
  } catch (err) {
    console.warn(`  ${s.title}: search failed (${err.message})`);
  }

  if (qid) {
    const e = await entity(qid);
    if (e) {
      row.qid = qid;
      const imdb = s.imdb || claim(e, "P345");
      if (imdb && !row.imdb_url) { row.imdb = imdb; row.imdb_url = `https://www.imdb.com/title/${imdb}/`; withImdb++; }
      else if (imdb) row.imdb = imdb;

      const when = claim(e, "P580") || claim(e, "P577");
      const yr = when?.time ? Number(when.time.slice(1, 5)) : null;
      // Trust the hand-written year over Wikidata's: several of these have a
      // first-broadcast date for a pilot in a different year to the season.
      if (yr && !row.year) row.year = yr;
      if (yr) row.year_wd = yr;

      const gq = claims(e, "P136").map((v) => v.id).slice(0, 3);
      const gs = [];
      for (const g of gq) {
        const ge = await entity(g);
        const label = ge?.labels?.en?.value;
        if (label) gs.push(label);
      }
      if (gs.length) row.genres = gs;

      // P154 is the logo; P18 the generic image, which for a series is usually
      // a photo of the cast at a convention and not what anyone wants here.
      const logoFile = claim(e, "P154");
      if (logoFile) {
        try {
          const img = await commonsImage(logoFile, key);
          if (img?.refused) { refused++; }
          else if (img) { row.logo = img; withLogo++; }
        } catch {}
      }
    }
  }

  shows.push(row);
  process.stdout.write(
    `  ${s.title.padEnd(26)} ${(row.imdb || "—").padEnd(11)} ${row.logo ? "logo" : "    "} ${(row.genres || []).slice(0, 2).join(", ")}\n`
  );
  // Wikidata asks for a courteous request rate and this is a build script, not
  // a race. A quarter second between titles keeps it comfortably polite.
  await sleep(250);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      fetched: new Date().toISOString().slice(0, 10),
      source: "https://www.wikidata.org (CC0); logos from Wikimedia Commons",
      count: shows.length,
      with_logo: withLogo,
      shows,
    },
    null,
    2
  ) + "\n"
);

console.log(
  `Titles: ${shows.length} shows, ${withImdb} with IMDb ids, ${withLogo} with a free logo` +
    (refused ? `, ${refused} logo(s) refused as non-free` : "") + ` -> ${OUT}`
);
