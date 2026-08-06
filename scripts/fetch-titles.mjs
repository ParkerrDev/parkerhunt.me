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
/* Used to put a title in the right list, whichever list it was written in.
   See the reclassification step after collect(). */
const SERIES_KINDS = ["Q5398426", "Q117467246", "Q581714", "Q63952888", "Q1366112", "Q15416", "Q11086742", "Q220898"];
const FILM_KINDS = ["Q11424", "Q24856", "Q202866", "Q29168811", "Q24869", "Q17517379"];

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
/*
 * SCORED, NOT FIRST-HIT, and the difference is not academic. A bare label search
 * for "Shrek" returns the ogre before the film, "Ted" returns Ted Danson,
 * "Peter Pan" returns the character, "Annie" returns an awards ceremony and
 * "Winnie the Pooh" returns a bear. Taking the first acceptable hit put an
 * IMDb *character* id (ch0002004) on Shrek and a *person* id (nm0740485) on
 * Ted, both of which render as links to nothing anybody wanted.
 *
 * Three signals, in order of strength:
 *
 *   1. The IMDb id must look like a TITLE — `tt` and nothing else. `nm` is a
 *      person, `ch` a character, `ev` an event. That one test alone would have
 *      caught every wrong answer above.
 *   2. The year must match the year in watching.json, within one. Release dates
 *      drift by a year between festival and general release, but not by ten,
 *      and this is what separates the 1990 Total Recall from the 2012 one.
 *   3. P31 has to be a film or a series, not a franchise or a character.
 *
 * `year` is what makes this work, so pass it. Without one, scoring falls back
 * to type-and-id and behaves as it did before.
 */
