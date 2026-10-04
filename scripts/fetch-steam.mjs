#!/usr/bin/env node
/**
 * Build site/data/steam.json, the data behind /games/.
 *
 * Reads the pinned appid list in site/data/steam-seed.json and enriches every
 * entry from Steam's PUBLIC store endpoint:
 *
 *   store.steampowered.com/api/appdetails   name, release date, genres, art
 *
 * It needs no key and does not need the profile to be public, which matters
 * because this profile is private; see the note at the top of the seed file.
 * The consequence is a split: the *list* of games is pinned, but every name and
 * header image on the page is as fresh as the last deploy.
 *
 * Usage:  node scripts/fetch-steam.mjs [seed] [out]
 *
 * FAILS SOFT, like scripts/fetch-github.mjs. Steam rate-limits the store API to
 * roughly 200 requests per five minutes per IP, and Cloudflare's builders share
 * addresses. A throttled build keeps the committed snapshot and exits 0; the
 * page then shows names that are a deploy or two old, which nobody will ever
 * notice. Failing the deploy over it would be absurd.
 */

import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SEED = resolve(process.argv[2] || "site/data/steam-seed.json");
const OUT = resolve(process.argv[3] || "site/data/steam.json");
const OWNED = resolve("site/data/steam-owned.json");

function bail(reason) {
  console.warn(`WARNING: Steam snapshot not refreshed (${reason}).`);
  if (existsSync(OUT)) {
    try {
      const d = JSON.parse(readFileSync(OUT, "utf8"));
      console.warn(
        `         Keeping the committed snapshot (${d.library?.length ?? 0} owned).`
      );
    } catch {
      console.warn("         Existing snapshot is unreadable.");
    }
  } else {
    console.warn("         No snapshot on disk, /games/ will have no Steam section.");
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
    `&cc=us&l=en&filters=basic,release_date,genres`;
  const body = await getJSON(url);
  const entry = body?.[String(appid)];
  if (!entry?.success || !entry.data) throw new Error(`appdetails miss for ${appid}`);
  return entry.data;
}

/* THE LIBRARY, PREFERABLY NOT BY HAND.
 *
 * scripts/fetch-steam-owned.mjs writes steam-owned.json from the real API using
 * the account's own key, which reads a private profile where nobody else's key
 * can. When that file is there it wins outright: every appid and every minute
 * comes from Steam instead of from a person retyping the library page.
 *
 * The seed is still the fallback, and still carries the achievement counts,
 * GetOwnedGames does not return those, and GetPlayerAchievements is one call
 * per game, which is ninety calls into a rate limit of about two hundred per
 * five minutes. So achievements stay pinned and are matched back on by appid. */
let libSource = "seed";
let libRows = seed.library;
if (existsSync(OWNED)) {
  try {
    const owned = JSON.parse(readFileSync(OWNED, "utf8"));
    if (Array.isArray(owned.games) && owned.games.length) {
      const ach = new Map(seed.library.filter((g) => g.ach).map((g) => [g.appid, g.ach]));
      libRows = owned.games
        .filter((g) => g.minutes > 0)
        .map((g) => ({ appid: g.appid, minutes: g.minutes, ach: ach.get(g.appid), last_played: g.last_played }));
      libSource = `api (${owned.fetched})`;
    }
  } catch (err) {
    console.warn(`WARNING: steam-owned.json unreadable (${err.message}), using the pinned seed.`);
  }
}

const libIds = libRows.map((g) => g.appid);
const extraIds = seed.extra || [];
const allIds = [...new Set([...libIds, ...extraIds])];

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

/* A handful of misses is normal, regional blocks, delisted apps, DLC that
   moved. A wholesale miss means Steam is throttling us, and the committed
   snapshot is better than a half-empty page. */
if (details.size < allIds.length * 0.6) {
  bail(`store API returned only ${details.size} of ${allIds.length} apps`);
}

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
    // apps/<id>/header.jpg path, their art is under a content hash that only
    // the store API knows, so the source URL has to be carried, not derived.
    art_src: d.header_image || "",
    released: d.release_date?.coming_soon ? d.release_date?.date || "TBA" : d.release_date?.date || "",
    genres: (d.genres || []).slice(0, 3).map((g) => g.description),
  };
}

const library = libRows
  .filter((g) => details.has(g.appid))
  .map((g) => ({
    ...common(g.appid),
    minutes: g.minutes,
    hours: Math.round((g.minutes / 60) * 10) / 10,
    ach_done: g.ach ? g.ach[0] : null,
    ach_total: g.ach ? g.ach[1] : null,
    ach_pct: g.ach && g.ach[1] ? Math.round((g.ach[0] / g.ach[1]) * 100) : null,
    last_played: g.last_played || "",
  }))
  .sort((a, b) => b.minutes - a.minutes);

/* The played-it list on /games/ looks names up here by appid, so it needs every
   game in the file, not only the ones from `extra`, a game can be owned and
   played-elsewhere at once. Keyed by appid as a string because Tera can only
   subscript a map with one. */
const by_appid = {};
for (const id of allIds) {
  if (details.has(id)) by_appid[String(id)] = common(id);
}

const played = library.filter((g) => g.minutes > 0);
const totals = {
  owned: library.length,
  played: played.length,
  hours: Math.round(played.reduce((n, g) => n + g.minutes, 0) / 60),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      profile: seed.profile,
      library_source: libSource,
      fetched: new Date().toISOString().slice(0, 10),
      totals,
      library,
      by_appid,
    },
    null,
    2
  ) + "\n"
);

console.log(
  `Steam snapshot: ${totals.owned} owned (${totals.hours} h), ` +
    `${Object.keys(by_appid).length} apps in all -> ${OUT}`
);
