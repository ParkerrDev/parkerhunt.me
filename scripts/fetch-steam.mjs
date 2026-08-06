#!/usr/bin/env node
/**
 * Build site/data/steam.json — the data behind /games/.
 *
 * Reads the pinned appid list in site/data/steam-seed.json and enriches every
 * entry from Steam's PUBLIC store endpoints:
 *
 *   store.steampowered.com/api/appdetails   name, price, discount, release date
 *   store.steampowered.com/appreviews/<id>  "Very Positive", 93%, review count
 *
 * Neither needs a key and neither needs the profile to be public, which matters
 * because this profile is private — see the note at the top of the seed file.
 * The consequence is a split: the *list* of games is pinned, but every price,
 * discount and review score on the page is as fresh as the last deploy. A
 * wishlist whose prices are a year stale is worse than no wishlist.
 *
 * Usage:  node scripts/fetch-steam.mjs [seed] [out]
 *
 * FAILS SOFT, like scripts/fetch-github.mjs. Steam rate-limits the store API to
 * roughly 200 requests per five minutes per IP, and Cloudflare's builders share
 * addresses. A throttled build keeps the committed snapshot and exits 0; the
 * page then shows prices that are a deploy or two old, which nobody will ever
 * notice. Failing the deploy over it would be absurd.
 */

import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SEED = resolve(process.argv[2] || "site/data/steam-seed.json");
const OUT = resolve(process.argv[3] || "site/data/steam.json");

/* Steam's own review-score buckets, in Steam's own blue/grey/red. The label
   comes from the API; the colour does not, so it is mapped here. */
const REVIEW_TONE = {
  "Overwhelmingly Positive": "pos",
  "Very Positive": "pos",
  Positive: "pos",
  "Mostly Positive": "pos",
  Mixed: "mix",
  "Mostly Negative": "neg",
  Negative: "neg",
  "Very Negative": "neg",
  "Overwhelmingly Negative": "neg",
};

function bail(reason) {
  console.warn(`WARNING: Steam snapshot not refreshed (${reason}).`);
  if (existsSync(OUT)) {
    try {
      const d = JSON.parse(readFileSync(OUT, "utf8"));
      console.warn(
        `         Keeping the committed snapshot (${d.library?.length ?? 0} owned, ${d.wishlist?.length ?? 0} wishlisted).`
      );
    } catch {
      console.warn("         Existing snapshot is unreadable.");
    }
  } else {
    console.warn("         No snapshot on disk — /games/ will have no Steam section.");
  }
  process.exit(0);
}

if (!existsSync(SEED)) bail(`seed file missing at ${SEED}`);

let seed;
try {
  seed = JSON.parse(readFileSync(SEED, "utf8"));
} catch (err) {
  bail(`seed file is not valid JSON (${err.message})`);
}

const UA = { "User-Agent": "parkerhunt.me-build", Accept: "application/json" };

async function getJSON(url, ms = 12000) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* Four at a time. Steam does not document a burst limit, only the five-minute
   window, but hammering it 60-wide is how you get a 429 and a stale page. */
async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await worker(items[i], i);
      }
    })
  );
  return out;
}

async function appDetails(appid) {
  const url =
    `https://store.steampowered.com/api/appdetails?appids=${appid}` +
    `&cc=us&l=en&filters=basic,price_overview,release_date,genres`;
  const body = await getJSON(url);
  const entry = body?.[String(appid)];
  if (!entry?.success || !entry.data) throw new Error(`appdetails miss for ${appid}`);
  return entry.data;
}

async function appReviews(appid) {
  // num_per_page=0 asks for the summary only — the review bodies are megabytes.
  const url =
    `https://store.steampowered.com/appreviews/${appid}` +
    `?json=1&num_per_page=0&language=all&purchase_type=all`;
  const body = await getJSON(url);
  const q = body?.query_summary;
  if (!q || !q.review_score_desc || !q.total_reviews) return null;
  return {
    label: q.review_score_desc,
    tone: REVIEW_TONE[q.review_score_desc] || "mix",
    pct: Math.round((q.total_positive / q.total_reviews) * 100),
    count: q.total_reviews,
  };
}

/* Steam prices come back as "$59.99" strings and, when discounted, an
   initial_formatted that is sometimes an empty string instead of absent. */