async function resolve_qid(title, year = null) {
  const tries = year
    ? [title, `${title} ${year} film`, `${title} film`, `${title} television series`, `${title} anime`]
    : [title, `${title} television series`, `${title} anime`, `${title} film`];

  let best = null, bestScore = 0;
  for (const q of tries) {
    const u =
      "https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&limit=8&type=item&search=" +
      encodeURIComponent(q);
    let hits = [];
    try { hits = (await getJSON(u))?.search || []; } catch { continue; }

    for (const h of hits.slice(0, 6)) {
      const e = await entity(h.id);
      if (!e) continue;
      const p31 = (e.claims?.P31 || []).map((c) => c.mainsnak?.datavalue?.value?.id);
      if (p31.some((id) => NOT_A_SHOW.includes(id))) continue;

      const imdb = e.claims?.P345?.[0]?.mainsnak?.datavalue?.value || "";
      const when = e.claims?.P577?.[0]?.mainsnak?.datavalue?.value
                || e.claims?.P580?.[0]?.mainsnak?.datavalue?.value;
      const yr = when?.time ? Number(when.time.slice(1, 5)) : null;

      let score = 0;
      if (/^tt\d+$/.test(imdb)) score += 4;
      else if (imdb) score -= 4;                       // nm / ch / ev: wrong kind of thing
      if (p31.some((id) => KINDS.includes(id))) score += 3;
      if (year && yr) score += Math.abs(yr - year) <= 1 ? 4 : -3;

      // A perfect card — right kind, right year, real title id — cannot be
      // beaten, so stop looking rather than spend six more entity fetches.
      if (score >= 11) return h.id;
      if (score > bestScore) { bestScore = score; best = h.id; }
    }
    if (bestScore >= 7) break;
  }
  return bestScore > 0 ? best : null;
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

/* Posters are merged into titles.json by a LATER script (fetch-posters.mjs), so
   this one has to carry them across or re-running it silently wipes them —
   which is exactly the sort of thing you discover three deploys later. */
let previous = {};
try {
  const old = JSON.parse(readFileSync(OUT, "utf8"));
  for (const s of [...(old.shows || []), ...(old.movies || [])]) if (s.poster) previous[s.title] = s.poster;
  if (old.posters) var carriedPosters = old.posters;
} catch {}

let withLogo = 0, withImdb = 0, refused = 0;

/* Two lists, one loop. A film and a television series differ only in which
   Wikidata class they match, and KINDS already covers both. */
async function collect(rows) {
  const out = [];
  for (const s of rows) {
    const key = slug(s.title);
    const row = { ...s, key };
    delete row.qid;

    /* A hand-written imdb wins outright, and no_imdb stops the search dead. Both
     exist because a wrong link is worse than a missing one: "Tom and Jerry"
     resolves to a 1960s folk-rock duo's person page, which is a link nobody
     wants to follow from a list of cartoons. */
    if (s.imdb) { row.imdb_url = `https://www.imdb.com/title/${s.imdb}/`; withImdb++; }
    if (s.no_imdb) { delete row.no_imdb; out.push(row); process.stdout.write(`  ${s.title.padEnd(26)} (no imdb, by hand)\n`); continue; }

    let qid = s.qid || null;
    try {
      if (!qid) qid = await resolve_qid(s.title, s.year || null);
    } catch (err) {
    console.warn(`  ${s.title}: search failed (${err.message})`);
    }

    if (qid) {
    const e = await entity(qid);
    if (e) {
      row.qid = qid;
      /* Belt and braces: even a hand-pinned qid can carry a character id, so
         nothing that is not a tt-id becomes a link. */
      const found = claim(e, "P345");
      const imdb = s.imdb || (/^tt\d+$/.test(found || "") ? found : null);
      if (imdb && !row.imdb_url) { row.imdb = imdb; row.imdb_url = `https://www.imdb.com/title/${imdb}/`; withImdb++; }
      else if (imdb) row.imdb = imdb;

      const when = claim(e, "P580") || claim(e, "P577");
      const yr = when?.time ? Number(when.time.slice(1, 5)) : null;
      // Trust the hand-written year over Wikidata's: several of these have a
      // first-broadcast date for a pilot in a different year to the season.
      if (yr && !row.year) row.year = yr;
      if (yr) row.year_wd = yr;

      /* Which list does this actually belong in? Recorded here because the
         entity is already fetched; acted on after both lists are collected. */
      const p31 = (e.claims?.P31 || []).map((c) => c.mainsnak?.datavalue?.value?.id);
      if (p31.some((id) => SERIES_KINDS.includes(id))) row._kind = "show";
      else if (p31.some((id) => FILM_KINDS.includes(id))) row._kind = "film";

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

    if (previous[s.title]) row.poster = previous[s.title];
    out.push(row);
    process.stdout.write(
      `  ${s.title.slice(0, 40).padEnd(42)} ${(row.imdb || "—").padEnd(11)} ${row.logo ? "logo" : ""}\n`
    );
    // Wikidata asks for a courteous request rate and this is a build script,
    // not a race. A quarter second between titles keeps it comfortably polite.
    await sleep(250);
  }
  return out;
}

let shows = await collect(input.shows);
let movies = await collect(input.movies || []);

/* A TITLE ENDS UP IN THE LIST WIKIDATA SAYS IT BELONGS IN, not the one it was
   typed into. "Mr. Peabody & Sherman" was written under films and matched the
   2015 television series, so a film section showed a card reading "comedy
   television series" — which is the kind of wrong that survives for months
   because nothing errors.
 *
 * This does not fix a bad match; it makes one visible and puts it somewhere
 * sensible in the meantime. Anything moved is printed, because a title landing
 * in the other list is usually a sign the qid wants pinning. */
const moved = [];
const misfiled = (list, want) => list.filter((r) => r._kind && r._kind !== want);
const stayed = (list, want) => list.filter((r) => !r._kind || r._kind === want);
const filmsThatAreShows = misfiled(movies, "film");
const showsThatAreFilms = misfiled(shows, "show");
if (filmsThatAreShows.length || showsThatAreFilms.length) {
  for (const r of filmsThatAreShows) moved.push(`${r.title} -> shows`);
  for (const r of showsThatAreFilms) moved.push(`${r.title} -> films`);
  shows = [...stayed(shows, "show"), ...filmsThatAreShows];
  movies = [...stayed(movies, "film"), ...showsThatAreFilms];
}
for (const r of [...shows, ...movies]) delete r._kind;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      fetched: new Date().toISOString().slice(0, 10),
      source: "https://www.wikidata.org (CC0); logos from Wikimedia Commons",
      count: shows.length,
      movie_count: movies.length,
      with_logo: withLogo,
      ...(typeof carriedPosters !== "undefined" ? { posters: carriedPosters } : {}),
      shows,
      movies,
    },
    null,
    2
  ) + "\n"
);

if (moved.length) console.log(`Reclassified by Wikidata: ${moved.join("; ")}`);
console.log(
  `Titles: ${shows.length} shows + ${movies.length} films, ${withImdb} with IMDb ids, ${withLogo} with a free logo` +
    (refused ? `, ${refused} logo(s) refused as non-free` : "") + ` -> ${OUT}`
);
