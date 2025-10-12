#!/usr/bin/env bash
set -euo pipefail

# Set a Zola version or override via environment: ZOLA_VERSION=0.18.0
ZOLA_VERSION="${ZOLA_VERSION:-0.21.0}"

# Cloudflare Pages build machines are x86_64 Linux.
TARBALL="zola-v${ZOLA_VERSION}-x86_64-unknown-linux-gnu.tar.gz"
URL="https://github.com/getzola/zola/releases/download/v${ZOLA_VERSION}/${TARBALL}"

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
rm -rf ../public  # <-- ADD THIS LINE to clean old builds
mkdir -p ../public
cp -a public/. ../public/

echo "Build complete! Output in ../public/"
