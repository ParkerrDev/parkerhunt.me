#!/usr/bin/env node
/**
 * Paint the travel map: states filled, and a pin on every place with a
 * coordinate.
 *
 * Reads site/data/travel.json (the states) and site/data/been.json +
 * site/data/media.json (the pins), and writes:
 *
 *   site/static/imgs/us-visited-<hash>.svg   the map
 *   site/data/travel-map.json                counts, names and the legend
 *
 * RUN LOCALLY, COMMIT BOTH. There is no reason to fetch a boundary file that
 * changes once a decade on every deploy, and the output is deterministic.
 *
 * WHY THE BASE MAP CHANGED, AND WHY IT HAD TO
 *
 * This used to trace a blank SVG from Wikimedia Commons. That was fine while
 * the only job was colouring states in, and impossible the moment pins were
 * wanted: a finished SVG tells you where Nevada is drawn but not what
 * projection put it there, so there is no way to convert 39.19°N 120.26°W into
 * a point on it. Fitting one by least squares over state centroids was tried
 * and got within about 20px, which is Sacramento landing in the Pacific.
 *
 * So the geometry now comes from us-atlas' `states-albers-10m.json`, which is
 * PRE-PROJECTED with known parameters:
 *
 *     d3.geoAlbersUsa().scale(1300).translate([487.5, 305])   on 975 x 610
 *
 * Those are reproduced by hand below (d3 is not a dependency here), and the
 * result is checked, not assumed: `node scripts/build-map.mjs --verify` drops
 * every state's true centroid through the projection and asserts it lands
 * inside that state's own outline. It is 51 for 51, Alaska and Hawaii insets
 * included. If a future us-atlas changes the canvas, that check fails loudly
 * instead of scattering pins into the sea.
 *
 * ONE TRAP, ALREADY SPRUNG: d3's `.center()` is in ROTATED coordinates. Albers
 * is `.rotate([96,0]).center([-0.6, 38.7])`, and applying the rotation to the
 * centre as well puts it at 95.4° and throws every point ~1400px off canvas.
 * Rotate the point; do not rotate the centre.
 *
 * SOURCES
 *   us-atlas (ISC), https://github.com/topojson/us-atlas
 *   boundaries: US Census Bureau cartographic files, public domain.
 *
 * Usage:  node scripts/build-map.mjs [--verify] [travel.json] [outSvg] [outData]
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve, join } from "node:path";

const args = process.argv.slice(2).filter((a) => a !== "--verify");
const VERIFY = process.argv.includes("--verify");

const IN = resolve(args[0] || "site/data/travel.json");
const OUT_SVG = resolve(args[1] || "site/static/imgs/us-visited.svg");
const OUT_DATA = resolve(args[2] || "site/data/travel-map.json");
const BEEN = resolve("site/data/been.json");
const MEDIA = resolve("site/data/media.json");

const SOURCE = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-albers-10m.json";
const CREDIT = {
  file: "us-atlas states-albers-10m",
  author: "Mike Bostock / US Census Bureau",
  licence: "ISC (code), public domain (boundaries)",
  source: "https://github.com/topojson/us-atlas",
};

/* The canvas the file is projected onto. Not a guess; see --verify. */
const W = 975, H = 610;
const K = 1300, T = [487.5, 305];

/* ---------------------------------------------------------------- projection */
const RAD = Math.PI / 180;
function conicEqualAreaRaw(y0, y1) {
  const s0 = Math.sin(y0), n = (s0 + Math.sin(y1)) / 2;
  const c = 1 + s0 * (2 * n - s0), r0 = Math.sqrt(c) / n;
  return (x, y) => {
    const r = Math.sqrt(c - 2 * n * Math.sin(y)) / n;
    return [r * Math.sin((x *= n)), r0 - r * Math.cos(x)];
  };
}
const wrap = (l) => (l > Math.PI ? l - 2 * Math.PI : l < -Math.PI ? l + 2 * Math.PI : l);

function conic(parallels, rotDeg, centreDeg, k, t) {
  const raw = conicEqualAreaRaw(parallels[0] * RAD, parallels[1] * RAD);
  const c = raw(centreDeg[0] * RAD, centreDeg[1] * RAD); // NOT rotated; see the header
  return (lon, lat) => {
    const p = raw(wrap((lon + rotDeg) * RAD), lat * RAD);
    return [k * (p[0] - c[0]) + t[0], t[1] - k * (p[1] - c[1])];
  };
}

