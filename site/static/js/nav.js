const backLink = document.getElementById("back");

if (backLink) {
    const fallbackPath = "/";

    // Keep a usable fallback when there is no browser history entry.
    if (document.referrer) {
        backLink.href = document.referrer;
    } else {
        backLink.href = fallbackPath;
    }

    backLink.addEventListener("click", function (event) {
        if (window.history.length > 1) {
            event.preventDefault();
            window.history.back();
        }
    });

    window.addEventListener("scroll", function () {
        if (document.documentElement.scrollTop > 15) {
            backLink.classList.add("opaque");
        } else {
            backLink.classList.remove("opaque");
        }
    });
}