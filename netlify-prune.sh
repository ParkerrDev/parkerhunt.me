#!/usr/bin/env bash
# Delete anything in the publish directory that this build did not produce.
#
# WHY THIS EXISTS. Netlify restores a cached copy of site/public/ between builds
# and lays the uploaded files on top of it, so a page deleted locally keeps
# being published: /dad/ survived four deploys whose uploads provably did not
# contain it, and /watching/ did the same the moment it was disabled. Naming
# each stale path in netlify.toml worked twice and would have to be extended
# every time something is removed, which is a list nobody remembers to update.
#
# build-local.sh writes .manifest, one path per line, listing exactly what it
# built. Everything else in the tree is left over from a previous build and goes.
set -euo pipefail
cd site/public

[ -f .manifest ] || { echo "no .manifest: run ./build-local.sh before deploying" >&2; exit 1; }
[ -f index.html ] || { echo "site/public/ has no index.html" >&2; exit 1; }

before=$(find . -type f | wc -l | tr -d ' ')
# -x so a filename can never match a manifest line as a substring, -F so a path
# containing a regex character is compared literally.
# grep exits 1 when it matches nothing, and matching nothing is the normal
# case: a tree with no leftovers is a clean build, not a failed script. Under
# set -e that exit code killed the deploy.
stale=$(find . -type f | sed 's|^\./||' | { grep -vxF -f .manifest || true; })
[ -n "$stale" ] && printf '%s\n' "$stale" | tr '\n' '\0' | xargs -0 rm -f
find . -type d -empty -delete
after=$(find . -type f | wc -l | tr -d ' ')

echo "publish tree: ${before} files, pruned $((before - after)) left over from an earlier build, ${after} published"
