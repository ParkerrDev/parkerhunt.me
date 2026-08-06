#!/usr/bin/env node
/**
 * Snapshot a Duolingo profile into site/data/duolingo.json.
 *
 * Endpoint:  duolingo.com/2017-06-30/users?username=<user>
 *
 * This is the same call the Duolingo web app makes for a public profile. It is
 * undocumented rather than secret — no key, no cookie — but "undocumented"
 * means it can move without notice, which is exactly why this script fails soft
 * and the site renders from the committed snapshot either way.
 *
 * Usage:  node scripts/fetch-duolingo.mjs [username] [out]
 */

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const USER = process.argv[2] || "parkerhunt.me";
const OUT = resolve(process.argv[3] || "site/data/duolingo.json");

/* Enough to draw a flag as a few rectangles and a couple of paths, keyed by
   Duolingo's own language codes. `flag` is picked up by the template, which
   holds the actual SVG — this file stays data. */
const COURSES = {
  zh: { flag: "cn", native: "中文", label: "Chinese" },
  es: { flag: "es", native: "Español", label: "Spanish" },
  fr: { flag: "fr", native: "Français", label: "French" },
  de: { flag: "de", native: "Deutsch", label: "German" },
  ja: { flag: "jp", native: "日本語", label: "Japanese" },
  it: { flag: "it", native: "Italiano", label: "Italian" },
  ko: { flag: "kr", native: "한국어", label: "Korean" },
  pt: { flag: "pt", native: "Português", label: "Portuguese" },
};

function bail(reason) {
  console.warn(`WARNING: Duolingo snapshot not refreshed (${reason}).`);
  console.warn(
    existsSync(OUT)
      ? "         Keeping the committed snapshot."
      : "         No snapshot on disk — the Duolingo section will be hidden."
  );
  process.exit(0);
}

let body;
try {
  const res = await fetch(
    `https://www.duolingo.com/2017-06-30/users?username=${encodeURIComponent(USER)}`,
    {
      headers: { "User-Agent": "parkerhunt.me-build", Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  body = await res.json();
} catch (err) {
  bail(err.name === "TimeoutError" ? "request timed out" : err.message);
}

const u = body?.users?.[0];
if (!u) bail("no such user in the response");

/* `crowns` comes back as the sentinel 9999 on public profiles rather than a
   real count, so it is dropped rather than rendered as a number that means
   nothing. XP is real. */
const courses = (u.courses || [])
  .map((c) => {
    const meta = COURSES[c.learningLanguage] || {};
    return {
      code: c.learningLanguage,
      title: c.title,
      label: meta.label || c.title,
      native: meta.native || "",
      flag: meta.flag || "",
      xp: c.xp || 0,
      current: c.id === u.currentCourseId,
    };
  })
  .sort((a, b) => b.xp - a.xp);

const total = courses.reduce((n, c) => n + c.xp, 0) || u.totalXp || 0;
for (const c of courses) c.share = total ? Math.round((c.xp / total) * 100) : 0;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      username: u.username,
      name: u.name || u.username,
      url: `https://www.duolingo.com/profile/${u.username}`,
      fetched: new Date().toISOString().slice(0, 10),
      joined: u.creationDate ? new Date(u.creationDate * 1000).toISOString().slice(0, 10) : "",
      total_xp: u.totalXp || total,
      // Duolingo reports both; streakData.currentStreak is null once a streak
      // has lapsed, and `streak` is then 0. Zero is the honest number and the
      // template draws the grey flame for it, exactly like Duolingo does.
      streak: u.streakData?.currentStreak?.length ?? u.streak ?? 0,
      has_plus: !!u.hasPlus,
      courses,
    },
    null,
    2
  ) + "\n"
);

console.log(
  `Duolingo snapshot: ${courses.length} courses, ${u.totalXp || total} XP, ` +
    `${u.streak ?? 0}-day streak -> ${OUT}`
);
