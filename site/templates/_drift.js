/* Drift rows. Inlined at the end of <body> by base.html, on every page, and a
   no-op on a page without a .marquee.

   A row moves slowly and forever. It stops while the pointer is over it or a
   link inside it has focus, and it can be dragged with a mouse, swiped on a
   touch screen, or pushed sideways with a trackpad. Let go of a drag and it
   coasts to its usual speed again.

   Markup (shared with the CSS fallback, which runs when this does not):
     .marquee[.mq-rev] > .mq-track > span (the cards) + span.mq-dup (a copy)

   The loop: the track is moved left by `offset`, kept within one set's width,
   so when a whole set has gone by the offset wraps to zero and the copy behind
   it is exactly where the first set was. A wide window can show more than two
   sets' worth of track, so copies are added until the seam can never come into
   view. A row whose set fits in the window without moving is not moved: it is
   centred and still (.mq-still), and drifts again if the window narrows.

   Reduced motion: the script does nothing and the CSS turns each row into an
   ordinary sideways scroller. */
(() => {
  "use strict";

  const rows = Array.from(document.querySelectorAll(".marquee"));
  if (rows.length === 0) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const SPEED = 32;        // px per second, the resting drift
  const MAX_COPIES = 12;   // copies of a set, a bound on a very wide window
  const DRAG_START = 6;    // px of travel before a press becomes a drag
  const COAST = 0.9;       // how much of a fling's speed is left after 100 ms
  const WHEEL_REST = 900;  // ms a row stays still after a trackpad push

  /** @type {Map<Element, object>} */
  const state = new Map();

  const gapOf = (el) => {
    const g = parseFloat(getComputedStyle(el).columnGap);
    return Number.isFinite(g) ? g : 0;
  };

  // The copies have the same links as the original, so a click on one still
  // goes somewhere; they are hidden from screen readers and the tab order so
  // nothing is read or tabbed through twice.
  const quiet = (set) => {
    set.classList.add("mq-dup");
    set.setAttribute("aria-hidden", "true");
    set.querySelectorAll("a, button, [tabindex]").forEach((el) => el.setAttribute("tabindex", "-1"));
  };

  const measure = (s) => {
    const sets = s.track.children;
    const first = sets[0];
    if (!first) return;
    const gap = gapOf(s.track);
    const setW = first.getBoundingClientRect().width;
    const view = s.row.clientWidth;
    s.span = setW + gap;
    // 48px of slack, the page gutter on both sides, so a still row never sits
    // flush against the window's edges.
    const still = setW + 48 <= view || s.span <= 0;
    s.row.classList.toggle("mq-still", still);
    s.still = still;
    if (still) { s.track.style.transform = ""; return; }
    // Enough copies that a whole window's width of track always follows the
    // first set, whatever the offset.
    const need = Math.min(MAX_COPIES, Math.max(2, Math.ceil(view / s.span) + 1));
    for (let i = sets.length; i < need; i += 1) {
      const copy = first.cloneNode(true);
      quiet(copy);
      s.track.appendChild(copy);
    }
    s.offset = ((s.offset % s.span) + s.span) % s.span;
  };

  const setup = (row) => {
    const track = row.querySelector(".mq-track");
    if (!track || !track.children[0]) return;
    const s = {
      row, track,
      dir: row.classList.contains("mq-rev") ? -1 : 1,
      offset: 0, span: 0, still: true, seen: false,
      hover: false, focus: false, wheelUntil: 0,
      press: null, dragging: false, vel: 0, suppressClick: false,
    };
    state.set(row, s);
    // Reverse rows start partway through, so the two rows of a pair do not
    // line their cards up.
    row.classList.add("mq-live");
    for (let i = 1; i < track.children.length; i += 1) quiet(track.children[i]);
    measure(s);
    if (s.dir < 0 && s.span > 0) s.offset = s.span * 0.37;

    row.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") s.hover = true; });
    row.addEventListener("pointerleave", () => { s.hover = false; });
    row.addEventListener("focusin", () => { s.focus = true; });
    row.addEventListener("focusout", (e) => { if (!row.contains(e.relatedTarget)) s.focus = false; });
    row.addEventListener("dragstart", (e) => e.preventDefault());

    row.addEventListener("pointerdown", (e) => {
      if (s.still || (e.pointerType === "mouse" && e.button !== 0)) return;
      s.press = { id: e.pointerId, x: e.clientX, y: e.clientY, at: s.offset, lastX: e.clientX, lastT: e.timeStamp };
      s.vel = 0;
    });
    row.addEventListener("pointermove", (e) => {
      const p = s.press;
      if (!p || p.id !== e.pointerId) return;
      const dx = e.clientX - p.x;
      if (!s.dragging) {
        // A mostly vertical swipe is the page scrolling, not a drag.
        if (Math.abs(dx) < DRAG_START || Math.abs(dx) < Math.abs(e.clientY - p.y)) return;
        s.dragging = true;
        row.classList.add("is-dragging");
        try { row.setPointerCapture(e.pointerId); } catch (_) { /* already released */ }
      }
      const dt = Math.max(1, e.timeStamp - p.lastT);
      s.vel = (-(e.clientX - p.lastX) / dt) * 1000;
      p.lastX = e.clientX;
      p.lastT = e.timeStamp;
      s.offset = p.at - dx;
    });
    const release = (e) => {
      const p = s.press;
      if (!p || p.id !== e.pointerId) return;
      if (s.dragging) s.suppressClick = true;
      s.press = null;
      s.dragging = false;
      row.classList.remove("is-dragging");
    };
    row.addEventListener("pointerup", release);
    row.addEventListener("pointercancel", release);
    // A drag that ends over a link must not also follow it.
    row.addEventListener("click", (e) => {
      if (!s.suppressClick) return;
      s.suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    }, true);

    row.addEventListener("wheel", (e) => {
      if (s.still || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      s.offset += e.deltaX;
      s.vel = 0;
      s.wheelUntil = performance.now() + WHEEL_REST;
    }, { passive: false });

    // Content that changes after load (the live GitHub cards) says so, and the
    // copies are rebuilt from the new first set.
    row.addEventListener("mq:changed", () => {
      const sets = Array.from(track.children);
      for (let i = sets.length - 1; i >= 1; i -= 1) sets[i].remove();
      measure(s);
    });
  };

  rows.forEach(setup);

  // Only rows on screen are moved: a page of eight rows costs what the one or
  // two in view cost.
  const io = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        entries.forEach((en) => { const s = state.get(en.target); if (s) s.seen = en.isIntersecting; });
      }, { rootMargin: "100px 0px" })
    : null;
  state.forEach((s) => { if (io) io.observe(s.row); else s.seen = true; });

  if ("ResizeObserver" in window) {
    const ro = new ResizeObserver((entries) => {
      entries.forEach((en) => {
        const row = en.target.closest(".marquee");
        const s = row && state.get(row);
        if (s) measure(s);
      });
    });
    state.forEach((s) => { ro.observe(s.row); if (s.track.children[0]) ro.observe(s.track.children[0]); });
  } else {
    window.addEventListener("resize", () => state.forEach(measure));
  }

  let last = 0;
  const frame = (t) => {
    // Clamp the step, so coming back to a tab that was asleep for a minute
    // does not jump every row a minute's worth along.
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 0;
    last = t;
    state.forEach((s) => {
      if (!s.seen || s.still || s.span <= 0) return;
      if (!s.dragging) {
        const resting = s.hover || s.focus || t < s.wheelUntil;
        // A fling decays toward zero; the drift itself is added on top unless
        // the row is being held still.
        s.vel *= Math.pow(COAST, dt * 10);
        if (Math.abs(s.vel) < 1) s.vel = 0;
        s.offset += (s.vel + (resting ? 0 : s.dir * SPEED)) * dt;
      }
      s.offset = ((s.offset % s.span) + s.span) % s.span;
      s.track.style.transform = `translate3d(${-s.offset.toFixed(2)}px,0,0)`;
    });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
})();
