# Blog: written in Obsidian, pre-rendered by Zola

Blog posts are authored in Obsidian and live in the **private**
[`ParkerrDev/notes`](https://github.com/ParkerrDev/notes) repo (the vault) under
`Blog/`. They are **not** committed to this repo. At build time Cloudflare clones
the notes repo, converts the posts to Zola content, and Zola **pre-renders** them
as static HTML — so the blog gets the same SEO as the rest of the site.

```
Obsidian Blog/*.md ──git sync──▶ ParkerrDev/notes (private)
        │                               │
        │ (push)                        │ webhook ──▶ Cloudflare deploy hook
        ▼                               ▼
  notes repo ──────────────▶ Cloudflare Pages build:
                               build-zola.sh:
                                 1. git clone notes  (NOTES_TOKEN)
                                 2. node scripts/build-blog.mjs  → site/content/blog/*
                                 3. zola build  → pre-rendered HTML
```

Write a post in Obsidian → **Git: Commit-and-sync** → the webhook triggers a
Cloudflare rebuild → the new post is live in ~a minute. **Nothing is ever
committed to this repo to publish.**

## Files

| Path | Role |
|------|------|
| `scripts/build-blog.mjs` | Converts vault `Blog/*.md` → Zola `content/blog/*` and copies post images into `static/img/blog/<slug>/` |
| `build-zola.sh` | Clones the notes repo, runs the converter, then `zola build` |

Generated paths (`site/content/blog/`, `site/static/img/blog/`, `_notes/`) are
git-ignored — they only exist during a build.

## Required setup (one-time)

**1. Read-only token → Cloudflare build variable.** Create a GitHub
**fine-grained PAT** scoped to **only** `ParkerrDev/notes` with **Contents:
Read-only**. In the Cloudflare Pages project → **Settings → Environment variables
→ Production** (and Preview), add:

| Variable | Value |
|----------|-------|
| `NOTES_TOKEN` | the PAT |

**2. Deploy hook.** Cloudflare Pages project → **Settings → Builds & deployments
→ Deploy hooks** → create one (branch: `master`). Copy the URL.

**3. Webhook on the notes repo.** `ParkerrDev/notes` → **Settings → Webhooks →
Add webhook**: Payload URL = the deploy-hook URL, Content type =
`application/json`, event = **Just the push event**.

That's it — pushes to `notes` now rebuild the site automatically.

Optional build-var overrides (defaults shown): `NOTES_REPO=ParkerrDev/notes`,
`NOTES_BRANCH=main`.

## Post format (vault `Blog/` folder)

```markdown
---
title: My post title
date: 2026-06-14
updated: 2026-06-15   # optional
slug: my-post         # optional; defaults to a slug of the filename
draft: false          # optional; true = skipped
---

Body in standard Markdown. Obsidian `![[image.png]]` embeds are copied into the
build and rewritten automatically.
```

Files whose name starts with `_` are ignored (handy for templates).

## Local build

```bash
# Convert posts from a local clone/working copy of the vault, then build:
node scripts/build-blog.mjs /path/to/Obsidian-Vault site
NOTES_TOKEN=<pat> ./build-zola.sh   # full build exactly as Cloudflare runs it
```
