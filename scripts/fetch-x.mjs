#!/usr/bin/env node
/**
 * Snapshot the X (Twitter) profile into site/data/x.json.
 *
 *   site/data/x.json                    out, the profile
 *   site/static/imgs/x/avatar-*.webp    out, the profile picture
 *
 * THE POSTS ARE NOT HERE AND CANNOT BE. Read this before trying again.
 *
 * @AndrewParkerH is a PROTECTED account. Both sources below independently
 * report `protected: true`. A protected account has no public timeline at all:
 * X serves those posts to approved followers only, over an authenticated
 * session, and every route in and out of the building respects that,
 *
 *   - the official API respects it at every price tier, so paying does not help
 *     (and there is no free read tier left: as of February 2026 X replaced the
 *     tiers with pay-per-use at $0.005 per post read, no free allowance);
 *   - syndication.twitter.com/srv/timeline-profile, the endpoint the embed
 *     widget uses, and the last free way to read a timeline, returns
 *     `entries: []` for this account, and now for public accounts too;
 *   - platform.twitter.com/widgets.js, the official embed, renders nothing for
 *     a protected account either. It also drags in a third-party script and a
 *     tracking pixel, which this site does not do;
 *   - Nitter died in February 2024 when X removed guest accounts.
 *
 * The only mechanism that would work is authenticating AS the account and
 * republishing its posts to a public web page, which defeats the entire point
 * of the account being protected. So the posts in site/data/feeds.toml stay
 * hand-written, and the template says why.
 *
 * WHAT *IS* PUBLIC, and is therefore live here: the profile. Name, bio,
 * location, website, join date, follower/following counts, post count, likes,
 * media count, avatar. X shows all of that on a protected profile, the padlock
 * is on the timeline, not the header.
 *
 * SOURCES. FixTweet (api.fxtwitter.com) with a fallback to vxtwitter, both free
 * community services with no key, both returning the same numbers. They are
 * queried at BUILD time only, so no visitor's browser ever contacts either one,
 * and if both are down the committed snapshot stays.
 *
 * Usage:  node scripts/fetch-x.mjs [handle] [out]
 *
 * FAILS SOFT; see scripts/fetch-github.mjs.
 */

import { writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";

const HANDLE = process.argv[2] || "AndrewParkerH";
const OUT = resolve(process.argv[3] || "site/data/x.json");
const AVATAR_DIR = resolve("site/static/imgs/x");

const UA = { "User-Agent": "parkerhunt.me-build/1.0 (https://parkerhunt.me)", Accept: "application/json" };

function bail(reason) {
  console.warn(`WARNING: X profile not refreshed (${reason}).`);
  console.warn(
    existsSync(OUT)
      ? "         Keeping the committed snapshot."
      : "         No snapshot on disk, the X section will show its hand-written half only."
  );
  process.exit(0);
}

async function getJSON(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* Two shapes for the same facts. fxtwitter nests under `user` and gives more
   (likes, media count, banner, website); vxtwitter is flatter and is only here
   so one service going down is not the end of it. */
let profile = null;
let source = "";

try {
  const j = await getJSON(`https://api.fxtwitter.com/${encodeURIComponent(HANDLE)}`);
  const u = j?.user;
  if (!u?.screen_name) throw new Error("no user in response");
  source = "api.fxtwitter.com";
  profile = {
    handle: u.screen_name,
    name: u.name || "",
    url: u.url || `https://x.com/${u.screen_name}`,
    bio: u.description || "",
    location: u.location || "",
    website: u.website?.display_url || "",
    website_url: u.website?.url || "",
    joined: new Date(u.joined).toISOString().slice(0, 10),
    followers: u.followers ?? null,
    following: u.following ?? null,
    posts: u.tweets ?? null,
    likes: u.likes ?? null,
    media: u.media_count ?? null,
    // The whole reason the posts are hand-written. The template reads this and
    // explains itself rather than leaving a mystery gap where a feed should be.
    protected: !!u.protected,
    verified: !!u.verification?.verified,
    avatar_source: (u.avatar_url || "").replace("_normal", "_400x400"),
  };
} catch (err) {
  console.warn(`  fxtwitter: ${err.message}, trying vxtwitter`);
  try {
    const u = await getJSON(`https://api.vxtwitter.com/${encodeURIComponent(HANDLE)}`);
    if (!u?.screen_name) throw new Error("no user in response");
    source = "api.vxtwitter.com";
    profile = {
      handle: u.screen_name,
      name: u.name || "",
      url: `https://x.com/${u.screen_name}`,
      bio: u.description || "",
      location: u.location || "",
      website: "",
      website_url: "",
      joined: new Date(u.created_at).toISOString().slice(0, 10),
      followers: u.followers_count ?? null,
      following: u.following_count ?? null,
      posts: u.tweet_count ?? null,
      likes: null,
      media: null,
      protected: !!u.protected,
      verified: false,
      avatar_source: (u.profile_image_url || "").replace("_normal", "_400x400"),
    };
  } catch (err2) {
    bail(`both sources failed (${err.message}; ${err2.message})`);
  }
}

/* The avatar, re-encoded and served from this origin, pbs.twimg.com is a
   third party and the page does not talk to those. Content-hashed for the
   reason given in scripts/fetch-nexus.mjs: /imgs/* is immutable for a year. */
if (profile.avatar_source) {
  let haveCwebp = true;
  try {
    execFileSync("cwebp", ["-version"], { stdio: "ignore" });
  } catch {
    haveCwebp = false;
    console.warn("         cwebp not found, keeping the committed avatar.");
  }
  if (haveCwebp) {
    try {
      const res = await fetch(profile.avatar_source, { headers: UA, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = Buffer.from(await res.arrayBuffer());
      const stamp = createHash("sha256").update(raw).digest("hex").slice(0, 8);
      const tmp = join(tmpdir(), "x-avatar.bin");
      writeFileSync(tmp, raw);
      mkdirSync(AVATAR_DIR, { recursive: true });
      const out = join(AVATAR_DIR, `avatar-${stamp}.webp`);
      execFileSync("cwebp", ["-quiet", "-q", "80", "-resize", "160", "0", tmp, "-o", out]);
      unlinkSync(tmp);
      for (const f of readdirSync(AVATAR_DIR)) {
        if (/^avatar-[0-9a-f]{8}\.webp$/.test(f) && join(AVATAR_DIR, f) !== out) unlinkSync(join(AVATAR_DIR, f));
      }
      profile.avatar = `/imgs/x/avatar-${stamp}.webp`;
      profile.avatar_bytes = statSync(out).size;
    } catch (err) {
      console.warn(`WARNING: X avatar not refreshed (${err.message}).`);
    }
  }
  if (!profile.avatar && existsSync(AVATAR_DIR)) {
    const f = readdirSync(AVATAR_DIR).find((n) => /^avatar-[0-9a-f]{8}\.webp$/.test(n));
    if (f) profile.avatar = `/imgs/x/${f}`;
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      fetched: new Date().toISOString().slice(0, 10),
      source,
      note: "Profile only. The account is protected, so there is no public timeline to read; see the header of scripts/fetch-x.mjs.",
      profile,
    },
    null,
    2
  ) + "\n"
);

console.log(
  `X profile: @${profile.handle}, ${profile.posts} posts, ${profile.followers} followers` +
    (profile.protected ? " (protected, no public timeline)" : "") +
    ` -> ${OUT}`
);
