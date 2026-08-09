# Résumé: built in the resume repo, published by this build

The résumé is designed and built in the **private**
[`ParkerrDev/resume`](https://github.com/ParkerrDev/resume) repo (`index.html` →
two PDFs). The PDFs are **not** committed to this repo. At build time Cloudflare
clones the resume repo with a read-only deploy key and copies its release
artifacts into `site/static/`, so `/resume` always serves that repo's current build.

Same model as the blog (see [BLOG.md](BLOG.md)): **nothing is committed to
parkerhunt.me in order to publish.**

```
resume/index.html ──npm run build──▶ resume.pdf + resume-ats.pdf
        │                                    │
        │                          AndrewHuntResume.pdf (release artifact)
        │ (push)                             │
        ▼                                    │
  resume repo ──webhook──▶ Cloudflare deploy hook
                                  │
                                  ▼
                    build-zola.sh:
                      1. git clone resume       (RESUME_DEPLOY_KEY)
                      2. node scripts/build-resume.mjs _resume site
                      3. zola build
```

Edit `index.html` in the resume repo → `npm run build` → `npm run verify` →
commit and push → the webhook triggers a rebuild → the new résumé is live in
about a minute.

## What gets published

| Published URL | Source file | For |
|---|---|---|
| `/AndrewHuntResume.pdf` | `AndrewHuntResume.pdf` | Humans. The pixel-exact Figma design. This is the URL the nav links and `/resume` embeds, it was already public, so the name is kept. |
| `/AndrewHuntResume-ATS.pdf` | `resume-ats.pdf` | Machines. Single-column, parser-safe. Linked from the `/resume` fallback; use it for job-portal uploads. |

`AndrewHuntResume.pdf` is **generated** by the resume repo's `build.mjs` (a copy
of `resume.pdf`), not hand-maintained, that is what keeps the published résumé
from drifting from the repo. To publish the ATS layout under the plain name
instead, flip the `PUBLISHED` constant in that repo's `build.mjs`.

## Files

| Path | Role |
|------|------|
| `scripts/build-resume.mjs` | Copies the PDF artifacts out of a resume-repo checkout into `site/static/`, validating each one is a real, non-truncated PDF |
| `build-zola.sh` | Clones the resume repo, runs the copier, then `zola build` |
| `site/templates/resume.html` | The `/resume` page, a full-bleed `<object>` embed with a download fallback |

`site/static/AndrewHuntResume.pdf`, `site/static/AndrewHuntResume-ATS.pdf` and
`_resume/` are git-ignored, they only exist during a build.

## How the build authenticates, already configured

| Where | What |
|---|---|
| `ParkerrDev/resume` → Deploy keys | `cloudflare-pages-parkerhunt-me`, **read-only** |
| Pages project `parkerhunt-me` → env vars | `RESUME_DEPLOY_KEY` (`secret_text`, production + preview) |
| `ParkerrDev/resume` → Webhooks | push → the Pages deploy hook |

A **deploy key** rather than a PAT: it is bound to this one repository by
construction and cannot later be widened, whereas a PAT's scope is only as narrow
as whoever edits it leaves it. It matters here because the resume repo also holds
client invoice data. GitHub also has no API for minting PATs, so the deploy key is
the only option that can be provisioned without a browser.

The variable holds the private key **base64-encoded**, because a Cloudflare build
variable is a single line and an OpenSSH key is not. `build-zola.sh` decodes it to
a `mktemp` file, uses it for one clone, and deletes it.

`build-zola.sh` pins GitHub's SSH host key rather than trusting on first use, the
build machine is new every time, so TOFU would mean blindly accepting whatever
answers on port 22, on every build. If GitHub ever rotates it, the current value
is in `https://api.github.com/meta`.

`RESUME_TOKEN` still works as a fallback: set it instead and the build clones over
HTTPS with a fine-grained PAT (`Contents: Read-only`, `ParkerrDev/resume` only).
`RESUME_DEPLOY_KEY` wins if both are set.

Optional overrides (defaults shown): `RESUME_REPO=ParkerrDev/resume`,
`RESUME_BRANCH=master`.

### Rotating the deploy key

```bash
ssh-keygen -t ed25519 -N "" -C "cloudflare-pages-parkerhunt-me" -f /tmp/k
gh api -X POST repos/ParkerrDev/resume/keys -f title=cloudflare-pages-parkerhunt-me \
        -f key="$(cat /tmp/k.pub)" -F read_only=true
# then set RESUME_DEPLOY_KEY to: openssl base64 -A -in /tmp/k
# and delete the old key id from the repo's Deploy keys settings
```

## Local build

No credential needed, point the build at your local checkout:

```bash
node scripts/build-resume.mjs ../resume site   # just the PDF copy step
RESUME_DIR=../resume ./build-zola.sh           # the whole build
```

`RESUME_DIR` symlinks a local working copy in place of the clone;
`build-resume.mjs` only reads from the source, so your checkout can't be
modified. With neither a credential nor a directory the build still succeeds,
`/resume` simply has no PDF, so the site builds standalone.

## Failure behaviour

No credential at all **warns** and skips (that is the local case).
But once a source is available, a missing or corrupt PDF **fails the build**:
`build-resume.mjs` exits non-zero and `set -e` stops `build-zola.sh`. A silent
miss would deploy a live site with a dead Résumé link, and the résumé is the one
page here whose whole job is to be handed to someone.
