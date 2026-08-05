# Blog: `site/content/blog/` is an Obsidian vault

Posts live in this repo, in the folder Zola renders them from. Open
`site/content/blog/` as a vault in Obsidian and the file you are editing **is**
the file Zola builds. There is no converter, no second repo, and no token.

```
Obsidian ──edits──▶ site/content/blog/my-post.md ──git push──▶ Cloudflare ──▶ zola build
```

Write a post → commit and push this repo → live in about a minute.

## Why it works this way

It used to live in the private `notes` vault and get converted at build time. That
bought Obsidian-native syntax (`![[embeds]]`, YAML frontmatter) at the cost of a
140-line converter, a second repo, a read-only PAT, a webhook, and two markdown
dialects that could disagree. Writing Zola's frontmatter directly costs a `+++`
instead of a `---` and buys the deletion of all of it.

It also decouples the two vaults for a more important reason: the `notes` repo is
now **encrypted at rest**, which is only possible because no build needs to read
it in plaintext any more.

## Post format

```markdown
+++
title = "My post title"
date = 2026-07-29
updated = 2026-07-30   # optional; renders an "Updated …" line
draft = true           # optional; excluded from the build entirely
+++

Body in standard Markdown.
```

TOML, so strings are quoted and dates are bare. The filename is the URL:
`my-post.md` → `/blog/my-post/`. Rename the file to change the URL.

**`draft = true` is the safety catch.** A draft is not rendered, not linked, and
not in the feed — but the markdown is still committed to a **public** repo, so it
is readable by anyone who looks. Draft means unpublished, not private.

## Images

Make the post a folder and put images beside it:

```
site/content/blog/my-post/
  index.md
  diagram.png
```

`![Diagram](diagram.png)` then resolves in both Obsidian's preview and Zola's
output, and the URL stays `/blog/my-post/`. The tracked
`.obsidian/app.json` sets `useMarkdownLinks` and `attachmentFolderPath: "./"` so
Obsidian writes exactly that form instead of `![[wikilinks]]`, which Zola cannot
render. Don't change those two settings — they are what keeps the one file
readable by both tools.

## Obsidian setup

Open Obsidian → **Open folder as vault** → `site/content/blog`. Two settings
travel with the repo (`.obsidian/app.json`, `appearance.json`); everything else
under `.obsidian/` is git-ignored per-device state.

Publishing is a normal commit in this repo. The Obsidian Git plugin is
deliberately **not** configured here — the vault is a subdirectory of a repo whose
other files are templates and build scripts, and a note-taking plugin should not
be the thing that commits them. `git commit && git push`, or your editor.

## Local preview

```bash
cd site && zola serve      # live reload at http://127.0.0.1:1111
zola build --drafts        # include drafts to check one before publishing
```
