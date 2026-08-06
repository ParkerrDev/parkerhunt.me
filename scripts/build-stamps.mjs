#!/usr/bin/env node
/**
 * Write site/data/stamps.json — durations that have to be recomputed rather
 * than typed, because they are wrong the day after they are written.
 *
 * "9 years, 9 months and 17 days on X" is a lovely thing to put on a page and a
 * terrible thing to hardcode: it decays every single day. So the anchor date is
 * what is stored, and the elapsed years / months / days are derived on every
 * deploy.
 *
 * The calendar arithmetic is done properly, not with 365.2425 and 30.44. An
 * approximation that reports 18 days when the true answer is 17 is worse than
 * showing nothing, since the whole appeal of the figure is that it is exact.
 * Borrowing uses the real length of the previous month, which is the only part
 * of this that is easy to get wrong.
 *
 * Usage:  node scripts/build-stamps.mjs [out]
 *
 * No network, so nothing to fail soft about — this one is pure arithmetic and
 * either runs or the build is already broken for another reason.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const OUT = resolve(process.argv[2] || "site/data/stamps.json");

/* The anchors. Dates, not durations — that is the whole point of the file.
   Add one here and it appears in stamps.json under the same key. */
const ANCHORS = {
  // Derived from "9 years, 9 months and 17 days" as of 2026-08-05.
  x: { since: "2016-10-19", what: "on X" },
};

/* Counted in Pacific time, not in the builder's clock. Cloudflare builds in UTC,
   so for the seven hours a day the two disagree an unpinned count would say 18
   days where the person whose anniversary it is would say 17 — and it would
   flip depending on what time of day the deploy ran. Pinning the zone makes the
   builder's location irrelevant, which is the actual robustness win here. */
const ZONE = "America/Los_Angeles";

function todayIn(zone, date) {
  const [{ value: mo }, , { value: da }, , { value: yr }] = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return [Number(yr), Number(mo), Number(da)];
}

/** Whole calendar years, months and days between two dates. */
function elapsed(fromISO, to) {
  const [fy, fm, fd] = fromISO.split("-").map(Number);
  const [ty, tm, td] = todayIn(ZONE, to);

  let y = ty - fy;
  let m = tm - fm;
  let d = td - fd;

  if (d < 0) {
    // Borrow from the month before `to`, using its real length. Day 0 of a
    // month is the last day of the one before it, which is the shortest
    // correct way to ask "how many days did that month have".
    m -= 1;
    d += new Date(Date.UTC(ty, tm - 1, 0)).getUTCDate();
  }
  if (m < 0) {
    m += 12;
    y -= 1;
  }

  // Total days is computed from the same zoned "today", so it can never
  // disagree with the y/m/d above by a day.
  const days = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
  return { y, m, d, days };
}

/** "9 years, 9 months and 17 days" — Oxford-comma-free, zero parts dropped. */
function phrase({ y, m, d }) {
  const parts = [];
  if (y) parts.push(`${y} year${y === 1 ? "" : "s"}`);
  if (m) parts.push(`${m} month${m === 1 ? "" : "s"}`);
  if (d) parts.push(`${d} day${d === 1 ? "" : "s"}`);
  if (!parts.length) return "today";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const now = new Date();
const stamps = { computed: now.toISOString().slice(0, 10) };

for (const [key, a] of Object.entries(ANCHORS)) {
  const e = elapsed(a.since, now);
  stamps[key] = { since: a.since, what: a.what, ...e, phrase: phrase(e) };
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(stamps, null, 2) + "\n");

console.log(
  `Stamps: ${Object.entries(ANCHORS)
    .map(([k]) => `${k} ${stamps[k].phrase}`)
    .join(", ")} -> ${OUT}`
);
