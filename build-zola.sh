#!/usr/bin/env bash
set -euo pipefail

# Set a Zola version or override via environment: ZOLA_VERSION=0.18.0
ZOLA_VERSION="${ZOLA_VERSION:-0.22.1}"

# Cloudflare Pages build machines are x86_64 Linux.
TARBALL="zola-v${ZOLA_VERSION}-x86_64-unknown-linux-gnu.tar.gz"
URL="https://github.com/getzola/zola/releases/download/v${ZOLA_VERSION}/${TARBALL}"

# --- Pull the résumé from the PRIVATE resume repo (build time) --------------
# Blog posts live in THIS repo — site/content/blog/ is an Obsidian vault, so a
# post is written and shipped in one commit with no conversion step (BLOG.md).
#
# The résumé is different: it is built in ParkerrDev/resume, which is private
# because it also holds client invoice data. This repo keeps no copy of the PDF,
# so /resume can never drift from that repo's HEAD. See RESUME.md.
RESUME_REPO="${RESUME_REPO:-ParkerrDev/resume}"
RESUME_BRANCH="${RESUME_BRANCH:-master}"

# GitHub's published SSH host key. Pinned rather than trusted on first use: the
# build machine is fresh every time, so TOFU here would accept whatever answers
# on port 22, every build. Verify against https://api.github.com/meta if GitHub
# ever rotates it.
GITHUB_HOST_KEY='github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl'

# Three ways in, in priority order:
#   RESUME_DIR         a local working copy — no credential at all (local builds)
#   RESUME_DEPLOY_KEY  base64 of a read-only SSH deploy key (what Cloudflare uses)
#   RESUME_TOKEN       a fine-grained PAT over HTTPS (the manual alternative)
# The deploy key is preferred because it is scoped to this one repo by
# construction and cannot be widened later the way a PAT can.
rm -rf _resume
if [ -n "${RESUME_DIR:-}" ]; then
  # A symlink, because build-resume.mjs only ever reads from the source and
  # writes into site/ — your checkout can't be dirtied.
  [ -d "${RESUME_DIR}" ] || { echo "ERROR: RESUME_DIR not found: ${RESUME_DIR}" >&2; exit 1; }
  echo "Using local resume at ${RESUME_DIR}"
  ln -s "$(cd "${RESUME_DIR}" && pwd)" _resume

elif [ -n "${RESUME_DEPLOY_KEY:-}" ]; then
  echo "Fetching resume from ${RESUME_REPO}@${RESUME_BRANCH} (deploy key)..."
  # base64 because a Cloudflare build variable is one line and an OpenSSH private
  # key is not. openssl rather than base64(1) — the -d/-D flag differs between
  # GNU and BSD, and this script runs on both.
  ssh_dir="$(mktemp -d)"
  trap 'rm -rf "${ssh_dir}"' EXIT
  chmod 700 "${ssh_dir}"
  printf '%s' "${RESUME_DEPLOY_KEY}" | openssl base64 -d -A > "${ssh_dir}/key"
  chmod 600 "${ssh_dir}/key"
  printf '%s\n' "${GITHUB_HOST_KEY}" > "${ssh_dir}/known_hosts"

  if ! err="$(GIT_SSH_COMMAND="ssh -i ${ssh_dir}/key -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${ssh_dir}/known_hosts" \
      git clone --quiet --depth 1 --branch "${RESUME_BRANCH}" \
      "git@github.com:${RESUME_REPO}.git" _resume 2>&1)"; then
    echo "ERROR: could not clone ${RESUME_REPO}@${RESUME_BRANCH} with the deploy key." >&2
    echo "${err}" >&2
    exit 1
  fi
  rm -rf "${ssh_dir}"
  trap - EXIT

elif [ -n "${RESUME_TOKEN:-}" ]; then
  echo "Fetching resume from ${RESUME_REPO}@${RESUME_BRANCH} (token)..."
  # Capture git's output so the token in the URL is stripped before any of it can
  # reach the build log.
  if ! err="$(git clone --quiet --depth 1 --branch "${RESUME_BRANCH}" \
      "https://x-access-token:${RESUME_TOKEN}@github.com/${RESUME_REPO}.git" _resume 2>&1)"; then
    echo "ERROR: could not clone ${RESUME_REPO}@${RESUME_BRANCH} — check the token's scope and expiry." >&2
    echo "${err//${RESUME_TOKEN}/***}" >&2
    exit 1
  fi
fi

# A missing token only warns, so the site still builds locally with no secrets.
# But once the source is there, build-resume.mjs exits non-zero on a missing or
# corrupt PDF and `set -e` stops the build — better than deploying a dead link.
if [ -e _resume ]; then
  echo "Publishing resume PDFs -> site/static..."
  node scripts/build-resume.mjs _resume site
else
  echo "WARNING: RESUME_TOKEN not set — /resume will have no PDF in this build." >&2
fi

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
