#!/usr/bin/env node
/**
 * Snapshot a Nexus Mods author's profile and published mods into
 * site/data/nexus.json.
 *
 * Nexus Mods' v2 GraphQL router answers both of these queries unauthenticated —
 * the same two their own profile page fires — so no API key is needed and
 * nothing here touches an account:
 *
 *   POST https://api-router.nexusmods.com/graphql
 *   mods(filter: { uploaderId: <id> }) { name summary downloads endorsements ... }
 *   userByName(name: <handle>)         { kudos views uniqueModDownloads ... }
 *
 * TWO KINDS OF DOWNLOAD NUMBER, AND THEY DISAGREE ON PURPOSE. `totals.downloads`
 * is the sum of every mod's download count — 18,536. `profile.unique_downloads`
 * is what Nexus itself puts on the profile page — 15,612 — and counts each
 * person once no matter how many of the five mods they took. Neither is wrong
 * and neither is the other; label them separately or the section quietly claims
 * a number that is not on Nexus.
 *
 * THE AVATAR needs cwebp, so it only refreshes on a local run. Nexus serves it
 * at 100px and 19 KB; re-encoding gets that to about 2.5 KB for a picture that
 * renders at 56 CSS px. On the Cloudflare builder there is no cwebp, the
 * download is skipped, and the committed file stays — same fail-soft rule as
 * everything else here.
 *
 * Usage:  node scripts/fetch-nexus.mjs [uploaderId] [out]
 *
 * FAILS SOFT — see scripts/fetch-github.mjs.
 */

import { writeFileSync, existsSync, mkdirSync, unlinkSync, statSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";

const UPLOADER = process.argv[2] || "186080535";
const OUT = resolve(process.argv[3] || "site/data/nexus.json");
const AVATAR_DIR = resolve("site/static/imgs/nexus");

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

/* Everything the profile page shows in its hero, and nothing it does not: no
   email, no 2FA state, no moderation history. Those fields exist on the type
   and are only populated for the signed-in user anyway — asking for them would
   return nulls and make this look like it wanted them. */
const PROFILE = `query UserByName($name: String!) {
  userByName(name: $name) {
    memberId name avatar joined
    kudos views posts
    recognizedAuthor uniqueModDownloads endorsementsGiven
    membershipRoles
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

async function gql(query, variables) {
  const res = await fetch("https://api-router.nexusmods.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "parkerhunt.me-build",
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

let body;
try {
  body = await gql(QUERY, {
    filter: { uploaderId: [{ value: String(UPLOADER), op: "EQUALS" }] },
    count: 50,
  });
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

/* The profile is a bonus, not a requirement. If this second call fails the mods
   still publish — the island just renders without the hero, which the template
   already guards for. Do NOT promote this to a bail(). */
let profile = null;
try {
  const p = (await gql(PROFILE, { name: author }))?.data?.userByName;
  if (p) {
    profile = {
      member_id: p.memberId,
      joined: (p.joined || "").slice(0, 10),
      kudos: p.kudos || 0,
      views: p.views || 0,
      posts: p.posts || 0,
      // Nexus's own badge wording, so the site says what the profile says.
      verified_author: !!p.recognizedAuthor,
      unique_downloads: p.uniqueModDownloads || 0,
      endorsements_given: p.endorsementsGiven || 0,
      roles: p.membershipRoles || [],
      // "member" is on every account and means nothing; "supporter" is the one
      // the profile page actually renders as a pill.
      badge: (p.membershipRoles || []).find((r) => r !== "member") || "",
      avatar_source: p.avatar || "",
    };
  }
} catch (err) {
  console.warn(`WARNING: Nexus profile not refreshed (${err.message}). Keeping what is in the snapshot.`);
}

/* The avatar, re-encoded and served from this origin like every other image on
   the site. Nexus only ever returns 100×100 here — asking for /200 or /400
   silently hands back the grey placeholder mark, not a bigger picture — so
   there is no retina version to fetch and no point looking for one.
 *
 * THE FILENAME CARRIES A HASH OF THE BYTES, and that is not decoration. _headers
 * serves /imgs/* with `immutable, max-age=31536000`, so a picture that changes
 * while keeping its name is one every returning visitor holds for a year. That
 * has already happened once here — see the note in scripts/build-map.mjs about
 * two states that were filled in the file and invisible in the browser. Change
 * the avatar on Nexus, get a new filename, get a new download. */
function existingAvatar() {
  if (!existsSync(AVATAR_DIR)) return "";
  const f = readdirSync(AVATAR_DIR).find((n) => /^avatar-[0-9a-f]{8}\.webp$/.test(n));
  return f ? `/imgs/nexus/${f}` : "";
}

if (profile?.avatar_source) {
  let haveCwebp = true;
  try {
    execFileSync("cwebp", ["-version"], { stdio: "ignore" });
  } catch {
    haveCwebp = false;
  }
  if (!haveCwebp) {
    console.warn("         cwebp not found — keeping the committed avatar.");
  } else {
    try {
      const res = await fetch(profile.avatar_source, {
        headers: { "User-Agent": "parkerhunt.me-build" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = Buffer.from(await res.arrayBuffer());
      const tmp = join(tmpdir(), "nexus-avatar.webp");
      writeFileSync(tmp, raw);
      mkdirSync(AVATAR_DIR, { recursive: true });
      // Hash the SOURCE bytes, not the re-encoded ones: cwebp is deterministic
      // for a given input, but hashing the input is what actually answers "is
      // this a different picture".
      const stamp = createHash("sha256").update(raw).digest("hex").slice(0, 8);
      const out = join(AVATAR_DIR, `avatar-${stamp}.webp`);
      execFileSync("cwebp", ["-quiet", "-q", "78", tmp, "-o", out]);
      unlinkSync(tmp);
      // Sweep, or the directory grows an avatar per profile-picture change.
      for (const f of readdirSync(AVATAR_DIR)) {
        if (/^avatar-[0-9a-f]{8}\.webp$/.test(f) && join(AVATAR_DIR, f) !== out) unlinkSync(join(AVATAR_DIR, f));
      }
      profile.avatar = `/imgs/nexus/avatar-${stamp}.webp`;
      profile.avatar_bytes = statSync(out).size;
    } catch (err) {
      console.warn(`WARNING: avatar not refreshed (${err.message}).`);
    }
  }
  if (!profile.avatar) profile.avatar = existingAvatar();
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      author,
      url: `https://www.nexusmods.com/profile/${author}`,
      mods_url: `https://www.nexusmods.com/profile/${author}/mods`,
      fetched: new Date().toISOString().slice(0, 10),
      count: mods.length,
      totals,
      profile,
      games: [...new Set(mods.map((m) => m.game))],
      mods,
    },
    null,
    2
  ) + "\n"
);

console.log(
  `Nexus Mods snapshot: ${mods.length} mods, ${totals.downloads.toLocaleString("en-US")} downloads, ` +
    `${totals.endorsements} endorsements` +
    (profile ? `, profile (${profile.unique_downloads.toLocaleString("en-US")} unique, ${profile.kudos} kudos)` : ", no profile") +
    ` -> ${OUT}`
);
