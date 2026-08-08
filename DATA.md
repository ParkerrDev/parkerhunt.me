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
| `fetch-x.mjs` | `api.fxtwitter.com`, `api.vxtwitter.com` | `site/data/x.json` + `site/static/imgs/x/avatar-*.webp` | none |
| `fetch-steam-owned.mjs` | `api.steampowered.com` | `site/data/steam-owned.json` | **`STEAM_API_KEY`** (optional) |
| `fetch-steam-art.mjs` | `steam.json` + Steam CDN | `site/static/imgs/steam/*.webp` | none, **local only** |
| `build-stamps.mjs` | nothing — arithmetic | `site/data/stamps.json` | n/a |
| `fetch-media.mjs` | Wikimedia Commons + Open Library | `site/static/imgs/media/*.webp` + `site/data/media.json` | none, **local only** |
| `build-map.mjs` | us-atlas TopoJSON + `travel.json` + `been.json` + `media.json` | `site/static/imgs/us-visited-*.svg` + `site/data/travel-map.json` | none, **local only** |
| `fetch-project-brand.mjs` | each project's live site (icon / apple-touch-icon) | `site/static/imgs/project-brand/*.webp` + `brand_image` in `site/content/projects/*.md` | none, **local only** |
| `project-accents.mjs` | `site/static/imgs/project-cards/opt/*.webp` | `accent` + `accent_ink` in `site/content/projects/*.md` | none, **local only** |
| `fetch-icons.mjs` | Simple Icons | `site/data/icons.json` | none |
| `fetch-logos.mjs` | Wikimedia Commons | `site/static/imgs/logos/*.webp` + `site/data/logos.json` | none, **local only** |
| `fetch-titles.mjs` | Wikidata + Commons + `site/data/watching.json` | `site/data/titles.json` + `site/static/imgs/titles/*.webp` | none, **local only** |
| `fetch-posters.mjs` | TMDb | merges posters into `site/data/titles.json` | **needs `TMDB_API_KEY`**, local only |
| `fetch-places.mjs` | Wikidata (P625 + P18) + Commons + `places.json` | `site/data/been.json` + `site/static/imgs/been/*.webp` | none, **local only** |

All seven fetchers run from `build-zola.sh` on every Cloudflare deploy. Only one
of them can use a key, and it works without one: every other endpoint above
answers unauthenticated.

## Live means "rebuilt", not "fetched in the browser"

Every number on this site is baked into HTML at build time. That is the whole
reason a visitor's browser never contacts a third party — and it has exactly one
weakness, which is that a snapshot is only as fresh as the last deploy.

`.github/workflows/refresh.yml` closes it: a cron every three hours asks
Cloudflare Pages to rebuild, every `fetch-*.mjs` re-runs, and the page is
regenerated. Nothing is committed and no client-side JavaScript appears. It
needs one secret, `CF_DEPLOY_HOOK` — the setup is four lines in that file's
header.

**Three hours, not one, and that is arithmetic.** Cloudflare Pages allows 500
builds a month free. Every three hours is 248; hourly is 744 and would run the
account dry around the 20th.

Two things worth knowing if this is ever revisited:

- **GitHub only runs `schedule` from the default branch.** On a feature branch
  the workflow file does nothing until it is merged.
- **Nothing here needs the browser to fetch anything.** Chess.com, GitHub and
  Nexus Mods all send `Access-Control-Allow-Origin: *`, so a few lines of
  client-side JavaScript *could* refresh those numbers per pageview — and would
  hand every visitor's IP to three companies to save three hours of staleness.
  It is a bad trade. If per-request freshness is ever genuinely wanted, the
  right shape is a Pages Function rewriting the HTML at the edge, where the
  fetch happens on Cloudflare's machines and not the reader's.

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

## Steam is the odd one, and it has a key-shaped fix

The Steam profile is **private** (`privacyState=private` on the public profile
XML), so `IPlayerService/GetOwnedGames`, `IWishlistService/GetWishlist` and the
community games XML all refuse *anyone else's* request. There is no public
endpoint that will return this account's library, wishlist or playtime.

There is a non-public one. From the Steamworks documentation for IPlayerService:

> Private, friends-only, and other privacy settings are not supported unless you
> are asking for your own personal details (i.e. the WebAPI key you are using is
> linked to the steamID you are requesting).

So the account's **own** free key — generated at
<https://steamcommunity.com/dev/apikey> — reads the whole library with real
playtime while the profile stays private to everybody else. That is what
`scripts/fetch-steam-owned.mjs` does. Set `STEAM_API_KEY` and the hand-pinned
library stops being the source of truth; leave it unset and everything below
still applies, unchanged.

Achievement counts stay pinned either way: `GetOwnedGames` does not return them
and `GetPlayerAchievements` is one call per game, which is ninety calls into a
rate limit of about two hundred per five minutes.

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

## The map is a file, its pins are real, and its projection is checked

`build-map.mjs` writes one SVG: fifty-one state outlines with sixteen filled in,
and forty-six pins — thirty places, thirteen ski resorts, three summits. It is an
`<img>`, not inline SVG, because 52 KB of path data would double the home page,
and as a file it caches for a year under the `/imgs/*` rule.

**Every pin is a real coordinate.** `fetch-places.mjs` asks Wikidata for P625
alongside the P18 image it was already fetching — one entity call, both answers —
and 43 of the 44 places have one. The summits are written down in
`fetch-media.mjs` because there are three of them and a summit does not move.

### Why the base map had to change

