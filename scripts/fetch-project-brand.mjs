#!/usr/bin/env node
/**
 * Each project's own mark, taken from each project's own site.
 *
 *   site/content/projects/*.md          in , website_url
 *   site/static/imgs/project-brand/*.webp out
 *   `brand_image` written back into [extra]
 *
 * WHY NOT JUST DRAW FIVE ICONS. A band that claims to carry a project's
 * branding should carry the branding the project actually ships, not an
 * interpretation of it. The apple-touch-icon a site serves IS its mark, chosen
 * by whoever built it, which for all five of these was the same person, so
 * pulling it is the difference between the page quoting him and paraphrasing
 * him.
 *
 * AND WHY THE FILE IS COPIED HERE RATHER THAN HOTLINKED. Every other image on
 * this site is served from this origin, so that loading a page cannot tell
 * appitapp.app or rickvir.us that somebody looked. Hotlinking five favicons
 * would quietly undo that for the sake of five HTTP requests. See DATA.md.
 *
 * Order of preference, best-quality first: apple-touch-icon (usually 180px+ and
 * already square), then any <link rel=icon> that is not a .ico, then og:image
 * (big but rarely square, so it gets centre-cropped), then /favicon.ico.
 *
 * Fails soft, like every other fetcher: a project whose site is down keeps the
 * mark it already has, and a project that never had one renders its band
 * without one. Needs cwebp and sips. RUN LOCALLY, COMMIT THE OUTPUT.
 *
 * Usage:  node scripts/fetch-project-brand.mjs
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DIR = "site/content/projects";
const OUT = "site/static/imgs/project-brand";
const UA = { "User-Agent": "parkerhunt.me-build/1.0 (+https://parkerhunt.me)" };
const tmp = tmpdir();

mkdirSync(OUT, { recursive: true });

const abs = (href, base) => { try { return new URL(href, base).href; } catch { return null; } };

async function iconCandidates(site) {
  const res = await fetch(site, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(20000) });
  const html = await res.text();
  const base = res.url || site;
  const out = [];
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const attr = (tag, name) => (tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i")) || [])[1];
  const sized = (t) => { const s = attr(t, "sizes"); return s ? parseInt(s, 10) || 0 : 0; };

  const touch = links.filter((t) => /rel\s*=\s*["'][^"']*apple-touch-icon/i.test(t))
                     .sort((a, b) => sized(b) - sized(a));
  for (const t of touch) { const h = attr(t, "href"); if (h) out.push(abs(h, base)); }

  const icons = links.filter((t) => /rel\s*=\s*["'][^"']*\bicon\b/i.test(t) && !/apple-touch/i.test(t))
                     .sort((a, b) => sized(b) - sized(a));
  for (const t of icons) { const h = attr(t, "href"); if (h && !/\.ico(\?|$)/i.test(h)) out.push(abs(h, base)); }

  const og = (html.match(/<meta[^>]+property\s*=\s*["']og:image["'][^>]*>/i) || [])[0];
  if (og) { const h = attr(og, "content"); if (h) out.push(abs(h, base)); }

  for (const t of icons) { const h = attr(t, "href"); if (h) out.push(abs(h, base)); }
  out.push(abs("/favicon.ico", base));
  return [...new Set(out.filter(Boolean))];
}

/** Download, square-crop, and write a 128px webp. Returns bytes, or null. */
async function makeMark(url, slug) {
  const res = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(20000) });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 64) return null;
  const raw = join(tmp, `pb-${slug}`);
  writeFileSync(raw, buf);

  // Everything goes through sips first: it reads ico, svg, png, jpeg and heic,
  // and cwebp reads almost none of those.
  const png = join(tmp, `pb-${slug}.png`);
  try { execFileSync("sips", ["-s", "format", "png", raw, "--out", png], { stdio: "ignore" }); }
  catch { return null; }

  const dims = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", png]).toString();
  const w = +(dims.match(/pixelWidth: (\d+)/) || [])[1] || 0;
  const h = +(dims.match(/pixelHeight: (\d+)/) || [])[1] || 0;
  if (w < 48 || h < 48) return null;                      // a 16px favicon is not a mark
  const side = Math.min(w, h);
  execFileSync("sips", ["-c", String(side), String(side), png, "--out", png], { stdio: "ignore" });
  execFileSync("sips", ["-Z", "128", png, "--out", png], { stdio: "ignore" });

  /* CONTENT-HASHED, and this is not decoration. _headers serves /imgs/* with
     `max-age=31536000, immutable`, so a mark written to a fixed path and then
     replaced is invisible: every edge node and every browser that saw the first
     version keeps it for a year. Three marks were revised repeatedly at fixed
     names and the live site went on serving the originals throughout, which
     looked exactly like the fix not working. The hash in the name means a
     changed file is a changed URL. */
  const tmpOut = join(tmpdir(), `pb-out-${slug}.webp`);
  execFileSync("cwebp", ["-quiet", "-q", "86", png, "-o", tmpOut]);
  const stamp = createHash("sha256").update(readFileSync(tmpOut)).digest("hex").slice(0, 8);
  const name = `${slug}-${stamp}.webp`;
  const out = join(OUT, name);
  writeFileSync(out, readFileSync(tmpOut));
  // drop any earlier hash for this slug, so the folder holds one file per mark
  for (const old of readdirSync(OUT)) {
    if (old !== name && (old === `${slug}.webp` || old.startsWith(`${slug}-`))) unlinkSync(join(OUT, old));
  }
  return { size: statSync(out).size, name };
}

