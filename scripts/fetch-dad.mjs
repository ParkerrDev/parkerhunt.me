#!/usr/bin/env node
/**
 * Dad's shelf: a list read off DVD cases, turned into a catalogue.
 *
 *   site/data/dad-raw.txt   in   one line per case, exactly as read off the spine
 *   site/data/dad.json      out  resolved, counted, and honest about what failed
 *
 * WHAT MAKES THIS DIFFERENT FROM fetch-titles. That list is typed carefully by
 * one person who knows what they meant. This one was read off several hundred
 * physical cases in one sitting, so it has misspellings ("Amytiville", "the
 * proffesional", "resevioire dogs"), actor names used as disambiguators
 * ("Charelton Heston Call of the wild"), TV shows, box sets, UFC events,
 * History Channel documentaries, and the same film written three different ways
 * on three different shelves. None of that is an error to be cleaned up: it is
 * the record of what is actually in the house, and the raw line is kept beside
 * every result so the two can always be compared.
 *
 * DUPLICATES ARE THE POINT. He owns several copies of some films, which is why
 * the same title appears more than once. They are counted, not collapsed, and
 * the count is shown.
 *
 * OLDER WINS. Asked for explicitly: prefer the original over the remake. So
 * among candidates whose title matches, the earliest release wins, and anything
 * from 2020 on has to clear a much higher bar. That rule is what puts the 1974
 * Death Wish on the shelf rather than the 2018 one, and the 1972 Call of the
 * Wild rather than the 2020 one. Where the raw line carries its own hint (a
 * year, "original", an actor) that hint outranks the rule.
 *
 * EVERY LINE COMES OUT THE OTHER SIDE. A line that resolves to nothing is
 * recorded as unresolved rather than dropped, because "we could not find this
 * one" is information about the shelf and silently losing it is not.
 *
 * Usage:  node scripts/fetch-dad.mjs            resolve only what is unsettled
 *         node scripts/fetch-dad.mjs --all      redo everything
 *
 * Needs TMDB_API_KEY. RUN LOCALLY, COMMIT THE OUTPUT.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const RAW = "site/data/dad-raw.txt";
const OUT = "site/data/dad.json";
const KEY = process.env.TMDB_API_KEY;
const FULL = process.argv.includes("--all");

if (!KEY) {
  console.error("fetch-dad: TMDB_API_KEY is not set. Nothing written.");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- reading -- */

/* Hints the writer left in the line itself. A year, a decade, an actor, or the
   word "original" all say which of several same-named films is meant, and all
   of them beat the prefer-older default. */
const ACTORS = [
  "john cusack", "charelton heston", "charlton heston", "tom cruise", "jim carey", "jim carrey",
  "denzel washington", "mel gibson", "jean-claude van damme", "harrison ford", "clint eastwood",
  "al pachino", "al pacino", "eddie murphy", "tom hanks", "sam elliot", "sam shepard", "john wayne",
  "viggo mortensen", "michael keeton", "ben stiller", "mark wahlberg", "dwayne johnson",
  "robbin williams", "paul newman", "josh brolin", "brain dennehy", "tom serenger", "les stroud",
  "ivan marx", "roy rodgers", "roy radger", "bruce willis", "jack black",
];

const TV_WORDS = /\(\s*tv\s*shows?\s*\)|\(tv show cartoon\)|\(hbo tv show\)/i;

function readLine(raw) {
  const line = raw.trim();
  let t = line;
  const hint = { year: null, decade: null, original: false, actor: null, tv: false, series: null };

  if (TV_WORDS.test(t)) hint.tv = true;
  if (/\bthe movie\b|\(movie\)/i.test(t)) hint.tv = false;

  // parentheticals carry the hints, then come off the search term
  for (const m of [...t.matchAll(/\(([^)]*)\)/g)]) {
    const inner = m[1].toLowerCase();
    if (/^\s*(19|20)\d\d\s*$/.test(inner)) hint.year = +inner.trim();
    else if (/(19|20)\d0s/.test(inner)) hint.decade = inner.match(/((19|20)\d0)s/)[1];
    else if (/\boriginal\b/.test(inner)) hint.original = true;
    else if (/\b60s|70s|80s|90s\b/.test(inner)) hint.decade = { "60s": "1960", "70s": "1970", "80s": "1980", "90s": "1990" }[inner.match(/\d0s/)[0]];
  }
  t = t.replace(/\([^)]*\)/g, " ");

  // a bare trailing year, as in "RAD 1986"
  const yr = t.match(/\b(19[3-9]\d|20[0-2]\d)\b\s*$/);
  if (yr && !hint.year) { hint.year = +yr[1]; t = t.slice(0, yr.index); }

  if (/\boriginal\b/i.test(t)) { hint.original = true; t = t.replace(/\boriginal\b/gi, " "); }

  /* Scanned against the WHOLE line, not the stripped term, because the name is
     usually the parenthetical: "walking tall (dwayne johnson)". Stripping
     parentheticals first threw the hint away and handed that line to the 1973
     original, which is the one film it cannot be. */
  const low = line.toLowerCase();
  for (const a of ACTORS) {
    if (low.includes(a)) { hint.actor = a; t = t.replace(new RegExp(a, "i"), " "); break; }
  }

  t = t
    .replace(/^\*/, "")                    // *batteries not included
    .replace(/\bTV Shows?\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:,-]+|[\s:,-]+$/g, "")
    .trim();

  return { line, term: t, hint };
}

