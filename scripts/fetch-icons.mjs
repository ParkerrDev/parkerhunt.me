#!/usr/bin/env node
/**
 * Pull the brand marks the site needs into site/data/icons.json.
 *
 * Source: Simple Icons (simpleicons.org). Each icon is a single monochrome
 * path on a 24×24 grid plus the brand's own hex, which is exactly what this
 * site wants, the path goes straight into an inline <svg>, so there is no
 * request, no sprite sheet and no third-party CDN at page load. The whole set
 * of marks used here comes to a couple of kilobytes.
 *
 * ON USING SOMEONE ELSE'S LOGO
 *
 * Simple Icons releases its SVG data CC0, but a logo is a trademark and CC0
 * cannot give away someone else's trademark. What makes this fine is what the
 * marks are being used FOR: "I daily drive Linux", "my Starbucks order is this".
 * That is nominative use (using a mark to refer to the thing it names) which
 * is what every comparison table and every review does. Nothing here implies
 * any of these companies endorse anything, and no mark is altered beyond being
 * tinted to its own published brand colour.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * Windows, Chipotle, Dutch Bros, Nobara and CachyOS are not in the set, and
 * local businesses like Cattlemens, Butterfish and Kuppa Joy never will be.
 * Those get plain generic glyphs drawn in templates/macros.html, a monitor, a
 * cup, a bowl. Drawing a passable imitation of a trademark from memory would be
 * worse on both counts: worse-looking, and closer to the line than just using
 * the real thing under nominative use.
 *
 * TV posters are not here either and cannot be. Key art is copyrighted and has
 * no free source; the show cards are typography for that reason.
 *
 * Usage:  node scripts/fetch-icons.mjs [out]
 *
 * FAILS SOFT, the committed icons.json is the source of truth for a build.
 */

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const OUT = resolve(process.argv[2] || "site/data/icons.json");

/* Every slug the templates ask for. Keep this list and me.toml's `icon` fields
   in step, a slug that is missing here renders as no icon at all, not as an
   error, because a missing logo should never take a page down. */
const WANT = [
  // Settled
  "linux", "apple", "android", "macos", "ios",
  // Distros
  "raspberrypi", "kalilinux", "ubuntu", "zorin", "fedora", "nixos",
  // Coffee
  "starbucks",
  // Elsewhere on the site
  "steam", "nexusmods",
  // Booking link in the hero
  "caldotcom",
];

const CDN = "https://cdn.jsdelivr.net/npm/simple-icons@latest";

function bail(reason) {
  console.warn(`WARNING: icon set not refreshed (${reason}).`);
  console.warn(
    existsSync(OUT)
      ? "         Keeping the committed icons.json."
      : "         No icons.json on disk, brand marks will be missing."
  );
  process.exit(0);
}

let index;
try {
  const res = await fetch(`${CDN}/_data/simple-icons.json`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  index = Array.isArray(body) ? body : body.icons;
  if (!Array.isArray(index)) throw new Error("unexpected index shape");
} catch (err) {
  bail(err.message);
}

/* The index is keyed by title, not slug, so the slug has to be rebuilt, and
   "lowercase and strip punctuation" is not the rule. Simple Icons SPELLS OUT
   three characters before stripping the rest: `.` becomes "dot", `+` becomes
   "plus", `&` becomes "and". Strip-first turns Cal.com into "calcom", the file
   is served as caldotcom.svg, and the icon reports as missing while the CDN
   quite happily has it. Same trap waiting for Notion.so, C++ or AT&T.

   Diacritics are decomposed first so that, say, Paradox Interactive's é folds
   to e rather than vanishing and shifting every letter after it. */
const slugify = (title) =>
  title
    .normalize("NFD").replace(/\p{M}/gu, "")
    .replace(/\+/g, "plus").replace(/\./g, "dot").replace(/&/g, "and")
    .toLowerCase().replace(/[^a-z0-9]/g, "");

const bySlug = new Map();
for (const i of index) {
  const slug = i.slug || slugify(i.title);
  bySlug.set(slug, { ...i, slug });
}

const icons = {};
const missing = [];

for (const slug of WANT) {
  const meta = bySlug.get(slug);
  if (!meta) {
    missing.push(slug);
    continue;
  }
  try {
    const res = await fetch(`${CDN}/icons/${meta.slug}.svg`, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const svg = await res.text();
    const d = svg.match(/<path[^>]*\sd="([^"]+)"/)?.[1];
    if (!d) throw new Error("no path in the SVG");
    icons[slug] = { title: meta.title, hex: `#${meta.hex}`, d };
  } catch (err) {
    missing.push(`${slug} (${err.message})`);
  }
}

if (!Object.keys(icons).length) bail("every icon failed to download");

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      fetched: new Date().toISOString().slice(0, 10),
      source: "https://simpleicons.org",
      note: "Paths CC0 from Simple Icons. The marks themselves are their owners' trademarks, used here nominatively.",
      icons,
    },
    null,
    2
  ) + "\n"
);

const bytes = Object.values(icons).reduce((n, i) => n + i.d.length, 0);
console.log(`Icons: ${Object.keys(icons).length} marks, ${(bytes / 1024).toFixed(1)} KB of path data -> ${OUT}`);
if (missing.length) console.warn(`         Not found: ${missing.join(", ")}`);
