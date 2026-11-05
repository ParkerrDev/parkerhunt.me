/* The catalogue search box. See _filter.html for what it does and why. */
(function () {
  var scope = document.querySelector("[data-findable]");
  if (!scope) return;
  var items = scope.querySelectorAll("[data-find]");
  if (items.length < 2) return;
  var haystack = [];
  function collect() {
    items = scope.querySelectorAll("[data-find]");
    haystack = [];
    for (var i = 0; i < items.length; i++) {
      haystack.push((items[i].dataset.find || items[i].textContent).toLowerCase());
    }
  }
  collect();

  // The box from the markup if the page wrote one, else a new one in its place.
  var wrap = scope.previousElementSibling;
  if (!wrap || !wrap.classList.contains("find")) {
    wrap = document.createElement("div");
    wrap.className = "find";
    var made = document.createElement("input");
    made.type = "search";
    made.placeholder = scope.dataset.findable || "Search";
    made.setAttribute("aria-label", made.placeholder);
    var roll = document.createElement("button");
    roll.type = "button";
    roll.className = "find-pick";
    roll.textContent = scope.dataset.random || "Random";
    wrap.appendChild(made);
    wrap.appendChild(roll);
    wrap.appendChild(document.createElement("output"));
    scope.parentNode.insertBefore(wrap, scope);
  }
  var input = wrap.querySelector("input");
  var dice = wrap.querySelector("button");
  var count = wrap.querySelector("output");
  var empty = document.createElement("p");
  empty.className = "find-none";
  empty.hidden = true;
  scope.parentNode.insertBefore(empty, scope.nextSibling);

  // The currently ringed card. Shared, because searching clears it and the
  // Random button moves it.
  var picked = null;

  function run() {
    var q = input.value.trim().toLowerCase();
    var shown = 0;
    for (var i = 0; i < items.length; i++) {
      var hit = !q || haystack[i].indexOf(q) !== -1;
      items[i].classList.toggle("is-hidden", !hit);
      if (hit) shown++;
    }
    count.textContent = q ? shown + " of " + items.length : "";
    count.classList.remove("is-pick");
    empty.hidden = shown !== 0;
    empty.textContent = shown === 0 ? 'Nothing matches "' + input.value.trim() + '".' : "";
    // Typing is a new context, so drop the old ring rather than leaving it to
    // reappear on a card the reader has stopped thinking about.
    if (picked) { picked.classList.remove("is-picked"); picked = null; }
  }

  // Filter what is here at once, then again when the rest of the list lands.
  input.addEventListener("input", function () {
    run();
    if (moreUrl) more().then(function () { if (input.value.trim()) run(); });
  });
  input.addEventListener("focus", function () { more(); });
  // Escape clears, which is what a search box is expected to do.
  input.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { input.value = ""; run(); }
  });

  /* ---- Random ---------------------------------------------------------- */

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function label(el) {
    /* .t-t is the title span on a catalogue chip, h3 the heading on an idea.
       Neither exists on a quote, and falling straight back to textContent is
       wrong there: the markup is minified, so an idea's number, name and tag
       run together as "44Old-school modelling agencybusiness". Prefer a single
       titling element, then the first paragraph, then the whole text. */
    var t = el.querySelector(".t-t, h3, h4") || el.querySelector("p") || el;
    var s = t.textContent.replace(/\s+/g, " ").trim();
    return s.length > 60 ? s.slice(0, 59) + "…" : s;
  }

  dice.addEventListener("click", function () { more().then(pick); });
  function pick() {
    var pool = [];
    for (var i = 0; i < items.length; i++) {
      if (!items[i].classList.contains("is-hidden")) pool.push(items[i]);
    }
    if (!pool.length) { count.textContent = "nothing to pick from"; return; }

    var n = Math.floor(Math.random() * pool.length);
    /* Never the same one twice running. With 674 films this would not matter;
       with three left after a search it is the difference between a button
       that works and one that looks broken. Stepping to the neighbour rather
       than redrawing keeps this O(1) and, at a pool of two, alternates. */
    if (pool.length > 1 && pool[n] === picked) n = (n + 1) % pool.length;
    var choice = pool[n];

    if (picked) picked.classList.remove("is-picked");
    // Reflow between remove and add, or re-picking the same card after a
    // search does not restart the pulse.
    void choice.offsetWidth;
    choice.classList.add("is-picked");
    picked = choice;

    choice.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    /* Focus the card's own link so the keyboard lands on it and Enter opens
       the film, and so screen readers move with the ring rather than being
       told about a card the focus is nowhere near. */
    var link = choice.querySelector("a[href]"), target = link || choice;
    if (!link) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });

    count.textContent = label(choice);
    count.classList.add("is-pick");
  }

  /* ---- The rest of the list (data-more) -------------------------------- */
  var moreUrl = scope.dataset.more || null;
  var moreLink = document.querySelector("[data-more-link]");
  var moreWait = null;
  // One promise for every caller. It always resolves: on a failure the list
  // is just shorter, and the next caller tries again.
  function more() {
    if (!moreUrl) return Promise.resolve();
    if (!moreWait) {
      moreWait = fetch(moreUrl).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      }).then(function (html) {
        var src = new DOMParser().parseFromString(html, "text/html").querySelector("[data-findable]");
        if (!src) throw new Error("no list at " + moreUrl);
        // A parsed document is inert, so nothing in it has loaded yet. Its
        // first two posters are eager, for a reader who opens that page;
        // here they land far below the fold, so they turn lazy before they
        // move (an eager image starts loading the moment it is adopted).
        // Every poster then starts once it is in this page and near the screen.
        var eager = src.querySelectorAll("img:not([loading])");
        for (var e = 0; e < eager.length; e++) {
          eager[e].setAttribute("loading", "lazy");
          eager[e].removeAttribute("fetchpriority");
        }
        var frag = document.createDocumentFragment();
        while (src.firstChild) frag.appendChild(src.firstChild);
        scope.appendChild(frag);
        moreUrl = null;
        if (moreLink) moreLink.parentNode.removeChild(moreLink);
        collect();
      }).catch(function () { moreWait = null; });
    }
    return moreWait;
  }
  if (moreUrl) {
    var cues = ["scroll", "pointerdown", "keydown", "touchstart"];
    var near = null;
    var go = function () {
      for (var c = 0; c < cues.length; c++) removeEventListener(cues[c], go, true);
      if (near) near.disconnect();
      more();
    };
    for (var c = 0; c < cues.length; c++) addEventListener(cues[c], go, { capture: true, passive: true });
    if (moreLink) {
      // The link is a button while the script is here.
      moreLink.addEventListener("click", function (e) { e.preventDefault(); go(); });
      if ("IntersectionObserver" in window) {
        near = new IntersectionObserver(function (es) { if (es[0].isIntersecting) go(); }, { rootMargin: "150% 0px" });
        near.observe(moreLink);
      }
    }
  }
})();