const lower48 = conic([29.5, 45.5], 96, [-0.6, 38.7], K, T);
const alaska = conic([55, 65], 154, [-2, 58.5], K * 0.35, [T[0] - 0.307 * K, T[1] + 0.201 * K]);
const hawaii = conic([8, 18], 157, [-3, 19.9], K, [T[0] - 0.205 * K, T[1] + 0.212 * K]);

/* d3 picks the sub-projection by testing which clip extent the projected point
   falls into. Doing it geographically is equivalent here and much shorter: the
   two insets are the only things out that far. */
function albersUsa(lon, lat) {
  if (lat > 50 && lon < -125) return alaska(lon, lat);
  if (lat < 25 && lon < -140) return hawaii(lon, lat);
  return lower48(lon, lat);
}

/* ------------------------------------------------------------------ topology */
let topo;
try {
  const res = await fetch(SOURCE, {
    headers: { "User-Agent": "parkerhunt.me-build/1.0 (https://parkerhunt.me)" },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  topo = await res.json();
} catch (err) {
  console.error(`ERROR: could not fetch the boundary file: ${err.message}`);
  process.exit(1);
}

const [qx, qy] = topo.transform.scale;
const [ox, oy] = topo.transform.translate;

/* Douglas–Peucker, applied ONCE PER ARC rather than per ring.
 *
 * That distinction is the whole reason the borders still line up. An arc in
 * TopoJSON is a shared border segment: Nevada and Utah reference the same one,
 * one of them backwards, so simplifying the arc simplifies both sides
 * identically and no seam opens up. Simplifying each state's ring separately
 * would drop different points on each side of the same line and leave white
 * cracks down the middle of the country.
 *
 * The 10m file is drawn for a full-screen map. This one renders about 600 CSS
 * px wide, where 0.7 units is roughly half a pixel: invisible, and it removes
 * two thirds of the points. */
const TOLERANCE = 0.7;
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    let far = -1, worst = tol;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      // Perpendicular distance; degenerate segment falls back to point distance.
      const d = len ? Math.abs(dy * px - dx * py + bx * ay - by * ax) / len : Math.hypot(px - ax, py - ay);
      if (d > worst) { worst = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/* TopoJSON stores each arc as quantised deltas. Decoding is a running sum;
   a negative index means "this arc, backwards", which is how two states share
   one border without storing it twice. */
const arcCache = new Map();
function arcPoints(i) {
  const rev = i < 0;
  if (rev) i = ~i;
  let pts = arcCache.get(i);
  if (!pts) {
    let x = 0, y = 0;
    pts = [];
    for (const [dx, dy] of topo.arcs[i]) {
      x += dx; y += dy;
      pts.push([x * qx + ox, y * qy + oy]);
    }
    pts = simplify(pts, TOLERANCE);
    arcCache.set(i, pts);
  }
  return rev ? pts.slice().reverse() : pts;
}
function ringPoints(ids) {
  const pts = [];
  for (const id of ids) {
    const a = arcPoints(id);
    pts.push(...(pts.length ? a.slice(1) : a));
  }
  return pts;
}
const polygons = (g) => (g.type === "Polygon" ? [g.arcs] : g.arcs);

/* One decimal place. The quantisation grid underneath is already ~0.01 units,
   so this loses nothing visible and takes the file from ~230 KB to ~90 KB. */
const r1 = (n) => (Math.round(n * 10) / 10).toString();

function pathFor(g) {
  let d = "";
  for (const poly of polygons(g)) {
    for (const ring of poly) {
      const pts = ringPoints(ring);
      if (pts.length < 3) continue;
      d += `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
      for (let i = 1; i < pts.length; i++) {
        const [x, y] = pts[i];
        d += `L${r1(x)} ${r1(y)}`;
      }
      d += "Z";
    }
  }
  return d;
}

const states = topo.objects.states.geometries.map((g) => ({
  name: g.properties.name,
  d: pathFor(g),
  g,
}));

/* us-atlas keys states by FIPS id and carries the name, not the postal code.
   travel.json is written in postal codes because that is what a person types. */
const CODES = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO",
  Connecticut: "CT", Delaware: "DE", "District of Columbia": "DC", Florida: "FL", Georgia: "GA",
  Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS",
  Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA",
  Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT",
  Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM",
  "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK",
  Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
  Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
};
for (const s of states) s.code = CODES[s.name] || "";

if (states.length < 50) {
  console.error(`ERROR: parsed only ${states.length} states, the source has changed shape.`);
  process.exit(1);
}

/* --------------------------------------------------------------- self-check */
/* Census internal points: a point guaranteed to be inside the state, which is
   exactly the assertion wanted. Michigan is the exception and uses Lansing,
   its published internal point sits in Grand Traverse Bay, which is inside the
   state and outside the polygon, and a self-check that cries wolf on its first
   run is worse than no self-check. */
const INSIDE = {
  AL: [-86.828, 32.789], AK: [-152.404, 63.588], AZ: [-111.664, 34.293], AR: [-92.44, 34.9],
  CA: [-119.663, 37.215], CO: [-105.548, 38.998], CT: [-72.727, 41.575], DE: [-75.5, 38.998],
  DC: [-77.017, 38.904], FL: [-82.494, 28.628], GA: [-83.443, 32.649], HI: [-156.373, 20.778],
  ID: [-114.66, 44.389], IL: [-89.198, 40.065], IN: [-86.281, 39.906], IA: [-93.496, 42.075],
  KS: [-98.38, 38.485], KY: [-85.291, 37.527], LA: [-91.96, 31.07], ME: [-69.222, 45.368],
  MD: [-76.746, 39.056], MA: [-71.799, 42.271], MI: [-84.5555, 42.7325], MN: [-94.309, 46.316],
  MS: [-89.665, 32.741], MO: [-92.477, 38.365], MT: [-109.645, 47.033], NE: [-99.681, 41.527],
  NV: [-116.651, 39.334], NH: [-71.578, 43.686], NJ: [-74.663, 40.184], NM: [-106.111, 34.421],
  NY: [-75.5, 42.954], NC: [-79.389, 35.542], ND: [-100.469, 47.446], OH: [-82.792, 40.292],
  OK: [-97.509, 35.585], OR: [-120.556, 43.936], PA: [-77.797, 40.874], RI: [-71.556, 41.68],
  SC: [-80.898, 33.918], SD: [-100.229, 44.437], TN: [-86.348, 35.858], TX: [-99.352, 31.487],
  UT: [-111.671, 39.337], VT: [-72.665, 44.075], VA: [-78.667, 37.517], WA: [-120.469, 47.381],
  WV: [-80.612, 38.641], WI: [-89.702, 44.638], WY: [-107.551, 42.999],
};
function inState(s, x, y) {
  for (const poly of polygons(s.g)) {
    const r = ringPoints(poly[0]);
    let hit = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      if (r[i][1] > y !== r[j][1] > y &&
          x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) hit = !hit;
    }
    if (hit) return true;
  }
  return false;
}
let checked = 0, failed = [];
for (const s of states) {
  const t = INSIDE[s.code];
  if (!t) continue;
  checked++;
  const [x, y] = albersUsa(t[0], t[1]);
  if (!inState(s, x, y)) failed.push(s.code);
}
if (failed.length) {
  console.error(`ERROR: projection self-check failed for ${failed.join(", ")} (${checked} checked).`);
  console.error("       The canvas or parameters of us-atlas' albers file have changed.");
  process.exit(1);
}
if (VERIFY) {
  console.log(`Projection self-check: ${checked}/${checked} state centroids land inside their own state.`);
  process.exit(0);
}

/* ------------------------------------------------------------------- states */
const travel = JSON.parse(readFileSync(IN, "utf8"));
const want = new Set((travel.visited || []).map((c) => c.trim().toUpperCase()));
if (!want.size) {
  console.error(`ERROR: no states listed in ${IN}`);
  process.exit(1);
}
const known = new Set(states.map((s) => s.code));
const unknown = [...want].filter((c) => !known.has(c));
if (unknown.length) {
  console.error(`ERROR: not US state codes: ${unknown.join(", ")}`);
  process.exit(1);
}

/* --------------------------------------------------------------------- pins */
/* Three sources, one shape. A pin is a place with a coordinate, and a summit is
   a place you had to climb to get to. */
const pins = [];
function addPins(rows, kind) {
  for (const p of rows || []) {
    if (p.lat == null || p.lon == null) continue;
    const [x, y] = albersUsa(p.lon, p.lat);
    // Anything outside the canvas is a coordinate that resolved to the wrong
    // continent. Better to drop it than to jam a pin against the border.
    if (x < 0 || y < 0 || x > W || y > H) {
      console.warn(`  off-canvas, skipped: ${p.name} (${p.lat}, ${p.lon})`);
      continue;
    }
    pins.push({ name: p.name, kind, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  }
}
if (existsSync(BEEN)) {
  const been = JSON.parse(readFileSync(BEEN, "utf8"));
  addPins(been.places, "place");
  addPins(been.skiing, "ski");
}
if (existsSync(MEDIA)) {
  const media = JSON.parse(readFileSync(MEDIA, "utf8"));
  addPins(media.peaks, "peak");
}

/* Two places 3px apart are one blob. Nudging them apart would be a lie about
   where they are, so they are drawn as-is and the count says how many. */
const TONE = { place: "#0071e3", ski: "#0071e3", peak: "#0071e3" };
const dots = pins
  .map((p) => `<circle class="pin pin--${p.kind}" cx="${p.x}" cy="${p.y}" r="4.5"><title>${p.name.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</title></circle>`)
  .join("");

const body = states
  .map((s) => `<path class="${want.has(s.code) ? "on" : "off"}" d="${s.d}"><title>${s.name}</title></path>`)
  .join("");

/* Styles live inside the file because an <img>-referenced SVG cannot see the
   page's stylesheet. Colours match the shell's --accent and --bg-soft. */
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" ` +
  `aria-label="Map of the United States with ${want.size} states filled in and ${pins.length} places pinned">` +
  `<title>Where I have been</title>` +
  `<style>path{stroke:#fff;stroke-width:1;stroke-linejoin:round}.off{fill:#e6e6ea}.on{fill:#9ec6f0}` +
  `.pin{stroke:#fff;stroke-width:1.5}.pin--place{fill:#0a4f9e}.pin--ski{fill:#6d3bd1}.pin--peak{fill:#0a7c4a}</style>` +
  body + dots +
  `</svg>\n`;

/* CONTENT-HASHED, and this is not a nicety.
 *
 * _headers serves /imgs/* with `max-age=31536000, immutable`, which is correct
 * for art whose filename encodes its contents and catastrophic for a file whose
 * name stays put while its contents change. Adding two states to the map and
 * re-deploying under the same name meant every browser that had ever loaded the
 * page kept the old map for a year. The states were filled in the file and
 * nobody could see it. Pins are in the hash for the same reason. */
const stamp = createHash("sha256")
  .update([...want].sort().join(",") + "|" + pins.map((p) => `${p.name}:${p.x},${p.y}`).join(";"))
  .digest("hex")
  .slice(0, 8);
const named = OUT_SVG.replace(/\.svg$/, `-${stamp}.svg`);

mkdirSync(dirname(named), { recursive: true });
for (const f of readdirSync(dirname(named))) {
  if (/^us-visited(-[0-9a-f]{8})?\.svg$/.test(f) && join(dirname(named), f) !== named) {
    unlinkSync(join(dirname(named), f));
  }
}
writeFileSync(named, svg);

mkdirSync(dirname(OUT_DATA), { recursive: true });
writeFileSync(
  OUT_DATA,
  JSON.stringify(
    {
      built: new Date().toISOString().slice(0, 10),
      map: `/imgs/${named.split("/").pop()}`,
      count: want.size,
      total: states.length,
      pins: pins.length,
      pins_by_kind: pins.reduce((a, p) => ({ ...a, [p.kind]: (a[p.kind] || 0) + 1 }), {}),
      credit: CREDIT,
      // Alphabetical by name, which is the order a list of places wants to be
      // read in, the codes are only there to key the map.
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
  `Map: ${want.size} of ${states.length} states, ${pins.length} pins ` +
    `(${Object.entries(pins.reduce((a, p) => ({ ...a, [p.kind]: (a[p.kind] || 0) + 1 }), {})).map(([k, v]) => `${v} ${k}`).join(", ")}), ` +
    `${(svg.length / 1024).toFixed(0)} KB -> ${named}`
);
