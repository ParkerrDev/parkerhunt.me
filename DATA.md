# The account snapshots

Five sections of this site show live data from accounts that live somewhere
else — GitHub, Steam, Chess.com, Duolingo and Nexus Mods. None of them is an
embed, a widget or a client-side fetch. Each one is a JSON file in
`site/data/`, written at build time by a script in `scripts/`, and rendered by
Zola into static HTML.

The rule the whole design serves: **a visitor's browser never contacts a third
party.** Not for the numbers, not for the prices, not even for the game art.
That is why `/games/` can show 89 Steam capsules without a single request to a
Steam CDN, and why none of these sections can be used to track anyone.

```
scripts/fetch-*.mjs ──► site/data/*.json ──► templates ──► public/*.html
   (build time)            (committed)         (Zola)       (static)
```

## The scripts

| Script | Reads | Writes | Auth |
|---|---|---|---|
| `fetch-github.mjs` | `api.github.com` | `site/data/github.json` | none |
| `fetch-steam.mjs` | `store.steampowered.com` + `site/data/steam-seed.json` | `site/data/steam.json` | none |
| `fetch-chess.mjs` | `api.chess.com/pub` | `site/data/chess.json` | none |
| `fetch-duolingo.mjs` | `duolingo.com/2017-06-30/users` | `site/data/duolingo.json` | none |
| `fetch-nexus.mjs` | `api-router.nexusmods.com/graphql` | `site/data/nexus.json` + `site/static/imgs/nexus/avatar-*.webp` | none |
| `fetch-steam-art.mjs` | `steam.json` + Steam CDN | `site/static/imgs/steam/*.webp` | none, **local only** |
| `build-stamps.mjs` | nothing — arithmetic | `site/data/stamps.json` | n/a |
| `fetch-media.mjs` | Wikimedia Commons + Open Library | `site/static/imgs/media/*.webp` + `site/data/media.json` | none, **local only** |
| `build-map.mjs` | Wikimedia Commons + `site/data/travel.json` | `site/static/imgs/us-visited.svg` + `site/data/travel-map.json` | none, **local only** |
| `fetch-icons.mjs` | Simple Icons | `site/data/icons.json` | none |
| `fetch-logos.mjs` | Wikimedia Commons | `site/static/imgs/logos/*.webp` + `site/data/logos.json` | none, **local only** |
| `fetch-titles.mjs` | Wikidata + Commons + `site/data/watching.json` | `site/data/titles.json` + `site/static/imgs/titles/*.webp` | none, **local only** |
| `fetch-posters.mjs` | TMDb | merges posters into `site/data/titles.json` | **needs `TMDB_API_KEY`**, local only |
| `fetch-places.mjs` | Wikidata + Commons + `site/data/places.json` | `site/data/been.json` + `site/static/imgs/been/*.webp` | none, **local only** |

All five fetchers run from `build-zola.sh` on every Cloudflare deploy. No API
key, no token, no cookie: every endpoint above answers unauthenticated.

`build-stamps.mjs` is the odd one out: it touches no network. It exists because
"9 years, 9 months and 17 days on X" is a lovely thing to put on a page and a
terrible thing to hardcode — it decays daily. The anchor *date* is stored and
the elapsed years/months/days are derived on every deploy, with real calendar
arithmetic and pinned to America/Los_Angeles so the builder's own timezone
cannot shift the answer by a day.

## They all fail soft, on purpose

Every fetcher exits **0** when its API is unreachable, rate limited, or has
quietly changed shape. It warns, leaves the committed snapshot exactly as it is,
and the build carries on.

This is deliberate and it is the opposite of `scripts/build-resume.mjs`, which
fails hard. The difference is what a failure would actually cost:

- A missing résumé PDF is a **broken page** — a link to nothing. Fail the deploy.
- A week-old chess rating is a **slightly stale number** nobody will notice.
  Failing a deploy over it would take the whole site down to avoid being wrong
  about a blitz rating by four points.

The rate limits are real, too. GitHub allows 60 unauthenticated requests an hour
per IP; Steam's store API is roughly 200 per five minutes; and Cloudflare's build
machines share addresses with every other project building at that moment.

The consequence to remember: **the snapshots are committed to git and are the
source of truth for a build.** If a fetch fails, the site renders the last good
copy. Delete a snapshot and the section it feeds disappears rather than breaking.

## Steam is the odd one

The Steam profile is **private** (`privacyState=private` on the public profile
XML), so `IPlayerService/GetOwnedGames`, `IWishlistService/GetWishlist` and the
community games XML all refuse. There is no public endpoint that will return
this account's library, wishlist or playtime.

So it is split in two:

- **Pinned by hand** in `site/data/steam-seed.json`: the appids, playtime in
  minutes, and achievement counts. Refresh by opening the logged-in library page
  and updating `minutes`.
- **Fetched live** from the public store API on every deploy: names, release
  dates, genres, **prices, discounts and review scores**.