It used to trace a blank SVG from Wikimedia Commons. That was fine while the only
job was colouring states in, and impossible the moment pins were wanted: **a
finished SVG tells you where Nevada is drawn but not what projection put it
there**, so there is no way to turn 39.19°N 120.26°W into a point on it. Fitting
one by least squares over state centroids was tried and landed within ~20px,
which is Sacramento in the Pacific.

The geometry now comes from us-atlas' `states-albers-10m.json`, which is
pre-projected with published parameters:

```
d3.geoAlbersUsa().scale(1300).translate([487.5, 305])   on a 975 x 610 canvas
```

Those are reimplemented by hand (d3 is not a dependency) and **verified, not
assumed**: `node scripts/build-map.mjs --verify` drops every state's Census
internal point through the projection and asserts it lands inside that state's
own polygon. 51 of 51, Alaska and Hawaii insets included. A future us-atlas that
changes canvas fails that check loudly instead of scattering pins into the sea.

Two traps, both already sprung:

- **d3's `.center()` is in rotated coordinates.** Albers is
  `.rotate([96,0]).center([-0.6, 38.7])`; rotating the centre as well puts it at
  95.4° and throws every point ~1400px off canvas. Rotate the point, not the
  centre.
- **Simplify arcs, not rings.** Douglas–Peucker runs once per TopoJSON *arc* —
  the shared border segment two states both reference. Simplifying each state's
  ring separately drops different points on each side of the same line and opens
  white cracks down the middle of the country.

### Why there is no Google Maps embed

The Maps Embed API is genuinely free and genuinely unlimited — and it wants a
Google Cloud project with a billing account attached, and forty-six iframes would
put forty-six third-party requests and a tracking cookie on a page whose entire
claim is that it has neither. So every card links out to
`google.com/maps/search/?api=1&query=<lat>,<lon>` instead: nothing loads until
somebody actually clicks it.

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

## X: the profile is live, the posts cannot be

`@AndrewParkerH` is a **protected** account. `fetch-x.mjs` reads the profile —
name, bio, location, website, join date, and all three counts — from FixTweet
with a vxtwitter fallback, both free and keyless, both queried at build time only.
That part is live.

The posts are hand-written in `site/data/feeds.toml` and will stay that way.
Every route was checked:

| Route | Result |
|---|---|
| Official X API | Respects protection at every tier. As of February 2026 there is no free read tier at all — pay-per-use, $0.005 per post read — and paying does not unlock a protected timeline. |
| `syndication.twitter.com/srv/timeline-profile` | The endpoint the embed widget uses, and the last free timeline read. Returns `entries: []` for this account, and now for public accounts too. |
| `platform.twitter.com/widgets.js` | Renders nothing for a protected account. Also a third-party script and a tracking pixel. |
| Nitter | Dead since February 2024, when X removed guest accounts. |

The only mechanism that would work is authenticating **as** the account and
republishing its posts to a public web page, which defeats the point of the
account being protected. The template says so under the rail rather than leaving
an unexplained gap.

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
  Setting **both** covers the other case — a title Wikidata simply does not have.
  *Manhunt for Claude Dallas* (CBS, 1986) is a made-for-television film with no
  Wikidata item and no Wikipedia article, so there is nothing to resolve to; it
  carries `imdb: "tt0091473"` with `no_imdb: true`, which supplies the link and
  skips the search rather than retrying a lookup that will always come back
  empty. TMDb still has it, so the poster arrives normally.
- **`alias` is searchable text that is never displayed.** A film is filed under
  its release title, and the first entry in a series usually has no trace of the
  series in it: *First Blood* is a Rambo film, *Star Wars* is *A New Hope*.
  Searching "rambo" found the two sequels and not the original, which reads as
  the original being missing rather than as being filed under F. The alias is
  appended to `data-find` only — the card still says *First Blood*. Add one to a
  row in `watching.json` and it flows through untouched, since the resolver
  copies unknown fields across.
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

## fetch-titles is incremental now

A full pass is 660 Wikidata lookups at a polite 250ms each, plus an entity
fetch per candidate and a Commons download per logo — about **seventeen
minutes**, nearly all of it re-deriving answers that had not changed. A row
that already has a `qid` and a real `tt` id is settled; Wikidata is not going
to change its mind about which item The Goonies is.

So settled rows are carried across whole and never queried. Adding eight films
to a list of six hundred now takes **twelve seconds**.

```
node scripts/fetch-titles.mjs          # only the new and the unresolved
node scripts/fetch-titles.mjs --all    # everything, from scratch
```

**`--all` is not optional politeness.** Every time the scoring in
`resolve_qid` changes, the existing rows were matched under the *old* rules
and have to be redone — otherwise a fix to the matcher silently applies to new
titles only. Same after editing `SERIES_KINDS` / `FILM_KINDS`.

The hand-edited fields still win on a reused row: title, year and the card
colours come from `watching.json`, so fixing a colour does not need a
re-resolve. Only `qid`, `imdb` and the fetched metadata are reused.

**A changed pin is the exception, and it has to be.** Reusing the cached `qid`
means writing one into `watching.json` to overrule a wrong match would otherwise
do nothing — silently, because a row that resolved *wrongly* still has a qid and
a `tt` id and therefore still counts as settled. That is exactly the case worth
catching: the correction is only ever made because the cached answer is wrong.
So a hand-written `qid` that disagrees with the cache forces that one row to
re-resolve, and says so on stdout. *All Quiet on the Western Front* matched the
1930 Milestone film when the 1979 Delbert Mann television film was wanted; the
pin now takes effect on the next ordinary run, with no `--all`.

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