/* WHAT THE CASE SAYS vs WHAT THE FILM IS CALLED.
   These lines were read off spines by eye and typed by hand, so a good third of
   the misses are spelling ("resevioire dogs"), a shortened title that shares no
   words with the real one ("benjamin button"), or one case holding two films
   ("Cadillac Man The Couch Trip"). None of that is a search problem: TMDb has
   every one of these, it just cannot be asked for them in the words written.

   So this is a reading, not a rename. The entry keeps the written line as
   `raw`, searches on the value here, and still gets flagged `renamed` against
   what was written, which is the whole point: the differences stay visible
   rather than being quietly smoothed over.

   An array means one case, several films. Everything NOT in here and still
   unresolved is in the honest can't-find bucket, and it is mostly History
   Channel documentaries, UFC event discs, sniper and rodeo and skate videos:
   things that were sold on DVD and were never in a film database. */
const ALIASES = {
  "spiderman 1-3": ["Spider-Man (2002)", "Spider-Man 2 (2004)", "Spider-Man 3 (2007)"],
  "187": "One Eight Seven (1997)",
  "gladiator": "Gladiator (2000)",
  "vacation": "National Lampoon's Vacation (1983)",
  "tiffanys": "Breakfast at Tiffany's (1961)",

  /* null means DO NOT GUESS. Loosening near() made the resolver willing to
     answer "ski world" with Jet Ski World Series, which is not the tape on the
     shelf. One line is cheaper to except than a score floor is to live with:
     the floor that would have caught this also threw away eighteen correct
     matches, every UFC event disc and most of the documentaries among them. */
  "ski world": null,
  "rambo ii": "Rambo: First Blood Part II (1985)",
  "star wars v": "The Empire Strikes Back (1980)",
  "thunder heart": "Thunderheart (1992)",
  /* THE OTHER SIDE OF THE CONTAINMENT RULE. Matching a run of words anywhere in
     a title is what reaches National Lampoon's Vacation from "Vacation" and
     WWE WrestleMania III from "wrestlemania 3". It also reaches Night Train to
     Munich from "munich" and No More Kitchen Sopranos from "sopranos", and
     nothing in a score can tell those two groups apart: the difference is that
     "National Lampoon's" is a brand and "Night Train to" is the rest of a
     sentence. Every risky containment match was listed and read; these are the
     ones that were wrong. */
  "star wars iv": "Star Wars (1977)",
  "star wars vi": "Return of the Jedi (1983)",
  "the entourage (tv show)": "Entourage (tv show)",
  "breach": "Breach (2007)",
  "sniper": "Sniper (1993)",
  "munich": "Munich (2005)",
  "sopranos": "The Sopranos (tv show)",
  "the pacific": "The Pacific (tv show)",
  "generation kill": "Generation Kill (tv show)",
  "the cooler": "The Cooler (2003)",
  "the hunted": "The Hunted (2003)",
  "the hunter": "The Hunter (1980)",
  "walk the line": "Walk the Line (2005)",
  "sleepy hollow": "Sleepy Hollow (1999)",
  "seabiscuit": "Seabiscuit (2003)",
  "behind enemy lines": "Behind Enemy Lines (2001)",
  "the matador": "The Matador (2005)",
  "under suspicion": "Under Suspicion (2000)",
  "the walker": "The Walker (2007)",
  "lincoln": "Lincoln (2012)",
  "superman i": "Superman (1978)",
  "the search for (bone brigade video 3)": "The Search for Animal Chin (1987)",
  "biography": null,
  "afghanistan": null,

  "police academy 3 & 4": ["Police Academy 3: Back in Training (1986)", "Police Academy 4: Citizens on Patrol (1987)"],
  "cadillac man the couch trip": ["Cadillac Man (1990)", "The Couch Trip (1988)"],
  "west of memphis training day": ["West of Memphis (2012)", "Training Day (2001)"],
  "night at the museum 1-3": ["Night at the Museum (2006)", "Night at the Museum: Battle of the Smithsonian (2009)", "Night at the Museum: Secret of the Tomb (2014)"],

  "neil simon's seems like old times": "Seems Like Old Times (1980)",
  "he-man (tv show)": "He-Man and the Masters of the Universe (tv show)",
  "street survivors": "Street Survivors: The True Story of the Lynyrd Skynyrd Plane Crash (2020)",
  "the valachie papers": "The Valachi Papers (1972)",
  "stephen kings it": "It (1990) (tv show)",
  "poltergeist 2": "Poltergeist II: The Other Side (1986)",
  "the amytiville horror": "The Amityville Horror (1979)",
  "the excorcist": "The Exorcist (1973)",
  "anchorman": "Anchorman: The Legend of Ron Burgundy (2004)",
  "stasky and hutch": "Starsky & Hutch",
  "talladega nights": "Talladega Nights: The Ballad of Ricky Bobby (2006)",
  "borat": "Borat: Cultural Learnings of America for Make Benefit Glorious Nation of Kazakhstan (2006)",
  "heart breakers": "Heartbreakers (2001)",
  "jerry seinfeld": "Jerry Seinfeld: I'm Telling You for the Last Time (1998)",
  "city slickers 2": "City Slickers II: The Legend of Curly's Gold (1994)",
  "harley davidson and the marlbord man": "Harley Davidson and the Marlboro Man (1991)",
  "jean-claude van damme kickeroxer": "Kickboxer (1989)",
  "philedelphia": "Philadelphia (1993)",
  "pelham 123": "The Taking of Pelham One Two Three (1974)",
  "dragon - the brave lee story": "Dragon: The Bruce Lee Story (1993)",
  "the falcon and the snowmen": "The Falcon and the Snowman (1985)",
  "born on the 4th of july": "Born on the Fourth of July (1989)",
  "theres something about marry": "There's Something About Mary (1998)",
  "indiana jones raiders of the lost ark": "Raiders of the Lost Ark (1981)",
  "resevioire dogs": "Reservoir Dogs (1992)",
  "resevoire dogs": "Reservoir Dogs (1992)",
  "resevoir dogs": "Reservoir Dogs (1992)",
  "the proffesional": "Leon: The Professional (1994)",
  "leon the proffesional": "Leon: The Professional (1994)",
  "the newton brothers": "The Newton Boys (1998)",
  "butch cassedy and the sundance kid": "Butch Cassidy and the Sundance Kid (1969)",
  "butch cassady and the sundance kid": "Butch Cassidy and the Sundance Kid (1969)",
  "the roudners": "Rounders (1998)",
  "i love you philip morris": "I Love You Phillip Morris (2009)",
  "man hunt for claude dallas": "Manhunt for Claude Dallas (1986)",
  "dirty marry crazy larry": "Dirty Mary Crazy Larry (1974)",
  "al pachino in dog day afternoon": "Dog Day Afternoon (1975)",
  "cc and co": "C.C. and Company (1970)",
  "angel unchanted": "Angel Unchained (1970)",
  "tom jane is strander": "Stander (2003)",
  "sunsine superman": "Sunshine Superman (2015)",
  "the proffesionals": "The Professionals (1966)",
  "macennas gold": "Mackenna's Gold (1969)",
  "james a micheners texas": "Texas (1994)",
  "down in the valey": "Down in the Valley (2005)",
  "sam shepard the blackthorn": "Blackthorn (2011)",
  "rustlers rapsody": "Rustlers' Rhapsody (1985)",
  "sam elliot molly and the lawless john": "Molly and Lawless John (1972)",
  "a fistfull of dollars": "A Fistful of Dollars (1964)",
  "the assasination of jesse james": "The Assassination of Jesse James by the Coward Robert Ford (2007)",
  "man from larrameigh": "The Man from Laramie (1955)",
  "fast time at ridemont high": "Fast Times at Ridgemont High (1982)",
  "two mules for sister sarah": "Two Mules for Sister Sara (1970)",
  "three amgos": "Three Amigos (1986)",
  "the princess and the bride": "The Princess Bride (1987)",
  "arthur 2": "Arthur 2: On the Rocks (1988)",
  "dirt dancing": "Dirty Dancing (1987)",
  "the pledege": "The Pledge (2001)",
  "touch the void": "Touching the Void (2003)",
  "flash dnace": "Flashdance (1983)",
  "42 the jackie robinson story": "42 (2013)",
  "superman 4": "Superman IV: The Quest for Peace (1987)",
  "the jackel": "The Jackal (1997)",
  "assasination tango": "Assassination Tango (2002)",
  "the machurian candidate": "The Manchurian Candidate (1962)",
  "the bourne ultimtum": "The Bourne Ultimatum (2007)",
  "10th and the wolf": "10th & Wolf (2006)",
  "the donne brasco story": "Donnie Brasco (1997)",
  "the human monster": "The Dark Eyes of London (1939)",
  "brooklyn gorilla": "Bela Lugosi Meets a Brooklyn Gorilla (1952)",
  "hari to an execution": "Heir to an Execution (2004)",
  "a beutiful mind": "A Beautiful Mind (2001)",
  "the dukes to hazard (tv show)": "The Dukes of Hazzard (tv show)",
  "discovery: i shouldn't be alive les stroud african survival (survivorman)": "I Shouldn't Be Alive (tv show)",
  "the first 48 tv show dallas and miami": "The First 48 (tv show)",
  "the huducker proxy": "The Hudsucker Proxy (1994)",
  "the flight of the pheonix": "The Flight of the Phoenix (1965)",
  "sings": "Signs (2002)",
  "jackass number two unrated": "Jackass Number Two (2006)",
  "bone brigade video show": "The Bones Brigade Video Show (1984)",
  "ban this bone brigades video six": "Ban This (1989)",
  "the story of jim jones guyana tragedy": "Guyana Tragedy: The Story of Jim Jones (1980)",
  "blood in blood out": "Bound by Honor (1993)",
  "the gaurdian": "The Guardian (2006)",
  "moth man prophecies": "The Mothman Prophecies (2002)",
  "from the creator of law and order: twin towers": "Twin Towers (2003)",
  "honkey tonk man": "Honkytonk Man (1982)",
  "in memorium new york city": "In Memoriam: New York City (2002)",
  "master and commander": "Master and Commander: The Far Side of the World (2003)",
  "tracis the true story of travis walton": "Travis: The True Story of Travis Walton (2015)",
  "carivale (tv show)": "Carnivale (tv show)",
  "the naked gun 2": "The Naked Gun 2 1/2: The Smell of Fear (1991)",
  "and officer and a gentlemen": "An Officer and a Gentleman (1982)",
  "we where soliders": "We Were Soldiers (2002)",
  "hears war": "Hart's War (2002)",
  "pearl harbot": "Pearl Harbor (2001)",
  "flags of the fathers": "Flags of Our Fathers (2006)",
  "moneky on my back": "Monkey on My Back (1957)",
  "the bridge on the ricer kwai": "The Bridge on the River Kwai (1957)",
  "missin in action 2": "Missing in Action 2: The Beginning (1985)",
  "combat diary the marines of ima company": "Combat Diary: The Marines of Lima Company (2006)",
  "battle for haditha a rich broomfield film": "Battle for Haditha (2007)",
  "the crusage in the pacific": "Crusade in the Pacific (tv show)",
  "the great st lous bank robbery": "The Great St. Louis Bank Robbery (1959)",
  "the man nobody knew": "The Man Nobody Knew (2011)",
  "thelma and louisse": "Thelma & Louise (1991)",
  "the encforcer (dirty harry) clint eastwood": "The Enforcer (1976)",
  "cinderlla man": "Cinderella Man (2005)",
  "six degrees of seperation": "Six Degrees of Separation (1993)",
  "failed green tomatoes": "Fried Green Tomatoes (1991)",
  "now way out": "No Way Out (1987)",
  "dr. no 007": "Dr. No (1962)",
  "tinker tailor solider spy": "Tinker Tailor Soldier Spy (2011)",
  "ocotopussy": "Octopussy (1983)",
  "willy wonka and the choclate factory": "Willy Wonka & the Chocolate Factory (1971)",
  "riising sun": "Rising Sun (1993)",
  "seven": "Se7en (1995)",
  "sienfeld (tv show)": "Seinfeld (tv show)",
  "kill bill": "Kill Bill: Vol. 1 (2003)",
  "hitler and then the bigfoot": "The Man Who Killed Hitler and Then the Bigfoot (2018)",
  "benjamin button": "The Curious Case of Benjamin Button (2008)",
  "againts all odds": "Against All Odds (1984)",
  "rumper stomper": "Romper Stomper (1992)",
  "romperstomper": "Romper Stomper (1992)",
  "american beuty": "American Beauty (1999)",
  "cop and a half": "Cop and a Half (1993)",
  "pirates of the caribean": "Pirates of the Caribbean: The Curse of the Black Pearl (2003)",
  "second hand lions": "Secondhand Lions (2003)",
  "tyson documentary": "Tyson (2008)",
  "cassablanca": "Casablanca (1942)",
  "the mutlys falcon": "The Maltese Falcon (1941)",
  "gross point blank": "Grosse Pointe Blank (1997)",
  "end of the spear documentary": "End of the Spear (2005)",
  "spring time in the rockies": "Springtime in the Rockies",
  "young bill hickock": "Young Bill Hickok (1940)",
  "oceans 11": "Ocean's Eleven",
  "the deadpool": "The Dead Pool (1988)",
  "doctor strangelove": "Dr. Strangelove (1964)",
  "a glimpse of hell: 1989 uss iowa explosion": "A Glimpse of Hell (2001)",
  "the seawolves": "The Sea Wolves (1980)",
  "stolen honor: john kerry testimony": "Stolen Honor: Wounds That Never Heal (2004)",
  "the seige at ruby ridge": "The Siege at Ruby Ridge (1996)",
  "the unibomber": "Unabomber: The True Story (1996)",
  "steve mcqueen wanted dead or alive": "Wanted: Dead or Alive (tv show)",
};

