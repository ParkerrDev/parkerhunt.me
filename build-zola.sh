#!/usr/bin/env bash
set -euo pipefail

# Set a Zola version or override via environment: ZOLA_VERSION=0.18.0
ZOLA_VERSION="${ZOLA_VERSION:-0.22.1}"

# Cloudflare Pages build machines are x86_64 Linux.
TARBALL="zola-v${ZOLA_VERSION}-x86_64-unknown-linux-gnu.tar.gz"
URL="https://github.com/getzola/zola/releases/download/v${ZOLA_VERSION}/${TARBALL}"

# --- Pull blog content from the PRIVATE notes repo (build time) -------------
# Blog posts are authored in Obsidian (ParkerrDev/notes -> Blog/). We clone that
# repo here with a read-only token and convert the posts into Zola content, so
# the blog is PRE-RENDERED by Zola (good SEO) like the rest of the site. This
# repo is never committed to in order to publish a post.
NOTES_REPO="${NOTES_REPO:-ParkerrDev/notes}"
NOTES_BRANCH="${NOTES_BRANCH:-main}"

rm -rf _notes
if [ -n "${NOTES_TOKEN:-}" ]; then
  echo "Fetching blog from ${NOTES_REPO}@${NOTES_BRANCH}..."
  git clone --quiet --depth 1 --branch "${NOTES_BRANCH}" \
    "https://x-access-token:${NOTES_TOKEN}@github.com/${NOTES_REPO}.git" _notes
else
  echo "WARNING: NOTES_TOKEN not set — building with an empty blog." >&2
  mkdir -p _notes/Blog
fi

echo "Converting Obsidian posts -> Zola content..."
node scripts/build-blog.mjs _notes site

# --- Build the static site --------------------------------------------------
# Run inside the site folder so Zola finds site/config.toml
cd site

echo "Installing Zola ${ZOLA_VERSION}..."
curl -Ls "${URL}" | tar -xz

echo "Zola version:"
./zola --version

echo "Building site..."
./zola build

# Move artifacts to repo-root 'public' so Cloudflare Pages default works
echo "Preparing Cloudflare Pages output directory..."
rm -rf ../public
mkdir -p ../public
cp -a public/. ../public/

echo "Build complete! Output in ../public/"
