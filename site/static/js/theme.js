
const root = document.documentElement;
var theme = 0; // default white

function setTheme() {
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const shouldDark = minutes >= 15 * 60 || minutes < (4 * 60 + 30); // 3:00 PM -> 4:30 AM

    if (shouldDark && theme != 1) {
        root.style.setProperty('--background', getComputedStyle(root).getPropertyValue('--dark-background').trim());
        root.style.setProperty('--text-color', getComputedStyle(root).getPropertyValue('--dark-text-color').trim());
        theme = 1;
    } else if (!shouldDark && theme != 0) {
        root.style.setProperty('--background', getComputedStyle(root).getPropertyValue('--light-background').trim());
        root.style.setProperty('--text-color', getComputedStyle(root).getPropertyValue('--light-text-color').trim());
        theme = 0;
    }
}


window.onload = function () {
    setTheme();
    setInterval(() => {
        setTheme();
    }, 10000);
}