/* Box sets and ranges: one case, several films. Expanded so each film is
   findable, with a note saying which line they came from. */
function expand({ line, term, hint }) {
  const out = [];
  const push = (t, note) => out.push({ line, term: t, hint, from: note });

  let m;
  if ((m = term.match(/^(.*?)\s*(\d+)\s*(?:&|and)\s*(\d+)\s*$/))) {
    push(`${m[1]} ${m[2]}`, "box set"); push(`${m[1]} ${m[3]}`, "box set"); return out;
  }
  if ((m = term.match(/^(.*?)\s*(\d+)\s*-\s*(\d+)\s*$/)) && +m[3] - +m[2] <= 5) {
    for (let i = +m[2]; i <= +m[3]; i++) push(`${m[1]} ${i}`, "box set");
    return out;
  }
  if (/all three/i.test(line)) { push(term, "box set, all three"); return out; }
  push(term, null);
  return out;
}

/* ------------------------------------------------------------- resolution -- */

/* A NUMBER SPELLED OUT IS THE SAME NUMBER. The cases are written with digits
   and the films are not: "12 monkeys" has to reach Twelve Monkeys, which it did
   not, and the only thing on TMDb actually called "12 Monkeys" is the 2015
   television series, so the shelf got the series. Folded both ways to digits. */
const NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};
const ROMAN = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

const norm = (s) =>
  s.toLowerCase()
    .replace(/&/g, "and")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (NUMBERS[w] != null ? String(NUMBERS[w]) : ROMAN[w] != null ? String(ROMAN[w]) : w))
    .join(" ");

/** Levenshtein, capped: the raw lines are full of typos, so an exact string
 *  comparison would reject most of the shelf. */
function near(a, b) {
  a = norm(a); b = norm(b);
  if (a === b) return 1;

  /* A SUBTITLE IS NOT A DIFFERENT FILM. Cases get written with the short name,
     so "the naked gun" has to reach "The Naked Gun: From the Files of Police
     Squad!" and "talladega nights" has to reach its ballad. The length guard
     below rejects both outright, which is how the shelf's Naked Gun ended up
     being the 2025 one: the only candidate whose title matched was the remake,
     because the remake is the one with no subtitle. Scored just under an exact
     match and tapered by how far the two run apart, so a real exact match, if
     there is one, still wins. */
  const [sh, lg] = a.length <= b.length ? [a, b] : [b, a];
  if (sh.length >= 6 && (lg.startsWith(sh + " ") || lg.endsWith(" " + sh) || lg.includes(" " + sh + " ")))
    return 0.97 + 0.02 * (sh.length / lg.length);

  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 6) return 0;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[m][n] / Math.max(m, n);
}

