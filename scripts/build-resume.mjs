// Build-time bridge: resume repo -> Zola static assets.
//
// Run by build-zola.sh on Cloudflare before `zola build`. Copies the PDF release
// artifacts out of a clone of the PRIVATE resume repo into this site's static
// tree, so /resume always serves that repo's current build. Nothing is committed
// to parkerhunt.me in order to publish a new resume — the same model the blog
// uses (see BLOG.md / RESUME.md).
//
//   node scripts/build-resume.mjs <resume-dir> <site-dir>
//
// Exits non-zero if an artifact is missing or isn't a real PDF. That is
// deliberate: a silent miss here ships a live site with a dead Résumé link, and
// the resume is the one page on this site that exists to be handed to someone.

import { copyFileSync, mkdirSync, openSync, readSync, closeSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [resumeDir, siteDir] = process.argv.slice(2);
if (!resumeDir || !siteDir) {
  console.error('usage: build-resume.mjs <resume-dir> <site-dir>');
  process.exit(1);
}

// [source in the resume repo, published name under site/static]
//
// `AndrewHuntResume.pdf` is the resume repo's release artifact, and which layout
// it carries is that repo's decision, not this one's — see PUBLISHED in its
// build.mjs. It is currently the single-column document. Keep the NAME whatever
// happens: it is the URL that is already out in the world.
const ASSETS = [
  ['AndrewHuntResume.pdf', 'AndrewHuntResume.pdf'],
  // Published under its own name as well. Since PUBLISHED was flipped these are
  // the same bytes twice, which is deliberate: /AndrewHuntResume-ATS.pdf has been
  // linked from job portals and must not start 404ing because the default
  // changed. Costs 154 KB on a deploy and nothing at all to a reader.
  ['resume-ats.pdf', 'AndrewHuntResume-ATS.pdf'],
];

const STATIC_OUT = join(siteDir, 'static');

// A truncated clone or an LFS pointer checked out as text both look like a file
// that exists, so check the magic bytes rather than just the path.
function assertPdf(path) {
  const { size } = statSync(path);
  if (size < 1024) throw new Error(`${path} is only ${size} bytes — not a real PDF`);
  const buf = Buffer.alloc(5);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, buf, 0, 5, 0);
  } finally {
    closeSync(fd);
  }
  if (buf.toString('latin1') !== '%PDF-') {
    throw new Error(`${path} does not start with %PDF- (got ${JSON.stringify(buf.toString('latin1'))})`);
  }
  return size;
}

if (!existsSync(resumeDir)) {
  console.error(`Resume: source directory not found: ${resumeDir}`);
  process.exit(1);
}

mkdirSync(STATIC_OUT, { recursive: true });

let published = 0;
for (const [from, to] of ASSETS) {
  const src = join(resumeDir, from);
  if (!existsSync(src)) {
    console.error(`Resume: missing artifact ${from} in ${resumeDir} — run \`npm run build\` in the resume repo and commit it.`);
    process.exit(1);
  }
  let size;
  try {
    size = assertPdf(src);
  } catch (err) {
    console.error(`Resume: ${err.message}`);
    process.exit(1);
  }
  copyFileSync(src, join(STATIC_OUT, to));
  console.log(`  + ${from} -> static/${to} (${Math.round(size / 1024)} KB)`);
  published++;
}

console.log(`Resume: ${published} artifact(s) published.`);