A wishlist showing year-old prices would be worse than no wishlist, which is why
the half that can be fresh, is. Set the profile to public and the seed file can
be replaced by a live fetch.

`steam-seed.json` also has an `extra` array: appids that are neither owned nor
wishlisted, but appear in the played-it list in `site/data/games.toml` because
they were played on a console or on an older account. They are there only so
that list gets real names, real links and local art.

## Art is converted at build time, not on the builder

`fetch-steam-art.mjs` downloads each game's store header and converts it with
`cwebp` to a 268px-wide WebP in `site/static/imgs/steam/`. About 4 KB a game;
120 games is under 700 KB total, and every one is `loading="lazy"` with its box
reserved by `aspect-ratio`.

It is **not** in `build-zola.sh`, for two reasons:

1. `cwebp` is not installed on Cloudflare's build image.
2. Fetching the art at build time and serving it from this origin is the entire
   point. Fetching it in the page would not be.

Run it locally after changing the seed, and commit the output:

```bash
node scripts/fetch-steam.mjs        # first — the art script reads steam.json
node scripts/fetch-steam-art.mjs    # needs cwebp: brew install webp
```

It skips files that already exist; set `FORCE=1` to re-convert everything. It
exits non-zero and names any game whose art it could not get, because a missing
capsule is a broken `<img>` on a live page.

## Photographs carry obligations

`fetch-media.mjs` pulls the three summit photographs from Wikimedia Commons and
the book jackets from Open Library, converts both to WebP and writes
`site/data/media.json`. Like the Steam art it needs `cwebp`, so it runs locally
and its output is committed.

The two sources are not the same situation:

- The **mountains** are CC BY or CC BY-SA. Freely licensed is not the same as
  free of obligations — every one of those licences *requires* attribution, so
  the author, licence and a link to the file page come out of the API with the
  image and land in `media.json`. `.credit` renders them under each photo. Do
  not remove that line; it is the price of the picture.
- The **book jackets** are the publishers'. They are shown at thumbnail size to
  identify an edition on a reading list, which is what every library catalogue
  and bookshop does with them. Nothing is served at print resolution.

Every id is **pinned**. Searching Commons at build time would mean the pictures
could change under the site whenever the search got re-ranked.

## The map is a file, and its coordinates are not rounded

`build-map.mjs` paints the visited-states map. Add a state to the `visited`
array in `site/data/travel.json`, re-run it, commit both outputs. An unknown
code fails the script loudly rather than quietly colouring nothing.

Two decisions worth keeping:

**It is an `<img>`, not inline SVG.** The path data is 44 KB — about 12 KB over
the wire — which would have doubled the home page for one section. As a separate
file it is one request that caches for a year under the `/imgs/*` rule in
`_headers`, and the HTML does not grow at all. The cost is that an
`<img>`-referenced SVG is a static picture: no per-state hover, no tooltips. So
the state names are rendered as real text beside the map, which a screen reader
prefers anyway.

**Do not round the coordinates.** The obvious optimisation is to drop the
decimal place and save 15 KB. It does not work. The source paths are *relative*
(`m`/`v`/`h`/`l`), so the error does not stay local — it accumulates along each
path and the states drift off one another into an unrecognisable scatter of
black polygons. Stripping whitespace and leading zeros is free and safe;
touching the precision is neither.

The base map is "Blank US Map (states only).svg" by Heitordp, released **CC0**,
so unlike the photographs it carries no attribution requirement. It is credited
on the page regardless.

## Logos: whose they are, and when not to use one

`fetch-icons.mjs` pulls the brand marks into `site/data/icons.json` — single
monochrome paths on a 24×24 grid plus each brand's published hex, inlined into
the page so nothing fetches a logo at load time.

Simple Icons releases its SVG data CC0, but CC0 cannot give away someone else's
trademark. What makes this fine is what the marks are used *for*: "I daily drive
Linux", "my Starbucks order is this". That is nominative use — a mark referring
to the thing it names — which is what every comparison table does. No mark is
altered beyond being tinted to its own brand colour, and nothing implies
endorsement.

Where there is no free mark — Windows, Chipotle, Dutch Bros, Nobara, CachyOS,
and every local business — the answer is **not** to draw an imitation from
memory. That would look worse *and* sit closer to the line than using the real
thing nominatively. Those get honestly generic glyphs from `macros.html`
(`g:monitor`, `g:cup`, `g:bowl`, `g:steak`, `g:burrito`, `g:chips`) or fall back
to a two-letter monogram.

TV posters are the one thing that cannot be solved this way. Key art is
copyrighted and has no free source at any size, which is why the show cards are
typography rather than pictures.

**Do not draw a brand mark by hand.** The Nexus Mods island shipped for weeks
with a hexagon containing a letter N, invented from memory, which is not that
company's logo and never resembled it — theirs is an interlocking four-way knot.
Simple Icons has it under the slug `nexusmods`, as it has almost everything, and
the two call sites reach for it through `ico::brand()` so there is exactly one
copy of the 2.8 KB path. If a mark is worth showing it is worth looking up; if
it cannot be looked up, use a generic glyph and say so.

