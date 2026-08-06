#!/usr/bin/env node
/**
 * Paint the "states I have been to" map.
 *
 * Reads site/data/travel.json, takes a blank US map from Wikimedia Commons, and
 * writes:
 *
 *   site/static/imgs/us-visited.svg   the map, with the visited states filled
 *   site/data/travel-map.json         counts and names, for the legend
 *
 * RUN LOCALLY, COMMIT BOTH. There is no reason to fetch a map that has not
 * changed since 2009 on every deploy, and the output is deterministic.
 *
 * WHY THIS IS A FILE AND NOT INLINE SVG
 *
 * The path data is 44 KB, about 12 KB over the wire. Inlined it would have
 * doubled the home page for one section. As a separate file it is one request
 * that caches for a year under the /imgs/* rule in _headers, and the HTML does
 * not grow at all. The trade is that an <img>-referenced SVG is a static
 * picture — no per-state hover, no tooltips — so the state names are rendered
 * as real text beside the map instead, which is better for a screen reader
 * anyway.
 *
 * WHY THE COORDINATES ARE NOT ROUNDED
 *
 * Do not be tempted. The source paths are relative (m/v/h/l), so rounding every
 * number to an integer does not lose a fraction of a pixel per point — the
 * error accumulates along the path and states drift off each other into an
 * unrecognisable scatter of black polygons. Tried it; it looked like a broken
 * jigsaw. Stripping whitespace and leading zeros is free and safe; touching the
 * precision is neither.
 *
 * SOURCE: "Blank US Map (states only).svg" by Heitordp, released CC0 — public
 * domain, no attribution required. It is credited on the page anyway.
 *
 * Usage:  node scripts/build-map.mjs [travel.json] [outSvg] [outData]
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const IN = resolve(process.argv[2] || "site/data/travel.json");
const OUT_SVG = resolve(process.argv[3] || "site/static/imgs/us-visited.svg");
const OUT_DATA = resolve(process.argv[4] || "site/data/travel-map.json");

const SOURCE = "https://upload.wikimedia.org/wikipedia/commons/1/1a/Blank_US_Map_%28states_only%29.svg";
const CREDIT = {
  file: "Blank US Map (states only).svg",
  author: "Heitordp",
  licence: "CC0",
  source: "https://commons.wikimedia.org/wiki/File:Blank_US_Map_(states_only).svg",
};

/* The source map draws Alaska and Hawaii inset at the bottom left. Both are
   part of the picture and both are correctly grey here, so nothing special is
   needed for them — this note exists only so the next person does not go
   looking for why the viewBox is taller than the lower 48. */
const VIEWBOX = "0 0 959 593";

const travel = JSON.parse(readFileSync(IN, "utf8"));
const want = new Set((travel.visited || []).map((c) => c.trim().toUpperCase()));
if (!want.size) {
  console.error(`ERROR: no states listed in ${IN}`);
  process.exit(1);
}

let src;
try {
  const res = await fetch(SOURCE, {
    headers: { "User-Agent": "parkerhunt.me-build/1.0 (https://parkerhunt.me; email@parkerhunt.me)" },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  src = await res.text();
} catch (err) {
  console.error(`ERROR: could not fetch the base map: ${err.message}`);
  process.exit(1);
}

/* Every state in the source is <path class="xx" d="..."><title>Name</title>. */
const states = [...src.matchAll(/<path\s+class="([a-z]{2})"\s+d="([^"]+)"\s*>\s*<title>([^<]+)<\/title>/g)].map(
  (m) => ({ code: m[1].toUpperCase(), d: m[2], name: m[3] })
);

if (states.length < 50) {
  console.error(`ERROR: parsed only ${states.length} states — the source markup has changed.`);
  process.exit(1);
}

/* A typo in travel.json should be loud. Silently colouring nothing is exactly
   the kind of bug that survives three deploys. */
const known = new Set(states.map((s) => s.code));
const unknown = [...want].filter((c) => !known.has(c));
if (unknown.length) {
  console.error(`ERROR: not US state codes: ${unknown.join(", ")}`);
  process.exit(1);
}

// Collapse runs of whitespace and drop the leading zero of "0.5" / "-0.5".
// Both are lossless. See the note at the top about NOT rounding.
const tidy = (d) =>
  d.replace(/\s+/g, " ").replace(/(^|[\s,])0\./g, "$1.").replace(/(^|[\s,])-0\./g, "$1-.").trim();

const body = states
  .map((s) => `<path class="${want.has(s.code) ? "on" : "off"}" d="${tidy(s.d)}"><title>${s.name}</title></path>`)
  .join("");

/* Styles live inside the file because an <img>-referenced SVG cannot see the
   page's stylesheet. Colours match the shell's --accent and --bg-soft. */
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX}" role="img" ` +
  `aria-label="Map of the United States with ${want.size} states filled in">` +
  `<title>States visited</title>` +
  `<style>path{stroke:#fff;stroke-width:.9;stroke-linejoin:round}.off{fill:#e3e3e8}.on{fill:#0071e3}</style>` +
  body +
  `</svg>\n`;

mkdirSync(dirname(OUT_SVG), { recursive: true });
writeFileSync(OUT_SVG, svg);

mkdirSync(dirname(OUT_DATA), { recursive: true });
writeFileSync(
  OUT_DATA,
  JSON.stringify(
    {
      built: new Date().toISOString().slice(0, 10),
      map: "/imgs/us-visited.svg",
      count: want.size,
      total: states.length,
      credit: CREDIT,
      // Alphabetical by name, which is the order a list of places wants to be
      // read in — the codes are only there to key the map.
      visited: states
        .filter((s) => want.has(s.code))
        .map((s) => ({ code: s.code, name: s.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
    null,
    2
  ) + "\n"
);

console.log(
  `Map: ${want.size} of ${states.length} states filled, ${(svg.length / 1024).toFixed(0)} KB -> ${OUT_SVG}`
);
