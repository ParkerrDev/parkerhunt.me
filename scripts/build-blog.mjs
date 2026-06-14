// Build-time bridge: Obsidian notes -> Zola content.
//
// Run by build-zola.sh on Cloudflare before `zola build`. Reads blog posts from
// a clone of the PRIVATE notes repo and generates Zola content + static images,
// so the blog ends up PRE-RENDERED (good SEO) like the rest of the site. Nothing
// here is committed to parkerhunt.me — it's regenerated on every build.
//
//   node scripts/build-blog.mjs <notes-dir> <site-dir>
//
// Obsidian post format (notes/Blog/*.md):
//   ---
//   title: ...        date: YYYY-MM-DD
//   slug: ...         (optional; defaults from filename)
//   updated: ...      (optional)   draft: true (optional; skipped)
//   ---
//   body...   (with optional Obsidian ![[image]] embeds)
//
// Files whose name starts with `_` are ignored (templates/scratch).

import {
  readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync,
} from 'node:fs';
import { join, basename } from 'node:path';

const [notesDir, siteDir] = process.argv.slice(2);
if (!notesDir || !siteDir) {
  console.error('usage: build-blog.mjs <notes-dir> <site-dir>');
  process.exit(1);
}

const BLOG_SRC = join(notesDir, 'Blog');
const CONTENT_OUT = join(siteDir, 'content', 'blog');
const IMG_OUT = join(siteDir, 'static', 'img', 'blog');

// Mirrors Custom Attachment Location's unsafe-character set so we can locate a
// note's image folder (`images/<sanitized note name>/`).
const SPECIAL_CHARS = /[#^[\]|*\\<>:?/]+/g;

function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const mm = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!mm) continue;
    let [, key, value] = mm;
    value = value.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    data[key.toLowerCase()] = value;
  }
  return { data, body: text.slice(m[0].length) };
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/\.md$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sanitizeFolder(noteName) {
  return String(noteName).replace(/\.md$/, '').trimEnd().replace(/[\s.]+$/, '').replace(SPECIAL_CHARS, '-');
}

// Rewrites Obsidian syntax to standard Markdown, copying referenced images into
// the site's static tree under a per-post folder.
function transformBody(body, noteName, slug) {
  const folder = sanitizeFolder(noteName);
  let copied = 0;
  body = body.replace(/!\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g, (_, file, alt) => {
    file = file.trim();
    const rel = file.includes('/') ? file.replace(/^\/+/, '') : `images/${folder}/${file}`;
    const src = join(notesDir, rel);
    const base = basename(rel);
    if (existsSync(src)) {
      const destDir = join(IMG_OUT, slug);
      mkdirSync(destDir, { recursive: true });
      copyFileSync(src, join(destDir, base));
      copied++;
      const url = `/img/blog/${encodeURIComponent(slug)}/${encodeURIComponent(base)}`;
      return `![${(alt || '').trim()}](${url})`;
    }
    console.warn(`  ! missing image for "${noteName}": ${rel}`);
    return `![${(alt || '').trim()}]()`;
  });
  // Plain wikilinks -> their display text (avoids dead links on the public site).
  body = body.replace(/\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g, (_, note, alt) => (alt || note).trim());
  return { body, copied };
}

function toml(value) {
  return JSON.stringify(String(value)); // valid TOML basic string for our cases
}

// --- generate --------------------------------------------------------------

rmSync(CONTENT_OUT, { recursive: true, force: true });
rmSync(IMG_OUT, { recursive: true, force: true });
mkdirSync(CONTENT_OUT, { recursive: true });

// Section config (was site/content/blog/_index.md before the blog went dynamic).
writeFileSync(
  join(CONTENT_OUT, '_index.md'),
  `+++\ntitle = "Blog posts"\nsort_by = "date"\ntemplate = "blogs.html"\npage_template = "blog-page.html"\n+++\n`
);

let published = 0;
const files = existsSync(BLOG_SRC)
  ? readdirSync(BLOG_SRC).filter((f) => f.endsWith('.md') && !f.startsWith('_'))
  : [];

for (const file of files) {
  const { data, body } = parseFrontmatter(readFileSync(join(BLOG_SRC, file), 'utf8'));
  if (data.draft === true || data.draft === 'true') {
    console.log(`  - skip draft: ${file}`);
    continue;
  }
  const noteName = file.replace(/\.md$/, '');
  const slug = data.slug ? slugify(data.slug) : slugify(noteName);
  const title = data.title || noteName;
  const { body: outBody, copied } = transformBody(body, noteName, slug);

  let fm = `+++\ntitle = ${toml(title)}\n`;
  if (data.date) fm += `date = ${data.date}\n`;
  if (data.updated) fm += `updated = ${data.updated}\n`;
  fm += `slug = ${toml(slug)}\n`;
  if (data.description) fm += `description = ${toml(data.description)}\n`;
  fm += `+++\n\n`;

  writeFileSync(join(CONTENT_OUT, `${slug}.md`), fm + outBody.replace(/^\n+/, ''));
  console.log(`  + ${file} -> content/blog/${slug}.md${copied ? ` (+${copied} image${copied > 1 ? 's' : ''})` : ''}`);
  published++;
}

console.log(`Blog: ${published} post(s) published from ${files.length} file(s).`);
