#!/usr/bin/env node
/**
 * Derive each project's accent colour from its own card art.
 *
 *   site/content/projects/*.md   in and out: `accent` and `accent_ink` in [extra]
 *   site/static/imgs/project-cards/opt/*.webp   read
 *
 * WHY THIS IS A SCRIPT AND NOT FIVE HAND-PICKED HEX VALUES. /projects/ gives
 * every project a band in its own colour. Choosing those by eye means the band
 * and the picture inside it drift apart the moment any art is re-exported, and
 * nobody notices because nothing breaks. Sampling the art means they cannot
 * disagree: re-run this after changing a card and the page follows.
 *
 * TWO VALUES, NOT ONE, AND THE SECOND ONE IS THE POINT. `accent` is the vivid
 * colour, it drives the rule, the tint, the chips. `accent_ink` is the text
 * colour to put ON that accent, and it has to be computed rather than assumed:
 * AppIt's card is a light yellow-green, where white text scores 1.5:1 and is
 * simply unreadable, while Rickvirus's is a dark brown where black text would
 * be. Picking whichever of black/white wins, and darkening the accent only if
 * neither clears 4.5:1, keeps every button both vivid and legible.
 *
 * Needs dwebp and sips (macOS). RUN LOCALLY, COMMIT THE RESULT, the built
 * site reads the front matter, never this.
 *
 * Usage:  node scripts/project-accents.mjs [--check]
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";

const DIR = "site/content/projects";
const CHECK = process.argv.includes("--check");
const tmp = tmpdir();

/* ---- colour ------------------------------------------------------------- */

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const l2s = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const lum = ([r, g, b]) => 0.2126 * s2l(r) + 0.7152 * s2l(g) + 0.0722 * s2l(b);
const contrast = (a, b) => {
  const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
  return (hi + 0.05) / (lo + 0.05);
};
const hex = (rgb) => "#" + rgb.map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");

function toOklab([r, g, b]) {
  r = s2l(r); g = s2l(g); b = s2l(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}
function toRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    l2s(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    l2s(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    l2s(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
  ].map((x) => Math.min(1, Math.max(0, x)));
}

/* ---- the sample --------------------------------------------------------- */

/** The most saturated pixel in a small downscale, ignoring near-black. An
 *  average would return mud: these cards are mostly one flat field plus white
 *  artwork, and the mean of those two is a pastel that appears nowhere. */
function accentOf(webp) {
  execFileSync("dwebp", ["-quiet", webp, "-o", join(tmp, "_pa.png")]);
  execFileSync("sips", ["-z", "18", "48", join(tmp, "_pa.png"), "--out", join(tmp, "_pb.png")], { stdio: "ignore" });
  execFileSync("sips", ["-s", "format", "bmp", join(tmp, "_pb.png"), "--out", join(tmp, "_pb.bmp")], { stdio: "ignore" });
  const b = readFileSync(join(tmp, "_pb.bmp"));
  const off = b.readUInt32LE(10), w = b.readInt32LE(18), h = Math.abs(b.readInt32LE(22));
  const bpp = b.readUInt16LE(28) / 8, row = Math.ceil((w * bpp) / 4) * 4;
  let best = null, bestScore = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = off + y * row + x * bpp;
      const rgb = [b[p + 2] / 255, b[p + 1] / 255, b[p] / 255];
      const mx = Math.max(...rgb), mn = Math.min(...rgb);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      const score = sat * Math.min(mx, 1 - Math.abs(mx - 0.75));
      if (mx > 0.235 && score > bestScore) { bestScore = score; best = rgb; }
    }
  }
  return best;
}

/** Black or white, whichever reads on this colour, darkening the colour only
 *  as far as it takes for one of them to clear AA. */
function inkFor(rgb) {
  const W = [1, 1, 1], K = [0.067, 0.067, 0.071];
  let c = rgb;
  for (let step = 0; step <= 12; step++) {
    const onW = contrast(c, W), onK = contrast(c, K);
    if (Math.max(onW, onK) >= 4.5) return { accent: hex(c), ink: onW >= onK ? "#ffffff" : "#111112", ratio: Math.max(onW, onK) };
    c = toRgb(toOklab(c).map((v, i) => (i === 0 ? v * 0.92 : v)));   // darken, keep hue
  }
  return { accent: hex(c), ink: "#ffffff", ratio: contrast(c, W) };
}

/* ---- write it back ------------------------------------------------------ */

let changed = 0, drift = [];
for (const f of readdirSync(DIR).filter((n) => n.endsWith(".md") && n !== "_index.md")) {
  const path = join(DIR, f);
  let src = readFileSync(path, "utf8");
  const card = (src.match(/card_image = "([^"]+)"/) || [])[1];
  if (!card) { console.log(`  ${f.padEnd(24)} no card_image, skipped`); continue; }
  const webp = "site/static" + card;
  if (!existsSync(webp)) { console.log(`  ${f.padEnd(24)} ${webp} missing, skipped`); continue; }

  const { accent, ink, ratio } = inkFor(accentOf(webp));
  const had = (src.match(/accent = "([^"]+)"/) || [])[1];
  const hadInk = (src.match(/accent_ink = "([^"]+)"/) || [])[1];
  const same = had === accent && hadInk === ink;
  console.log(`  ${basename(f, ".md").padEnd(20)} ${accent}  ink ${ink}  ${ratio.toFixed(1)}:1${same ? "" : "   <- updated"}`);
  if (same) continue;
  if (CHECK) { drift.push(f); continue; }

  if (had) src = src.replace(/accent = "[^"]*"/, `accent = "${accent}"`);
  else src = src.replace(/(card_image = "[^"]*"\n)/, `$1accent = "${accent}"\n`);
  if (hadInk) src = src.replace(/accent_ink = "[^"]*"/, `accent_ink = "${ink}"`);
  else src = src.replace(/(accent = "[^"]*"\n)/, `$1accent_ink = "${ink}"\n`);
  writeFileSync(path, src);
  changed++;
}

if (CHECK && drift.length) {
  console.error(`\n${drift.length} project(s) disagree with their card art: ${drift.join(", ")}`);
  process.exit(1);
}
console.log(`\n${changed} file(s) updated.`);
