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
| `fetch-nexus.mjs` | `api-router.nexusmods.com/graphql` | `site/data/nexus.json` | none |
| `fetch-steam-art.mjs` | `steam.json` + Steam CDN | `site/static/imgs/steam/*.webp` | none, **local only** |
| `build-stamps.mjs` | nothing — arithmetic | `site/data/stamps.json` | n/a |
| `fetch-media.mjs` | Wikimedia Commons + Open Library | `site/static/imgs/media/*.webp` + `site/data/media.json` | none, **local only** |

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
