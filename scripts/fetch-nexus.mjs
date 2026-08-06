#!/usr/bin/env node
/**
 * Snapshot a Nexus Mods author's published mods into site/data/nexus.json.
 *
 * Nexus Mods' v2 GraphQL router answers this query unauthenticated — the same
 * one their own profile page fires — so no API key is needed and nothing here
 * touches an account:
 *
 *   POST https://api-router.nexusmods.com/graphql
 *   mods(filter: { uploaderId: <id> }) { name summary downloads endorsements ... }
 *
 * Usage:  node scripts/fetch-nexus.mjs [uploaderId] [out]
 *
 * FAILS SOFT — see scripts/fetch-github.mjs.
 */

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const UPLOADER = process.argv[2] || "186080535";
const OUT = resolve(process.argv[3] || "site/data/nexus.json");

const QUERY = `query AuthorMods($filter: ModsFilter, $count: Int) {
  mods(filter: $filter, count: $count, sort: [{ downloads: { direction: DESC } }]) {
    totalCount
    nodes {
      modId
      name
      summary
      version
      downloads
      endorsements
      createdAt
      updatedAt
      adult
      status
      modCategory { name }
      game { name domainName }
      uploader { name }
    }
  }
}`;

function bail(reason) {
  console.warn(`WARNING: Nexus Mods snapshot not refreshed (${reason}).`);
  console.warn(
    existsSync(OUT)
      ? "         Keeping the committed snapshot."
      : "         No snapshot on disk — the mods section will be hidden."
  );
  process.exit(0);
}

let body;
try {
  const res = await fetch("https://api-router.nexusmods.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "parkerhunt.me-build",
    },
    body: JSON.stringify({
      query: QUERY,
      variables: {
        filter: { uploaderId: [{ value: String(UPLOADER), op: "EQUALS" }] },
        count: 50,
      },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  body = await res.json();
} catch (err) {
  bail(err.name === "TimeoutError" ? "request timed out" : err.message);
}

if (body?.errors?.length) bail(`GraphQL: ${body.errors[0]?.message || "unknown error"}`);

const nodes = body?.data?.mods?.nodes;
if (!Array.isArray(nodes) || nodes.length === 0) bail("the query returned no mods");

/* Published only. A mod under moderation or taken down should not be advertised
   from a personal site as if it were live. */
const mods = nodes
  .filter((m) => !m.status || m.status === "published")
  .map((m) => ({
    id: m.modId,
    name: m.name,
    // The author prefixes every mod with his own handle on Nexus, which is
    // useful there and pure noise in a list that is already under his name.
    short: m.name.replace(/^Hydronautica'?s\s+/i, ""),
    summary: m.summary || "",
    version: m.version || "",
    downloads: m.downloads || 0,
    endorsements: m.endorsements || 0,
    category: m.modCategory?.name || "",
    game: m.game?.name || "",
    game_domain: m.game?.domainName || "",
    url: `https://www.nexusmods.com/${m.game?.domainName}/mods/${m.modId}`,
    created: (m.createdAt || "").slice(0, 10),
    updated: (m.updatedAt || "").slice(0, 10),
  }));

const totals = mods.reduce(
  (a, m) => ({
    downloads: a.downloads + m.downloads,
    endorsements: a.endorsements + m.endorsements,
  }),
  { downloads: 0, endorsements: 0 }
);

const author = nodes[0]?.uploader?.name || "hydronautica";

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      author,
      url: `https://www.nexusmods.com/profile/${author}/mods`,
      fetched: new Date().toISOString().slice(0, 10),
      count: mods.length,
      totals,
      games: [...new Set(mods.map((m) => m.game))],
      mods,
    },
    null,
    2
  ) + "\n"
);

console.log(
  `Nexus Mods snapshot: ${mods.length} mods, ${totals.downloads.toLocaleString("en-US")} downloads, ` +
    `${totals.endorsements} endorsements -> ${OUT}`
);
