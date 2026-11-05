/* Drift rows. Inlined at the end of <body> by base.html, through the drift
   block of each page that has rows (_drift.html), and a no-op on a page
   without a .marquee.

   A row moves slowly and forever. It stops while the pointer is over it or a
   link inside it has focus, and it can be dragged with a mouse, swiped on a
   touch screen, or pushed sideways with a trackpad. Let go of a drag and it
   coasts to its usual speed again.

   Markup: .marquee[.mq-rev] > .mq-track > span (the cards), once. Without
   this script a row is an ordinary sideways scroller, so the page ships each
   set of cards one time and the copies a loop needs are made here.

   The loop: the track is moved left by `offset`, kept within one set's width,
   so when a whole set has gone by the offset wraps to zero and the copy behind
   it is exactly where the first set was. Copies are added until the seam can
   never come into view. A row whose set fits in the window is not moved: it is
   centred and still (.mq-still), and drifts again if the window narrows. The
   CSS centres a row that fits before this runs, so taking a row over moves
   nothing on screen.

   Lazy: nothing is measured, copied or listened to until a row comes within a
   screen of the viewport, so a long page pays at load only for the rows near
   the top. Measuring happens in observer callbacks, where layout is already
   done, and every row's reads come before any row's writes.

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

  // Read: the set's width and the window's. No writes, so measuring every
  // row in a batch costs one layout, not one per row.
  const read = (s) => {
    const first = s.track.children[0];
    if (!first) return null;
    return { setW: first.getBoundingClientRect().width, gap: gapOf(s.track), view: s.row.clientWidth };
  };

  // Write: still or moving, and enough copies that a whole window's width of
  // track always follows the first set, whatever the offset.
  const apply = (s, m) => {
    if (!m) return;
    s.span = m.setW + m.gap;
    // 48px of slack, the page gutter on both sides, so a still row never sits
    // flush against the window's edges.
    const still = m.setW + 48 <= m.view || s.span <= 0;
    s.row.classList.toggle("mq-still", still);
    s.still = still;
    if (still) { s.track.style.transform = ""; return; }
    const sets = s.track.children;
    const need = Math.min(MAX_COPIES, Math.max(2, Math.ceil(m.view / s.span) + 1));
    for (let i = sets.length; i < need; i += 1) {
      const copy = sets[0].cloneNode(true);
      quiet(copy);
      s.track.appendChild(copy);
    }
    s.offset = ((s.offset % s.span) + s.span) % s.span;
  };

  const measureAll = (list) => {
    const ms = list.map(read);
    list.forEach((s, i) => apply(s, ms[i]));
  };

  // Takes a row over: state and listeners. Measuring is the caller's, so a
  // batch of rows can be read together first.
  const setup = (row) => {
    const track = row.querySelector(".mq-track");
    if (!track || !track.children[0]) return null;
    const s = {
      row, track,
      dir: row.classList.contains("mq-rev") ? -1 : 1,
      offset: 0, span: 0, still: true, seen: true,
      hover: false, focus: false, wheelUntil: 0,
      press: null, dragging: false, vel: 0, suppressClick: false,
    };
    state.set(row, s);

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
      measureAll([s]);
      if (ro && track.children[0]) ro.observe(track.children[0]);
    });
    return s;
  };

  // A row is resized (a narrower window, or new content) and is measured again.
  const ro = "ResizeObserver" in window
    ? new ResizeObserver((entries) => {
        const hit = new Set();
        entries.forEach((en) => {
          const row = en.target.closest(".marquee");
          const s = row && state.get(row);
          if (s) hit.add(s);
        });
        measureAll(Array.from(hit));
      })
    : null;

  // Which taken-over rows are on screen; set up with the observers below.
  let vis = null;

  // Taking a row over, the first time it nears the viewport.
  const takeOver = (list) => {
    const fresh = list.map(setup).filter(Boolean);
    measureAll(fresh);
    fresh.forEach((s) => {
      // Reverse rows start partway through, so the two rows of a pair do not
      // line their cards up.
      if (s.dir < 0 && s.span > 0) s.offset = s.span * 0.37;
      s.row.classList.add("mq-live");
      if (ro) { ro.observe(s.row); ro.observe(s.track.children[0]); }
      // Observed from now, so its first report is where the row is now. A row
      // taken over a screen ahead is off screen and must not move yet.
      if (vis) { s.seen = false; vis.observe(s.row); }
    });
  };

  // Two observers: a wide one that takes rows over a screen ahead of the
  // viewport, and a narrow one that says which rows are on screen, since only
  // those are moved. A page of twelve rows costs what the two in view cost.
  if ("IntersectionObserver" in window) {
    const near = new IntersectionObserver((entries) => {
      const list = [];
      entries.forEach((en) => {
        if (!en.isIntersecting || state.has(en.target)) return;
        near.unobserve(en.target);
        list.push(en.target);
      });
      if (list.length) takeOver(list);
    }, { rootMargin: "100% 0px" });
    vis = new IntersectionObserver((entries) => {
      entries.forEach((en) => { const s = state.get(en.target); if (s) s.seen = en.isIntersecting; });
    }, { rootMargin: "100px 0px" });
    rows.forEach((row) => near.observe(row));
  } else {
    takeOver(rows);
    window.addEventListener("resize", () => measureAll(Array.from(state.values())));
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
