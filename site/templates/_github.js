/* The Code row, live. Inlined by index.html only.

   The cards are rendered at build time from site/data/github.json, so the row
   is complete before this runs and stays complete if it never does. This
   asks GitHub's public API for the same list, filtered and ordered the way
   scripts/fetch-github.mjs filters and orders the snapshot, and redraws the
   row from the answer: new repositories, new descriptions, today's stars.

   GitHub cannot be put in an iframe (it sends X-Frame-Options: deny), so a
   card drawn from its API is the closest a page can get to embedding it.

   Unauthenticated, so there is no key to leak, and the API allows 60 calls an
   hour per visitor's IP. The answer is kept in sessionStorage for half an
   hour, so moving around the site does not spend them. Any failure, a
   timeout, a rate limit, a blocked request, leaves the snapshot showing.

   Text from the API is only ever set with textContent, never as HTML. */
(() => {
  "use strict";

  const row = document.querySelector("[data-gh-user]");
  if (!row || !window.fetch) return;
  const user = row.getAttribute("data-gh-user") || "";
  if (!/^[A-Za-z0-9-]{1,39}$/.test(user)) return;

  const KEY = `gh-repos:${user}`;
  const TTL = 30 * 60 * 1000;
  const TIMEOUT = 8000;
  const MAX_REPOS = 100;

  const status = document.querySelector("[data-gh-status]");
  const icons = document.getElementById("gh-icons");

  // Language colours: GitHub's own, as the build knows them, plus whatever
  // the snapshot's cards already carry.
  let colors = {};
  try { colors = JSON.parse(row.getAttribute("data-gh-colors") || "{}"); } catch (_) { colors = {}; }
  row.querySelectorAll("[data-lang]").forEach((el) => {
    const lang = el.getAttribute("data-lang");
    const dot = el.style.getPropertyValue("--dot");
    if (lang && dot && !colors[lang]) colors[lang] = dot.trim();
  });

  const icon = (name) => {
    const t = icons && icons.content.querySelector(`[data-icon="${name}"]`);
    return t ? t.cloneNode(true) : document.createTextNode("");
  };

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  const rtf = "RelativeTimeFormat" in Intl ? new Intl.RelativeTimeFormat("en", { numeric: "auto" }) : null;
  const ago = (iso) => {
    const then = Date.parse(iso);
    if (!Number.isFinite(then)) return "";
    const days = Math.round((then - Date.now()) / 86400000);
    if (!rtf) return `Updated ${iso.slice(0, 10)}`;
    if (days > -1) return "Updated today";
    if (days > -31) return `Updated ${rtf.format(days, "day")}`;
    if (days > -365) return `Updated ${rtf.format(Math.round(days / 30.4), "month")}`;
    return `Updated ${rtf.format(Math.round(days / 365), "year")}`;
  };

  const card = (r) => {
    const a = el("a", "rc");
    // Only github.com links: the URL comes from the API, and a card must
    // never be turned into a link to somewhere else.
    a.href = /^https:\/\/github\.com\//.test(r.url) ? r.url : `https://github.com/${user}`;
    a.target = "_blank";
    a.rel = "noopener";
    const top = el("span", "rc-top");
    top.append(icon("github"), el("span", "rc-name", r.name));
    a.append(top, el("p", "rc-desc", r.description));
    const meta = el("span", "rc-meta");
    if (r.language) {
      const s = el("span");
      const dot = el("i", "rc-dot");
      const c = colors[r.language];
      if (c && /^#[0-9a-fA-F]{3,8}$/.test(c)) dot.style.setProperty("--dot", c);
      s.append(dot, document.createTextNode(r.language));
      meta.append(s);
    }
    if (r.stars > 0) { const s = el("span"); s.append(icon("star"), document.createTextNode(String(r.stars))); meta.append(s); }
    if (r.forks > 0) { const s = el("span"); s.append(icon("fork"), document.createTextNode(String(r.forks))); meta.append(s); }
    if (r.updated) meta.append(el("span", "", ago(r.updated)));
    a.append(meta);
    return a;
  };

  const render = (repos) => {
    const track = row.querySelector(".mq-track");
    const first = track && track.children[0];
    if (!first || repos.length === 0) return;
    const frag = document.createDocumentFragment();
    repos.slice(0, MAX_REPOS).forEach((r) => frag.append(card(r)));
    first.replaceChildren(frag);
    // The copies, the CSS fallback's and the drift script's, are rebuilt from
    // the new first set.
    for (let i = track.children.length - 1; i >= 1; i -= 1) {
      if (!row.classList.contains("mq-live")) {
        const copy = first.cloneNode(true);
        copy.classList.add("mq-dup");
        copy.setAttribute("aria-hidden", "true");
        copy.querySelectorAll("a").forEach((n) => n.setAttribute("tabindex", "-1"));
        track.children[i].replaceWith(copy);
      }
    }
    row.dispatchEvent(new CustomEvent("mq:changed"));
    if (status) {
      status.replaceChildren(el("span", "pulse"), document.createTextNode(` Live from GitHub · ${repos.length} public repositories`));
      status.classList.add("is-live");
    }
  };

  const shape = (raw) => raw
    .filter((r) => r && !r.fork && !r.archived && !r.private && typeof r.name === "string")
    .map((r) => ({
      name: r.name,
      url: String(r.html_url || ""),
      description: String(r.description || ""),
      language: String(r.language || ""),
      stars: Number(r.stargazers_count) || 0,
      forks: Number(r.forks_count) || 0,
      updated: String(r.pushed_at || r.updated_at || ""),
    }));

  let cached = null;
  try {
    const c = JSON.parse(sessionStorage.getItem(KEY) || "null");
    if (c && Array.isArray(c.repos) && Date.now() - c.at < TTL) cached = c.repos;
  } catch (_) { cached = null; }
  if (cached) { render(cached); return; }

  const ctl = "AbortController" in window ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT) : 0;
  fetch(`https://api.github.com/users/${user}/repos?per_page=100&sort=updated&type=owner`, {
    headers: { Accept: "application/vnd.github+json" },
    signal: ctl ? ctl.signal : undefined,
    credentials: "omit",
    referrerPolicy: "no-referrer",
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((raw) => {
      if (!Array.isArray(raw)) return;
      const repos = shape(raw);
      if (repos.length === 0) return;
      try { sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), repos })); } catch (_) { /* storage off */ }
      render(repos);
    })
    .catch(() => { /* the snapshot stays */ })
    .finally(() => clearTimeout(timer));
})();