let ok = 0, kept = 0;
for (const f of readdirSync(DIR).filter((n) => n.endsWith(".md") && n !== "_index.md")) {
  const path = join(DIR, f);
  let src = readFileSync(path, "utf8");
  const site = (src.match(/website_url = "([^"]+)"/) || [])[1];
  const slug = f.replace(/\.md$/, "");
  if (!site) { console.log(`  ${slug.padEnd(18)} no website_url, skipped`); continue; }

  /* Some projects ship no icon a browser could use, and this is not a fetch bug.
     Pocklet's markup and its manifest both point at /icons/icon-192.png and
     friends; its host answers every one of them with the 52 KB HTML page, so
     the files are simply not deployed and its own PWA install has no icon
     either. Trion ships a single 32px favicon, which upscaled to a 40px plate
     at 2x is mush. For those two the mark was cut out of the project's own card
     art, where the logo already lives at usable resolution.

     TempleOS is flagged for a different reason: its logo is 128x152, and the
     square crop below takes the centre, which cut the top and bottom off its
     own frame along with the sword's tip and pommel. Its mark is the same logo
     fitted into the square instead of cropped to it.

     Delete brand_manual once a site serves an icon this can use unaltered. */
  if (/brand_manual = true/.test(src)) {
    console.log(`  ${slug.padEnd(18)} hand-composed mark, left alone`);
    continue;
  }

  let wrote = null, from = null;
  try {
    for (const cand of await iconCandidates(site)) {
      try { const n = await makeMark(cand, slug); if (n) { wrote = n; from = cand; break; } } catch {}
    }
  } catch (err) {
    console.warn(`  ${slug.padEnd(18)} ${site} unreachable (${err.message})`);
  }

  if (!wrote) {
    const had = existsSync(join(OUT, `${slug}.webp`));
    console.log(`  ${slug.padEnd(18)} no usable mark${had ? ", keeping the one already here" : ""}`);
    if (!had) continue;
    kept++;
  } else {
    console.log(`  ${slug.padEnd(18)} ${Math.round(wrote.size / 1024)} KB  ${wrote.name}`);
    ok++;
  }

  const rel = wrote ? `/imgs/project-brand/${wrote.name}` : null;
  if (!rel) continue;
  if (!src.includes(`brand_image = "${rel}"`)) {
    src = src.includes("brand_image =")
      ? src.replace(/brand_image = "[^"]*"/, `brand_image = "${rel}"`)
      : src.replace(/(card_image = "[^"]*"\n)/, `$1brand_image = "${rel}"\n`);
    writeFileSync(path, src);
  }
}
console.log(`\n${ok} mark(s) fetched, ${kept} kept.`);
