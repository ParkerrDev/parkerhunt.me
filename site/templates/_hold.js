/* See _hold.html. */
(function () {
  if (!("MutationObserver" in window)) return;
  var SEL = 'img[loading="lazy"]';
  var wide = window.matchMedia && matchMedia("(min-width: 45rem)").matches;

  function hold(img) {
    if (wide && img.hasAttribute("data-wide-eager")) return;
    // Once only: a drift row's copy of a held card already has the placeholder.
    if (img.hasAttribute("data-held-src") || img.hasAttribute("data-held-srcset")) return;
    var set = img.getAttribute("srcset");
    var src = img.getAttribute("src");
    if (set !== null) { img.setAttribute("data-held-srcset", set); img.removeAttribute("srcset"); }
    if (src === null) return;
    img.setAttribute("data-held-src", src);
    var w = img.getAttribute("width");
    var h = img.getAttribute("height");
    if (w && h) {
      img.setAttribute("src", "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='" +
        encodeURIComponent(w) + "' height='" + encodeURIComponent(h) + "'/%3E");
    } else {
      img.removeAttribute("src");
    }
  }

  function seen(recs) {
    for (var i = 0; i < recs.length; i++) {
      var added = recs[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var n = added[j];
        if (n.nodeType !== 1) continue;
        if (n.matches(SEL)) { hold(n); continue; }
        var inner = n.querySelectorAll(SEL);
        for (var k = 0; k < inner.length; k++) hold(inner[k]);
      }
    }
  }

  var watch = new MutationObserver(seen);
  watch.observe(document.documentElement, { childList: true, subtree: true });
  // Parsing is over at DOMContentLoaded, so every image in the markup has been
  // seen; what scripts add later is left alone.
  document.addEventListener("DOMContentLoaded", function () {
    seen(watch.takeRecords());
    watch.disconnect();
    setTimeout(release, 2000);
  });

  var done = false;
  function release() {
    if (done) return;
    done = true;
    var held = document.querySelectorAll("img[data-held-src], img[data-held-srcset]");
    for (var i = 0; i < held.length; i++) {
      var img = held[i];
      var set = img.getAttribute("data-held-srcset");
      var src = img.getAttribute("data-held-src");
      if (set !== null) { img.setAttribute("srcset", set); img.removeAttribute("data-held-srcset"); }
      if (src !== null) { img.setAttribute("src", src); img.removeAttribute("data-held-src"); }
    }
  }
  // After the frame that paints the first images, not during it.
  addEventListener("load", function () {
    requestAnimationFrame(function () { setTimeout(release, 0); });
  });
})();
