# Posters

The show cards on `/watching/` and the home page fall back through three things,
in this order:

1. **A real poster from TMDb**, only if `site/data/titles.json` has a `posters`
   block, which only happens once someone runs `fetch-posters.mjs` with a key.
2. **A title logo from Wikimedia Commons**: 22 of 36 shows have one.
3. **The title set in this site's own type** on a hand-picked colour pair.

## Why posters need a key and everything else does not

Poster art is the studios'. There is no free-licence source for it and there
will not be one: Wikipedia's own poster files are tagged **non-free** and are
fair use *on Wikipedia*, which does not travel to anyone else's website.
Wikimedia Commons will not host them at all.

TMDb is the exception. It licenses its API specifically so applications can
display this artwork. Two conditions come with that, and both are honoured:

- **Attribution.** The page must carry *"This product uses the TMDB API but is
  not endorsed or certified by TMDB."* The string is written into
  `titles.json` by the script and rendered by the template. Removing it removes
  the basis for using the images.
- **Serve from their CDN.** Which is why the script stores an
  `image.tmdb.org` URL instead of downloading and re-hosting the file.

## The trade this makes, stated plainly

Every other section of this site is built so that a visitor's browser contacts
nothing but this origin: GitHub, Steam, Chess.com, Duolingo, Nexus Mods, the
summit photographs, the book jackets and the state map are all fetched at build
time and served locally.

**Posters break that, and are the only thing that does.** A page showing them
makes one request per visible poster to `image.tmdb.org`, which means TMDb sees
the IP of everyone who loads the page.

That is TMDb's condition rather than a shortcut, so it is a real choice, not an
oversight:

- **Want the posters:** get a key, run the script, accept the third-party
  requests, and keep the attribution line.
- **Want the no-third-party rule intact:** do nothing. The title logos and the
  typographic cards are already there and are all locally served.

## Getting a key

1. Sign up at <https://www.themoviedb.org>, free, instant, no card.
2. Settings → API → request a key.
3. Run it:

```bash
TMDB_API_KEY=xxxxxxxxxxxx node scripts/fetch-posters.mjs
```

Then commit `site/data/titles.json`.

The key never goes in the repo. For posters to refresh on deploys it belongs in
Cloudflare's build environment variables, next to `RESUME_DEPLOY_KEY`.

Matching is exact rather than fuzzy: `fetch-titles.mjs` has already resolved an
IMDb id for 35 of the 36 shows, and TMDb's `/find` endpoint takes an IMDb id
directly, so there is no title search to get wrong, and "The Boys" cannot come
back as a 1962 war film the way it did from a plain name search.
