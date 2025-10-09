#!/usr/bin/env bash
set -euo pipefail

# Set a Zola version or override via environment: ZOLA_VERSION=0.19.2
ZOLA_VERSION="${ZOLA_VERSION:-0.19.2}"

# Cloudflare Pages build machines are x86_64 Linux.
TARBALL="zola-v${ZOLA_VERSION}-x86_64-unknown-linux-gnu.tar.gz"
URL="https://github.com/getzola/zola/releases/download/v${ZOLA_VERSION}/${TARBALL}"

echo "Installing Zola ${ZOLA_VERSION}..."
curl -Ls "${URL}" | tar -xz

echo "Zola version:"
./zola --version

echo "Building site..."
./zola build