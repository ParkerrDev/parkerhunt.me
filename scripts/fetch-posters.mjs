#!/usr/bin/env node
/**
 * Attach real posters to the watch list, from The Movie Database.
 *
 *   site/data/titles.json   in and out — posters are merged into it
 *
 * NEEDS A FREE API KEY. Get one at https://www.themoviedb.org/settings/api
 * (a minute, no cost, no card), then:
 *
 *   TMDB_API_KEY=xxxxxxxx node scripts/fetch-posters.mjs
 *
 * It will not run without one and it will not invent anything in the meantime —
 * the shows keep their title logos and typographic cards until you supply a key.
 *
 * WHY A KEY, AND WHY THIS SOURCE
 *
 * Poster art is the studios'. There is no free-licence source for it and there
 * never will be: Wikipedia's own poster files are tagged non-free and are fair
 * use ON WIKIPEDIA, which does not travel to anyone else's site. TMDb is the
 * exception — a service that licenses its API precisely so that applications
 * can display this artwork, on two conditions this script honours:
 *
 *   1. Attribution. The page must say it uses the TMDB API and is not endorsed
 *      or certified by TMDB. That string goes into titles.json and the template
 *      renders it. Do not remove it; it is the whole basis for using the images.
 *   2. Images are served from TMDb's own CDN. That is why this stores a URL
 *      rather than downloading and re-hosting, and it is the one place on this
 *      site where the browser talks to a third party. That is a real trade
 *      against the no-third-party rule, and it is TMDb's condition, not a
 *      shortcut — see POSTERS.md.
 *
 * The key never touches the repo. It is read from the environment here, and if
 * you want posters to refresh on deploys it belongs in Cloudflare's build
 * variables, alongside RESUME_DEPLOY_KEY.
 *
 * MATCHING IS EXACT, NOT FUZZY. scripts/fetch-titles.mjs has already resolved an
 * IMDb id for 35 of the 36 titles, and TMDb's /find endpoint takes an IMDb id
 * directly — so there is no title search to get wrong, and "The Boys" cannot
 * come back as a 1962 war film the way it did from a name search.
 *
 * Usage:  TMDB_API_KEY=... node scripts/fetch-posters.mjs [titles.json]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const FILE = resolve(process.argv[2] || "site/data/titles.json");
const KEY = process.env.TMDB_API_KEY;

const ATTRIBUTION =
  "This product uses the TMDB API but is not endorsed or certified by TMDB.";

if (!KEY) {
  console.error(`
No TMDB_API_KEY in the environment, so no posters were fetched.

  1. Sign up at https://www.themoviedb.org and open Settings -> API
  2. Request a key (free, instant, no card)
  3. TMDB_API_KEY=xxxxxxxx node scripts/fetch-posters.mjs

Nothing was changed. The shows keep their title logos and typographic cards.
`);
  process.exit(1);
}

const UA = { "User-Agent": "parkerhunt.me-build/1.0", Accept: "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tmdb(path, params = {}) {
  const u = new URL(`https://api.themoviedb.org/3${path}`);
  u.search = new URLSearchParams({ api_key: KEY, ...params });
  const res = await fetch(u, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (res.status === 401) throw new Error("TMDb rejected the key (401)");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* w342 is TMDb's own poster size for list views — about 25 KB each and sharp at
   the ~170 CSS px these render at. w500 doubles the bytes for nothing. */
const BASE = "https://image.tmdb.org/t/p/w342";

const data = JSON.parse(readFileSync(FILE, "utf8"));
let found = 0, missed = [];

for (const s of data.shows) {
  /* A hand-pinned tmdb_id wins outright. Needed twice: The Chosen's IMDb id
     finds a 2009 namesake, and the classic Tom and Jerry shorts have no IMDb id
     for /find to work from at all. */
  if (!s.imdb && !s.tmdb_id) { missed.push(s.title); continue; }
  try {
    let hit = null;
    if (s.tmdb_id) {
      hit = await tmdb(`/tv/${s.tmdb_id}`).catch(() => null);
      if (!hit?.poster_path) hit = await tmdb(`/movie/${s.tmdb_id}`).catch(() => null);
    }
    if (!hit?.poster_path && s.imdb) {
      const r = await tmdb(`/find/${s.imdb}`, { external_source: "imdb_id" });
      hit = (r.tv_results || [])[0] || (r.movie_results || [])[0] || null;
    }
    if (hit?.poster_path) {
      s.poster = {
        src: BASE + hit.poster_path,
        tmdb_id: hit.id,
        rating: hit.vote_average ? Math.round(hit.vote_average * 10) / 10 : null,
        votes: hit.vote_count || null,
        overview_len: (hit.overview || "").length,
      };
      found++;
    } else {
      missed.push(s.title);
    }
  } catch (err) {
    if (String(err.message).includes("401")) {
      console.error(`\nERROR: ${err.message}. Check TMDB_API_KEY.`);
      process.exit(1);
    }
    missed.push(`${s.title} (${err.message})`);
  }
  process.stdout.write(`  ${s.title.padEnd(26)} ${s.poster ? "poster " + (s.poster.rating ?? "") : "—"}\n`);
  await sleep(120);
}

data.posters = {
  fetched: new Date().toISOString().slice(0, 10),
  count: found,
  base: BASE,
  attribution: ATTRIBUTION,
  // Recorded so the template can state it and so nobody has to go and look up
  // what the obligation was six months from now.
  terms: "https://www.themoviedb.org/api-terms-of-use",
};

writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n");
console.log(`\nPosters: ${found} of ${data.shows.length} -> ${FILE}`);
if (missed.length) console.log(`No poster for: ${missed.join(", ")}`);
console.log(`\n${ATTRIBUTION}`);