async function tmdb(path, params) {
  const u = new URL(`https://api.themoviedb.org/3${path}`);
  u.searchParams.set("api_key", KEY);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  for (let a = 0; a < 4; a++) {
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(20000) });
      if (res.status === 429) { await sleep(1500 * (a + 1)); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (a === 3) throw err;
      await sleep(800 * (a + 1));
    }
  }
}

const yearOf = (c) => {
  const d = c.release_date || c.first_air_date || "";
  return d ? +d.slice(0, 4) : null;
};
const titleOf = (c) => c.title || c.name || "";

function score(c, term, hint, cast) {
  const y = yearOf(c);
  const sim = Math.max(near(titleOf(c), term), near(c.original_title || c.original_name || "", term));
  if (sim < 0.62) return -1e6;

  let s = sim * 100;

  /* THE WRITTEN TITLE BEING *IN* THE FILM'S TITLE BEATS BEING NEAR IT, and by
     more than the age slope can make up. Two failures, one rule. Without it
     "the naked gun" resolved to The Naked Sun (1958), one letter off but thirty
     years older, and thirty years outweighed the letter. And 0.96 rather than
     an exact match, because "vacation" went to the 2015 film over National
     Lampoon's Vacation: the 2015 title matches to the letter, while the 1983
     one merely contains what the case says, and containing it is the stronger
     signal of the two. near() keeps those apart, scoring a whole-word run above
     anything edit distance can reach. */
  if (sim >= 0.96) s += 45;

  /* OLDER WINS, BUT ONLY BACK TO ABOUT 1936. Half a point per year is a strong
     preference, which is what was asked for, and it was strong enough to hand
     65 films to silent-era shorts that happen to share a title: Braveheart
     (1925), The Sixth Sense (1929), Rango (1931), National Treasure (1927).
     Clamping the reward window ends that, without weakening the preference
     anywhere it does real work (a 1974 original over a 2018 remake). */
  const yc = Math.max(1936, Math.min(y || 2000, 2000));
  if (y) s += (2000 - yc) * 0.5;
  if (y && y < 1936) s -= (1936 - y) * 1.5;

  // "definitely probably not anything from the 2020's or anything past 2015"
  if (y && y >= 2020) s -= 55;
  else if (y && y > 2015) s -= 22;

  /* OBSCURITY. These are films somebody bought on a disc, so a same-titled
     entry with four ratings on it is not the one meant, whatever its year.
     This is the other half of the silent-shorts fix and it also settles
     "oceans 11", where an unwatched 2013 film shares the exact written title
     with Ocean's Eleven. */
  /* Heavy enough to outweigh the whole age bonus, which is the point: a film
     with under ten ratings on it competing against a film with thousands is not
     a close call, whatever their years are. "13 hours" went to 13 Hours by Air
     (1936, six ratings) at a smaller penalty. Where the obscure film is the
     ONLY candidate, this costs nothing: scoring is relative. */
  const votes = c.vote_count || 0;
  if (votes < 10) s -= 70;
  else if (votes < 40) s -= 20;
  else s += 3;

  // hints in the raw line outrank the default
  if (hint.year && y) s += Math.abs(y - hint.year) <= 1 ? 60 : -35;
  if (hint.decade && y) s += String(y).slice(0, 3) === String(hint.decade).slice(0, 3) ? 40 : -12;
  if (hint.original && y) s += (1990 - y) * 0.4;
  // Whoever is in it settles the version, and settles it harder than age does:
  // "walking tall (dwayne johnson)" is the 2004 one no matter what the rule
  // about older films says.
  if (cast && cast.has(c.id)) s += 70;

  // popularity only as a tie-break, never as the argument
  s += Math.min(6, (c.popularity || 0) / 12);
  return s;
}

