#!/usr/bin/env bash
set -euo pipefail

# Build the site the way Cloudflare does, on a Mac, for previewing and for
# deploying site/public/ by hand.
#
# WHY THIS EXISTS. build-zola.sh downloads an x86_64 *Linux* Zola, so it only
# runs as-is on the Cloudflare builder. The obvious local substitute is `cd site
# && zola build`, and that is the bug this script fixes.
#
# site/static/AndrewHuntResume*.pdf are GENERATED, git-ignored, and produced by
# build-resume.mjs from the private resume repo. Zola does not generate them; it
# copies whatever is sitting in site/static/. So a bare `zola build` happily
# publishes whichever résumé was last left on disk, with no error and no clue in
# the output, and every subsequent hand-deploy ships that same frozen copy no
# matter how many times the résumé is rebuilt in its own repo. It looks like it
# worked. It did not.
#
# So: the PDFs are DELETED before every build and re-copied from the resume repo,
# and build-resume.mjs exits non-zero if the source is missing or is not a real
# PDF. There is no path through this script that reaches `zola build` with a
# stale résumé, the worst case is no build at all, which is the right failure.
#
#   ./build-local.sh                    # resume from ../resume
#   RESUME_DIR=path ./build-local.sh    # from somewhere else
#   ZOLA=/path/to/zola ./build-local.sh # if zola is not on PATH or at site/zola

cd "$(dirname "$0")"

RESUME_DIR="${RESUME_DIR:-../resume}"

# --- the résumé, from its own repo and nowhere else --------------------------
echo "==> Résumé"
rm -f site/static/AndrewHuntResume*.pdf
if [ ! -d "${RESUME_DIR}" ]; then
  echo "ERROR: no resume checkout at ${RESUME_DIR}." >&2
  echo "       Clone ParkerrDev/resume beside this repo, or set RESUME_DIR." >&2
  echo "       Refusing to build: the last build's PDFs have been removed, so" >&2
  echo "       continuing would publish a résumé-shaped 404." >&2
  exit 1
fi
node scripts/build-resume.mjs "${RESUME_DIR}" site

# Provenance, printed rather than assumed. A dirty resume checkout means the
# artifact on disk may not correspond to any commit, which is worth saying out
# loud before it is published under a permanent URL.
head="$(git -C "${RESUME_DIR}" log -1 --format='%h %ad %s' --date=short 2>/dev/null || echo 'not a git checkout')"
echo "    source: ${RESUME_DIR} @ ${head}"
if [ -n "$(git -C "${RESUME_DIR}" status --porcelain 2>/dev/null || true)" ]; then
  echo "    WARNING: that checkout has uncommitted changes, this may not match origin." >&2
fi
shasum -a 256 site/static/AndrewHuntResume.pdf | awk '{print "    sha256: " substr($1,1,16) "  AndrewHuntResume.pdf"}'

# --- the shuffled lists ------------------------------------------------------
# Must run after fetch-titles' output is in place and before Zola reads it.
echo "==> Shuffling"
node scripts/build-shuffle.mjs >/dev/null
echo "    quotes, shows and films reordered"

# --- the site ----------------------------------------------------------------
ZOLA="${ZOLA:-}"
if [ -z "${ZOLA}" ]; then
  if [ -x site/zola ]; then ZOLA="$(pwd)/site/zola"
  elif command -v zola >/dev/null 2>&1; then ZOLA="$(command -v zola)"
  else
    echo "ERROR: no zola. Put one at site/zola (git-ignored), on PATH, or set ZOLA." >&2
    exit 1
  fi
fi

echo "==> Zola ($("${ZOLA}" --version))"
cd site
rm -f public/_*.html
"${ZOLA}" build
cd ..

# The résumé is the one page that exists to be handed to somebody, so confirm it
# survived into the output rather than trusting that it did.
for f in AndrewHuntResume.pdf; do
  [ -s "site/public/${f}" ] || { echo "ERROR: ${f} did not reach site/public/." >&2; exit 1; }
done
# What this build produced, for netlify-prune.sh. Netlify lays an upload on top
# of a restored cache rather than replacing the directory, so the deploy needs a
# list of what is meant to be there to clear out what is not.
( cd site/public && find . -type f | sed 's|^\./||' | grep -v '^\.manifest$' > .manifest && echo ".manifest" >> .manifest )
echo "    manifest: $(wc -l < site/public/.manifest | tr -d ' ') files"

echo "==> Built. site/public/ is ready to deploy."
