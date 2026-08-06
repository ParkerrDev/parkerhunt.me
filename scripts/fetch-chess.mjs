#!/usr/bin/env node
/**
 * Snapshot a Chess.com profile into site/data/chess.json for /chess/.
 *
 * Uses Chess.com's published read-only API (api.chess.com/pub/...), which needs
 * no key, no account and no headers beyond a polite User-Agent:
 *
 *   /pub/player/<user>            joined, league, country, last online
 *   /pub/player/<user>/stats      rating + record per time control, tactics
 *   /pub/player/<user>/games/archives   → the monthly archives
 *   <last archive>                every game that month, with PGN
 *
 * Usage:  node scripts/fetch-chess.mjs [user] [out]
 *
 * FAILS SOFT — see scripts/fetch-github.mjs for the reasoning. A stale rating
 * is not worth a red deploy.
 */

import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const USER = (process.argv[2] || "andrewparkerh").toLowerCase();
const OUT = resolve(process.argv[3] || "site/data/chess.json");
const RECENT = 10; // games shown on /chess/

const UA = { "User-Agent": "parkerhunt.me-build", Accept: "application/json" };

function bail(reason) {
  console.warn(`WARNING: Chess.com snapshot not refreshed (${reason}).`);
  console.warn(
    existsSync(OUT)
      ? "         Keeping the committed snapshot."
      : "         No snapshot on disk — the chess section will be hidden."
  );
  process.exit(0);
}

async function get(path, ms = 15000) {
  const res = await fetch(`https://api.chess.com/pub/${path}`, {
    headers: UA,
    signal: AbortSignal.timeout(ms),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on /${path}`);
  return res.json();
}

let profile, stats, archives;
try {
  [profile, stats, archives] = await Promise.all([
    get(`player/${USER}`),
    get(`player/${USER}/stats`),
    get(`player/${USER}/games/archives`),
  ]);
} catch (err) {
  bail(err.name === "TimeoutError" ? "request timed out" : err.message);
}

/* Chess.com keys these chess_rapid / chess_blitz / chess_bullet / chess_daily.
   Order here is the order they render in, which is fastest-last on purpose:
   rapid is the one actually played, so it leads. */
const MODES = [
  ["chess_rapid", "Rapid", "10 min"],
  ["chess_blitz", "Blitz", "3–5 min"],
  ["chess_bullet", "Bullet", "1–2 min"],
  ["chess_daily", "Daily", "correspondence"],
];

const modes = [];
for (const [key, label, tempo] of MODES) {
  const m = stats?.[key];
  if (!m?.last?.rating) continue;
  const rec = m.record || { win: 0, loss: 0, draw: 0 };
  const total = rec.win + rec.loss + rec.draw;
  modes.push({
    key: key.replace("chess_", ""),
    label,
    tempo,
    rating: m.last.rating,
    best: m.best?.rating || null,
    best_game: m.best?.game || null,
    win: rec.win,
    loss: rec.loss,
    draw: rec.draw,
    total,
    // Percentages of the whole, so the three widths of the bar sum to 100 and
    // it never leaves a sliver of track showing.
    win_pct: total ? Math.round((rec.win / total) * 100) : 0,
    draw_pct: total ? Math.round((rec.draw / total) * 100) : 0,
    loss_pct: total ? 100 - Math.round((rec.win / total) * 100) - Math.round((rec.draw / total) * 100) : 0,
  });
}

/* The opening comes out of the PGN as a chess.com URL slug, so it arrives
   hyphenated, with the moves glued on the end and every apostrophe stripped:
   "Queens-Pawn-Opening-Levitsky-Attack-2...f6-3.Bf4". Cut at the first move
   number and put the apostrophes back — those names are possessives, and
   "Kings Pawn" reads like a typo. */
const POSSESSIVE = /\b(King|Queen|Bishop|Alekhine|Philidor|Owen|Petrov|Reti|Bird|Grob|Ware|Wayward|Barnes|Clemenz|Anderssen|Nimzowitsch|Damiano|Napoleon|Amar|Saragossa|Mieses|Paulsen|Rousseau|Fool|Scholar|Legal|Blackburne|Charlick|Englund|Elephant|Latvian)s\b/g;

function openingName(pgn) {
  const slug = pgn.match(/\[ECOUrl "https:\/\/www\.chess\.com\/openings\/([^"]+)"\]/)?.[1];
  if (!slug) return "";
  return slug
    .replace(/-/g, " ")
    .split(/\s(?=\d+\.)/)[0]
    .replace(/\s\d+$/, "")
    .replace(POSSESSIVE, "$1's")
    .trim();
}

/* Recent games. Walk archives newest-first until RECENT are collected; a month
   with no games is normal for a casual account, so one archive is not enough. */
const games = [];
const list = (archives?.archives || []).slice().reverse();
for (const url of list.slice(0, 4)) {
  if (games.length >= RECENT) break;
  let month;
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
    if (!res.ok) continue;
    month = await res.json();
  } catch {
    continue;
  }
  for (const g of (month.games || []).slice().reverse()) {
    if (games.length >= RECENT) break;
    const meAsWhite = g.white?.username?.toLowerCase() === USER;
    const me = meAsWhite ? g.white : g.black;
    const them = meAsWhite ? g.black : g.white;
    if (!me || !them) continue;

    // Chess.com puts the verdict on the loser: the winner's `result` is "win"
    // and the loser's spells out how ("checkmated", "timeout", "resigned"). So
    // the way a game ended is always on the other side of the pairing.
    const outcome = me.result === "win" ? "win" : them.result === "win" ? "loss" : "draw";
    const how = outcome === "win" ? them.result : me.result;

    games.push({
      url: g.url,
      when: new Date(g.end_time * 1000).toISOString().slice(0, 10),
      class: g.time_class,
      control: g.time_control,
      rated: !!g.rated,
      colour: meAsWhite ? "white" : "black",
      my_rating: me.rating,
      opponent: them.username,
      opponent_rating: them.rating,
      outcome,
      how,
      moves: ((g.pgn || "").match(/\s\d+\.\s/g) || []).length || null,
      opening: openingName(g.pgn || ""),
    });
  }
}

const record = modes.reduce(
  (a, m) => ({ win: a.win + m.win, loss: a.loss + m.loss, draw: a.draw + m.draw }),
  { win: 0, loss: 0, draw: 0 }
);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      username: profile.username,
      display: profile.username.replace(/^./, (c) => c.toUpperCase()),
      url: profile.url,
      fetched: new Date().toISOString().slice(0, 10),
      joined: new Date(profile.joined * 1000).toISOString().slice(0, 10),
      league: profile.league || "",
      status: profile.status || "",
      followers: profile.followers ?? 0,
      modes,
      record: { ...record, total: record.win + record.loss + record.draw },
      tactics: stats?.tactics?.highest?.rating
        ? { best: stats.tactics.highest.rating, worst: stats.tactics.lowest?.rating || null }
        : null,
      games,
    },
    null,
    2
  ) + "\n"
);

console.log(
  `Chess.com snapshot: ${modes.length} time controls, ` +
    `${record.win + record.loss + record.draw} rated games, ${games.length} recent -> ${OUT}`
);