/* An actor named on the case, turned into the set of things they are in. Two
 * calls per name, cached, and there are about thirty names in all. */
const castOf = new Map();
async function creditsFor(name) {
  if (castOf.has(name)) return castOf.get(name);
  let ids = null;
  try {
    const p = (await tmdb("/search/person", { query: name }))?.results?.[0];
    if (p) {
      const cr = await tmdb(`/person/${p.id}/combined_credits`, {});
      ids = new Set((cr?.cast || []).map((c) => c.id));
    }
  } catch {}
  castOf.set(name, ids);
  return ids;
}

async function resolve({ term, hint }) {
  if (!term || term.length < 2) return { status: "unresolved", why: "nothing to search for" };

  const kinds = hint.tv ? ["tv", "movie"] : ["movie", "tv"];
  let pool = [];
  for (const kind of kinds) {
    const r = await tmdb(`/search/${kind}`, { query: term, include_adult: false });
    for (const c of (r?.results || []).slice(0, 12)) pool.push({ ...c, kind });
    if (pool.length && kind === kinds[0] && pool.some((c) => near(titleOf(c), term) > 0.9)) break;
    await sleep(90);
  }
  if (!pool.length) return { status: "unresolved", why: "no TMDb result" };

  const cast = hint.actor ? await creditsFor(hint.actor) : null;
  const ranked = pool
    .map((c) => ({ c, s: score(c, term, hint, cast) }))
    .filter((x) => x.s > -1e5)
    .sort((a, b) => b.s - a.s);
  if (!ranked.length) return { status: "unresolved", why: "nothing matched the title closely enough" };

  const best = ranked[0].c;
  // Other releases sharing this title: the thing worth flagging, because it is
  // where "prefer the older one" actually made a choice.
  /* A REAL ALTERNATIVE, not merely a same-titled row. Without the vote floor
     this said things like "Rocky, also 1948, 2008, 2017": all three exist and
     none of them is a film anybody has to be warned about. What is worth
     showing is where a choice was actually made between films somebody might
     own, which is the 1974 Death Wish against the 2018 one. */
  const alts = ranked
    .slice(1)
    .filter((x) => near(titleOf(x.c), titleOf(best)) > 0.86 && yearOf(x.c) && yearOf(x.c) !== yearOf(best))
    .filter((x) => (x.c.vote_count || 0) >= 50)
    .map((x) => ({ title: titleOf(x.c), year: yearOf(x.c), kind: x.c.kind }))
    .slice(0, 3);

  return {
    status: "found",
    kind: best.kind,
    title: titleOf(best),
    year: yearOf(best),
    tmdb: best.id,
    poster: best.poster_path ? `https://image.tmdb.org/t/p/w342${best.poster_path}` : null,
    rating: best.vote_average ? Math.round(best.vote_average * 10) / 10 : null,
    overview: (best.overview || "").slice(0, 240) || null,
    alts,
  };
}

