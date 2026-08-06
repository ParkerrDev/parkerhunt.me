#!/usr/bin/env node
/**
 * Shuffle the three lists that have no natural order.
 *
 *   site/data/titles.json   in place — `shows` and `movies` reordered
 *   site/data/quotes.json   out      — the quotes out of me.toml, reordered
 *
 * WHY THIS IS A SCRIPT AND NOT A TEMPLATE FILTER
 *
 * Tera has `sort`, `slice`, `filter` and `reverse`. It has nothing that
 * randomises, and it cannot — a template is a pure function of its data, which
 * is the property that makes the build reproducible. So the randomness has to
 * happen to the data, before the template ever sees it.
 *
 * WHAT "RANDOM" MEANS HERE
 *
 * A new order per BUILD, not per visitor. Nobody's browser runs anything; the
 * page is still one static file. With the three-hourly refresh in
 * .github/workflows/refresh.yml that works out to a different wall of quotes
 * eight times a day, which is the point of the request — a list of 92 films
 * whose first row is always the same 46 films may as well be 46 films.
 *
 * IT MUTATES A COMMITTED FILE. That is deliberate and it is how every fetcher
 * here already behaves: on Cloudflare the checkout is a throwaway, so the
 * shuffle applies to that build and nothing is written back to git. Running it
 * locally reorders site/data/titles.json for real, which shows up as a large
 * and completely meaningless diff — so do not run it locally unless you want to
 * preview, and do not be alarmed by the diff if you do.
 *
 * WHY QUOTES GET THEIR OWN FILE INSTEAD
 *
 * They live in me.toml, which is hand-written and must stay that way. Rewriting
 * somebody's authored file on every build to shuffle it would be rude and would
 * churn git forever. So me.toml stays the source, and this derives a shuffled
 * copy into quotes.json which the templates read. Edit me.toml; never edit
 * quotes.json.
 *
 * Usage:  node scripts/build-shuffle.mjs [titles.json] [me.toml] [quotes.json]
 *
 * FAILS SOFT. A shuffle that does not happen is a page in its old order, which
 * is not a reason to fail a deploy.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const TITLES = resolve(process.argv[2] || "site/data/titles.json");
const ME = resolve(process.argv[3] || "site/data/me.toml");
const QUOTES = resolve(process.argv[4] || "site/data/quotes.json");

/* Fisher–Yates. The obvious `sort(() => Math.random() - 0.5)` is not a shuffle:
   it is biased, and how biased depends on the engine's sort. */
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let shows = 0, movies = 0;
try {
  if (existsSync(TITLES)) {
    const t = JSON.parse(readFileSync(TITLES, "utf8"));
    if (Array.isArray(t.shows)) { shuffle(t.shows); shows = t.shows.length; }
    if (Array.isArray(t.movies)) { shuffle(t.movies); movies = t.movies.length; }
    t.shuffled = new Date().toISOString();
    writeFileSync(TITLES, JSON.stringify(t, null, 2) + "\n");
  }
} catch (err) {
  console.warn(`WARNING: titles not shuffled (${err.message}).`);
}

/* A deliberately small TOML reader: enough for arrays of tables whose values
   are single-line double-quoted strings, which is all [[quotes]] has ever been.
   Node ships no TOML parser and this file is not worth a dependency — but if
   a quote ever needs a multi-line string, this is the thing that will quietly
   drop it, so the count is asserted below. */
function arrayOfTables(toml, name) {
  const out = [];
  const re = new RegExp(`^\\[\\[${name}\\]\\]\\s*$`, "gm");
  let m;
  while ((m = re.exec(toml))) {
    const start = m.index + m[0].length;
    // The block ends at the next table header of any kind.
    const next = toml.slice(start).search(/^\s*\[/m);
    const body = next === -1 ? toml.slice(start) : toml.slice(start, start + next);
    const row = {};
    for (const line of body.split("\n")) {
      const kv = line.match(/^\s*([A-Za-z_][\w-]*)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/);
      if (kv) row[kv[1]] = kv[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    if (Object.keys(row).length) out.push(row);
  }
  return out;
}

let quoted = 0, mine = 0;
try {
  const toml = readFileSync(ME, "utf8");
  const borrowed = arrayOfTables(toml, "quotes");
  const my = arrayOfTables(toml, "my_quotes");

  /* If the parser above ever silently loses one, this is where it shows up
     rather than three months later on a page with a quote missing. */
  const declared = (toml.match(/^\[\[quotes\]\]\s*$/gm) || []).length;
  if (borrowed.length !== declared) {
    throw new Error(`parsed ${borrowed.length} of ${declared} [[quotes]] — a value is not a single-line string`);
  }

  shuffle(borrowed);
  quoted = borrowed.length;
  mine = my.length;

  mkdirSync(dirname(QUOTES), { recursive: true });
  writeFileSync(
    QUOTES,
    JSON.stringify(
      {
        built: new Date().toISOString().slice(0, 10),
        note: "GENERATED from site/data/me.toml by scripts/build-shuffle.mjs. Edit me.toml, not this.",
        count: borrowed.length,
        mine_count: my.length,
        // Mine stay in the order they were written. There are two of them and
        // they are the author's own; shuffling that is noise, not variety.
        mine: my,
        quotes: borrowed,
      },
      null,
      2
    ) + "\n"
  );
} catch (err) {
  console.warn(`WARNING: quotes not shuffled (${err.message}).`);
  if (!existsSync(QUOTES)) console.warn("         No quotes.json on disk — the quote sections will be empty.");
}

console.log(`Shuffled: ${shows} shows, ${movies} films, ${quoted} quotes (+${mine} mine, unshuffled)`);