function priceOf(d) {
  if (d.is_free) return { free: true, now: "Free", was: "", off: 0 };
  const p = d.price_overview;
  if (!p) return { free: false, now: "", was: "", off: 0 };
  return {
    free: false,
    now: p.final_formatted || "",
    was: p.discount_percent > 0 ? p.initial_formatted || "" : "",
    off: p.discount_percent || 0,
  };
}

const libIds = seed.library.map((g) => g.appid);
const wishIds = seed.wishlist;
const extraIds = seed.extra || [];
const allIds = [...new Set([...libIds, ...wishIds, ...extraIds])];

let details;
try {
  details = new Map(
    (await pool(allIds, 4, async (id) => {
      try {
        return [id, await appDetails(id)];
      } catch {
        return [id, null];
      }
    })).filter(([, d]) => d)
  );
} catch (err) {
  bail(err.name === "TimeoutError" ? "store API timed out" : err.message);
}

/* A handful of misses is normal — regional blocks, delisted apps, DLC that
   moved. A wholesale miss means Steam is throttling us, and the committed
   snapshot is better than a half-empty page. */
if (details.size < allIds.length * 0.6) {
  bail(`store API returned only ${details.size} of ${allIds.length} apps`);
}

/* Reviews only for the wishlist. The library rows show hours and achievements
   the way Steam's own library does; nobody needs a review score on a game with
   360 hours on it. Halves the request count. */
const reviews = new Map(
  (await pool(wishIds, 4, async (id) => {
    try {
      return [id, await appReviews(id)];
    } catch {
      return [id, null];
    }
  })).filter(([, r]) => r)
);

function common(appid) {
  const d = details.get(appid);
  return {
    appid,
    name: d.name,
    url: `https://store.steampowered.com/app/${appid}/`,
    // Local, converted copy. scripts/fetch-steam-art.mjs writes these; nothing
    // on the page ever loads an image from a Steam CDN.
    art: `/imgs/steam/${appid}.webp`,
    // Where that copy came from. Newer apps no longer sit at the guessable
    // apps/<id>/header.jpg path — their art is under a content hash that only
    // the store API knows — so the source URL has to be carried, not derived.
    art_src: d.header_image || "",
    released: d.release_date?.coming_soon ? d.release_date?.date || "TBA" : d.release_date?.date || "",
    genres: (d.genres || []).slice(0, 3).map((g) => g.description),
  };
}

const library = seed.library
  .filter((g) => details.has(g.appid))
  .map((g) => ({
    ...common(g.appid),
    minutes: g.minutes,
    hours: Math.round((g.minutes / 60) * 10) / 10,
    ach_done: g.ach ? g.ach[0] : null,
    ach_total: g.ach ? g.ach[1] : null,
    ach_pct: g.ach && g.ach[1] ? Math.round((g.ach[0] / g.ach[1]) * 100) : null,
  }))
  .sort((a, b) => b.minutes - a.minutes);

const wishlist = wishIds
  .filter((id) => details.has(id))
  .map((id) => ({ ...common(id), price: priceOf(details.get(id)), review: reviews.get(id) || null }));

/* The played-it list on /games/ looks names up here by appid, so it needs every
   game in the file, not only the ones from `extra` — a game can be owned,
   wishlisted and played-elsewhere all at once. Keyed by appid as a string
   because Tera can only subscript a map with one. */
const by_appid = {};
for (const id of allIds) {
  if (details.has(id)) by_appid[String(id)] = common(id);
}

/* Precomputed here rather than filtered in the template: Tera's `filter` keeps
   any item whose attribute is merely non-null, so `off: 0` would survive it and
   every full-price game would show up under "on sale". */
const on_sale = wishlist.filter((g) => g.price.off > 0).sort((a, b) => b.price.off - a.price.off);

const played = library.filter((g) => g.minutes > 0);
const totals = {
  owned: library.length,
  played: played.length,
  hours: Math.round(played.reduce((n, g) => n + g.minutes, 0) / 60),
  wishlisted: wishlist.length,
  on_sale: wishlist.filter((g) => g.price.off > 0).length,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      profile: seed.profile,
      fetched: new Date().toISOString().slice(0, 10),
      totals,
      library,
      wishlist,
      on_sale,
      by_appid,
    },
    null,
    2
  ) + "\n"
);

console.log(
  `Steam snapshot: ${totals.owned} owned (${totals.hours} h), ` +
    `${totals.wishlisted} wishlisted (${totals.on_sale} on sale) -> ${OUT}`
);
