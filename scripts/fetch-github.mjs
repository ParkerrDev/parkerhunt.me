#!/usr/bin/env node
/**
 * Snapshot the public repositories of a GitHub user into site/data/github.json,
 * so the repo list on the home page is rendered at build time and the visitor's
 * browser never talks to GitHub.
 *
 * Usage:  node scripts/fetch-github.mjs [user] [outFile]
 *
 * WHY THIS IS ALLOWED TO FAIL
 *
 * The unauthenticated GitHub API allows 60 requests an hour per IP, and
 * Cloudflare's build machines share addresses with everyone else building on
 * Cloudflare. A rate-limited build is not a reason to fail a deploy, so on any
 * error this script leaves the committed snapshot in place, warns, and exits 0.
 * The page then shows the last known good list, which is a day or two stale at
 * worst, far better than a broken deploy or an empty section.
 *
 * That is the opposite of scripts/build-resume.mjs, which fails hard: a missing
 * résumé is a dead link on the one page whose whole job is to be handed to
 * someone, whereas a slightly stale repo list is invisible.
 */

import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const USER = process.argv[2] || "ParkerrDev";
const OUT = resolve(process.argv[3] || "site/data/github.json");

/* Linguist's own colours for the languages this account actually uses. Kept
   here rather than in the template so the JSON is self-describing and the Tera
   side stays a dumb renderer. Unknown languages fall through to grey. */
const COLORS = {
  "C#": "#178600",
  C: "#555555",
  "C++": "#f34b7d",
  CSS: "#663399",
  Go: "#00ADD8",
  HTML: "#e34c26",
  HolyC: "#ffefaf",
  Java: "#b07219",
  JavaScript: "#f1e05a",
  Kotlin: "#A97BFF",
  Lua: "#000080",
  Nix: "#7e7eff",
  "Objective-C": "#438eff",
  PHP: "#4F5D95",
  Python: "#3572A5",
  Ruby: "#701516",
  Rust: "#dea584",
  SCSS: "#c6538c",
  ShaderLab: "#222c37",
  Shell: "#89e051",
  Svelte: "#ff3e00",
  Swift: "#F05138",
  TypeScript: "#3178c6",
  Vue: "#41b883",
  Zig: "#ec915c",
};

const api = `https://api.github.com/users/${encodeURIComponent(
  USER
)}/repos?per_page=100&sort=updated&type=owner`;

function bail(reason) {
  // Non-fatal by design; see the header comment.
  console.warn(`WARNING: GitHub snapshot not refreshed (${reason}).`);
  if (existsSync(OUT)) {
    try {
      const n = JSON.parse(readFileSync(OUT, "utf8")).repos?.length ?? 0;
      console.warn(`         Keeping the committed snapshot (${n} repos).`);
    } catch {
      console.warn("         Existing snapshot is unreadable.");
    }
  } else {
    console.warn("         No snapshot on disk, the repo section will be empty.");
  }
  process.exit(0);
}

let res;
try {
  res = await fetch(api, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "parkerhunt.me-build",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(15000),
  });
} catch (err) {
  bail(err.name === "TimeoutError" ? "request timed out" : err.message);
}

if (!res.ok) {
  const remaining = res.headers.get("x-ratelimit-remaining");
  bail(
    remaining === "0"
      ? "rate limited by the unauthenticated API"
      : `HTTP ${res.status}`
  );
}

const raw = await res.json();
if (!Array.isArray(raw)) bail("unexpected response shape");

const repos = raw
  // Forks are someone else's work and archives are finished; neither belongs in
  // a "what am I building" list.
  .filter((r) => !r.fork && !r.archived && !r.private)
  .map((r) => ({
    name: r.name,
    url: r.html_url,
    description: r.description || "",
    language: r.language || "",
    color: COLORS[r.language] || "#8b949e",
    stars: r.stargazers_count,
    forks: r.forks_count,
    // Date only: the time of day is noise, and it would make the JSON churn on
    // every build for no visible change.
    updated: (r.pushed_at || r.updated_at || "").slice(0, 10),
    license: r.license?.spdx_id && r.license.spdx_id !== "NOASSERTION" ? r.license.spdx_id : "",
  }));

if (repos.length === 0) bail("the API returned no public repositories");

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify({ user: USER, fetched: new Date().toISOString().slice(0, 10), repos }, null, 2) + "\n"
);
console.log(`GitHub snapshot: ${repos.length} public repos -> ${OUT}`);