/* ------------------------------------------------------------------- main -- */

const lines = readFileSync(RAW, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);

// group by what was written, so several copies of one case count as several
const byLine = new Map();
for (const raw of lines) {
  const k = raw.toLowerCase();
  if (!byLine.has(k)) byLine.set(k, { raw, copies: 0 });
  byLine.get(k).copies++;
}

let settled = {};
if (!FULL && existsSync(OUT)) {
  try {
    for (const e of JSON.parse(readFileSync(OUT, "utf8")).entries || [])
      if (e.status === "found") settled[e.raw.toLowerCase()] = e;
  } catch {}
}

const entries = [];
let done = 0, reused = 0, found = 0, unresolved = 0;

for (const [key, { raw, copies }] of byLine) {
  done++;
  if (settled[key]) {
    entries.push({ ...settled[key], copies });
    reused++; found++;
    continue;
  }
  // What was written, always kept, and it is what `renamed` is measured against.
  const written = readLine(raw);
  // What it was read as, when the words on the case cannot be searched for.
  const alias = key in ALIASES ? ALIASES[key] : undefined;
  const asked = alias === null ? [] : Array.isArray(alias) ? alias : [alias || raw];
  const parts = asked.flatMap((a) => {
    const p = expand({ ...readLine(a), line: raw });
    return Array.isArray(alias) ? p.map((x) => ({ ...x, from: x.from || "one case, several films" })) : p;
  });
  const parsed = alias && !Array.isArray(alias) ? readLine(alias) : written;
  const results = [];
  for (const part of parts) {
    try { results.push({ part, r: await resolve(part) }); }
    catch (err) { results.push({ part, r: { status: "unresolved", why: err.message } }); }
    await sleep(70);
  }
  const ok = results.filter((x) => x.r.status === "found");
  const entry = {
    raw,
    copies,
    term: written.term,
    hint: Object.fromEntries(Object.entries(parsed.hint).filter(([, v]) => v)),
    status: ok.length ? "found" : "unresolved",
    matches: results.map((x) => ({ searched: x.part.term, from: x.part.from, ...x.r })),
  };
  if (alias) entry.read_as = asked.join(" + ");
  if (!ok.length) entry.why = alias === null ? "not a film" : results[0]?.r?.why || "no match";
  entries.push(entry);
  ok.length ? found++ : unresolved++;

  if (done % 40 === 0) process.stderr.write(`\r  ${done}/${byLine.size} lines, ${found} found, ${unresolved} not`);
}
process.stderr.write("\n");

/* A title is "renamed" when what the case says and what the film is called are
   meaningfully different. Asked for explicitly, and it is the column that
   catches a wrong match as well as a misspelling. */
for (const e of entries) {
  const m = e.matches?.find((x) => x.status === "found");
  if (!m) continue;
  const sim = near(e.term, m.title);
  if (sim < 0.86) { e.renamed = true; e.renamed_to = `${m.title}${m.year ? ` (${m.year})` : ""}`; }
  if (e.matches.some((x) => (x.alts || []).length)) e.multi_year = true;
}

