window.onscroll = function () { scrollFunction() };

function scrollFunction() {
    if (document.documentElement.scrollTop > 15) {
        document.getElementById("back").classList.add("opaque");
    } else {
        document.getElementById("back").classList.remove("opaque");
    }
}