## Nexus Mods asks two questions, not one

`fetch-nexus.mjs` makes two unauthenticated GraphQL calls, the same pair the
profile page itself fires:

- `mods(filter: { uploaderId })` — the published mods, sorted by downloads.
- `userByName(name)` — the profile: kudos, views, join date, verified-author
  flag, unique downloads, avatar URL.

The second one is a **bonus, not a requirement**. If it fails the mods still
publish and the island renders without its hero; the template drops the Kudos
tile rather than printing a confident `0`, because "we did not fetch it" and
"nobody gave him any" are different claims.

**Two download numbers that disagree, both correct.** `totals.downloads` (18,536)
is the sum of the five mods' counts. `profile.unique_downloads` (15,612) is what
Nexus puts on the profile and counts each person once however many mods they
took. Label them separately or the page quietly claims a figure Nexus does not.

The avatar is downloaded, re-encoded (19 KB → 2.4 KB) and served from this
origin like everything else. Two things about it:

- Nexus only serves it at **100×100**. Asking for `/200` or `/400` returns the
  grey placeholder mark rather than a larger picture, so there is no retina
  version to fetch.
- The filename **carries a hash of the source bytes**, for the reason spelled
  out under the map above: `/imgs/*` is `immutable` for a year, so a picture
  that changes while keeping its name is one returning visitors hold onto until
  next August.

Re-encoding needs `cwebp`, which the Cloudflare builder does not have, so that
step is skipped there and the committed file stays — the same fail-soft rule as
the rest of the directory.

## The watch-list pipeline

Adding a show is one line in `site/data/watching.json`:

```json
{ "title": "Severance" }
```

Then `node scripts/fetch-titles.mjs`. It comes back with a year, an IMDb link,
the genres, and — where Wikimedia Commons has a freely-licensed one — the title
logo, downloaded and converted. 35 of 36 shows resolved an IMDb id and 22 got a
real logo without anyone typing an eleven-digit identifier.

Facts come from **Wikidata**, which is CC0. TMDb and OMDb would have been less
work and both would have been wrong here: they need an API key, which means a
secret in the build, and their artwork is the studios' rather than theirs to
license on.

Three things that took a second pass:

- **Title collisions.** A bare search for "Barry" returns a given name, a family
  name and a town in the Vale of Glamorgan. `resolve_qid()` now retries with
  "television series" and "anime" appended, matches a wide list of Wikidata
  classes (a TV series is not one class — The Simpsons is an *animated sitcom*),
  and falls back to "has an IMDb id and is not on the not-a-show blocklist".
  Four titles still needed a hand-pinned `qid`; `imdb` and `no_imdb` override it
  entirely, which is how Tom and Jerry stops resolving to a folk-rock duo.
- **Posters do not exist, legally.** Key art is copyrighted with no free source
  at any size; Wikipedia's own poster files are tagged non-free and are fair use
  *on Wikipedia*, which does not travel. Title *logos* are different — a wordmark
  set in a typeface is often below the threshold of originality and therefore
  public domain. That is what this fetches, and it is why some shows have a real
  logo and the rest are typography.
- **Half the logos were invisible.** They are transparent wordmarks and the card
  behind them was a hand-picked colour: Better Call Saul is black type, The
  Walking Dead is white type, and no one card colour carries both. `isDark()`
  decodes each logo with `dwebp` to PAM, averages the luminance of the *opaque*
  pixels only, and records it; the template then puts dark ink on a near-white
  plate and light ink on a near-black one.

## Posters are the one thing that needs a key

See **POSTERS.md**. Short version: poster art is the studios', no free-licence
source exists, and TMDb is the only service that licenses its API for showing
it. That costs a free key and one broken rule — TMDb requires images be served
from their CDN, so posters are the only third-party request this site makes.
Nothing happens until someone runs the script with a key; until then the shows
keep their Commons title logos and typographic cards, all locally served.

## The hand-written half

`site/data/games.toml` and `site/data/me.toml` are authored, not generated —
favourites, the complete played-it list, books, shows, the bucket list. Rows in
`games.toml` carry an appid rather than a title so the name, store link and art
all come from the Steam snapshot and can never drift from what Steam calls it.

Watch the TOML ordering rule at the top of `me.toml`: every bare `key = value`
at the root must come **before** the first `[[table]]` header, or it silently
lands inside that table instead.

## Rendering

`site/templates/islands.html` holds the markup for each brand island as a Tera
macro, because every one renders twice — a teaser on the home page and the full
thing on its own page. `site/templates/_islands.css` holds their CSS and is
inlined only by the three templates that mount one (`index.html`, `games.html`,
`chess.html`) via the `css_extra` block in `base.html`. A blog post does not
carry 13 KB of Steam blue it has no use for.