const flat = entries.flatMap((e) => (e.matches || []).filter((m) => m.status === "found").map((m) => ({ ...m, copies: e.copies })));

/* The four things that were asked to be kept track of, each as its own list,
   because a page that only shows what resolved is a page that quietly hides
   everything the resolver got wrong. Built here rather than in the template:
   Tera can sort and filter, but it cannot flatten one array out of another, and
   a box set is one line holding several films. */
const shelf = entries
  .flatMap((e) =>
    (e.matches || [])
      .filter((m) => m.status === "found")
      .map((m) => ({
        title: m.title, year: m.year, kind: m.kind, tmdb: m.tmdb,
        poster: m.poster, rating: m.rating,
        copies: e.copies,
        raw: e.raw,
        // Only worth showing under the title when it is not simply the title.
        written: near(e.term, m.title) < 0.86 ? e.raw : null,
        alts: (m.alts || []).map((a) => a.year).sort(),
        from: m.from,
      }))
  )
  .sort((a, b) => a.title.localeCompare(b.title, "en"));

/* ONE CARD PER FILM, NOT PER LINE. "rumper stomper" and "romperstomper" are two
   cases of Romper Stomper written two different ways, and showing them as two
   cards reads as a bug in the page rather than as two discs on a shelf. Merged
   on the resolved film, copies added together, and both written lines kept so
   the card can still say what the cases said. */
const byFilm = new Map();
for (const f of shelf) {
  const k = `${f.kind}:${f.tmdb}`;
  const seen = byFilm.get(k);
  if (!seen) { byFilm.set(k, { ...f, raws: [f.raw] }); continue; }
  seen.copies += f.copies;
  seen.raws.push(f.raw);
  if (!seen.written && f.written) seen.written = f.written;
}
const merged = [...byFilm.values()].map((f) => ({ ...f, raw: f.raws.join(" / ") }));

/* Counted on the FILM, not on the written line, and the difference is real:
   "against all odds" and "againts all odds" are two discs of one film, and
   counting the lines would call them one disc each. Lines that resolved to
   nothing keep their own count, since there is no film to merge them onto. */
const owned_twice = [
  ...merged
    .filter((f) => f.copies > 1)
    .map((f) => ({ raw: f.raws.join(" / "), copies: f.copies, as: `${f.title}${f.year ? ` (${f.year})` : ""}` })),
  ...entries
    .filter((e) => e.status !== "found" && e.copies > 1)
    .map((e) => ({ raw: e.raw, copies: e.copies, as: null })),
].sort((a, b) => b.copies - a.copies || a.raw.localeCompare(b.raw, "en"));

const misread = entries
  .filter((e) => e.renamed)
  .map((e) => ({ raw: e.raw, as: (e.matches || []).filter((m) => m.status === "found").map((m) => `${m.title}${m.year ? ` (${m.year})` : ""}`).join(" + ") }))
  .sort((a, b) => a.raw.localeCompare(b.raw, "en"));

const versions = shelf
  .filter((s) => s.alts.length)
  .map((s) => ({ title: s.title, chose: s.year, others: s.alts, raw: s.raw }))
  .sort((a, b) => a.title.localeCompare(b.title, "en"));

const missing = entries
  .filter((e) => e.status !== "found")
  .map((e) => ({ raw: e.raw, copies: e.copies, why: e.why }))
  .sort((a, b) => a.raw.localeCompare(b.raw, "en"));
const out = {
  fetched: new Date().toISOString().slice(0, 10),
  source: "read off the DVD cases",
  lines: lines.length,
  distinct: byLine.size,
  found: entries.filter((e) => e.status === "found").length,
  unresolved: entries.filter((e) => e.status !== "found").length,
  renamed: entries.filter((e) => e.renamed).length,
  multi_year: entries.filter((e) => e.multi_year).length,
  copies_total: entries.reduce((n, e) => n + e.copies, 0),
  duplicated: owned_twice.length,
  films: flat.filter((m) => m.kind === "movie").length,
  tv: flat.filter((m) => m.kind === "tv").length,
  with_poster: flat.filter((m) => m.poster).length,
  shelf: merged,
  owned_twice,
  misread,
  versions,
  missing,
  entries,
};
writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");

console.log(
  `Dad: ${out.lines} lines, ${out.distinct} distinct, ${out.found} found, ${out.unresolved} not found\n` +
  `     ${out.duplicated} owned more than once, ${out.renamed} whose title differs, ${out.multi_year} with other years\n` +
  `     ${reused} reused from the last run -> ${OUT}`
);
