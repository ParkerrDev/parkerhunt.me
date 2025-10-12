let clickCount = 0;
let lastImageChangeClick = 0; // Track when the image last changed

const defaultImages = [
    {
        src: '/imgs/webp/memoji-123.webp',
        srcset: '/imgs/webp/memoji-123.webp 123w, /imgs/webp/memoji-246.webp 246w, /imgs/webp/memoji-369.webp 369w, /imgs/webp/memoji-492.webp 492w, /imgs/webp/memoji-615.webp 615w',
        sizes: '246px'
    },
    {
        src: '/imgs/webp/bitmoji-123.webp',
        srcset: '/imgs/webp/bitmoji-123.webp 123w, /imgs/webp/bitmoji-246.webp 246w, /imgs/webp/bitmoji-369.webp 369w, /imgs/webp/bitmoji-492.webp 492w, /imgs/webp/bitmoji-615.webp 615w',
        sizes: '246px'
    },
    {
        src: '/imgs/webp/junior-123.webp',
        srcset: '/imgs/webp/junior-123.webp 123w, /imgs/webp/junior-246.webp 246w, /imgs/webp/junior-369.webp 369w, /imgs/webp/junior-492.webp 492w, /imgs/webp/junior-615.webp 615w',
        sizes: '246px'
    },
    {
        src: '/imgs/webp/freshman-123.webp',
        srcset: '/imgs/webp/freshman-123.webp 123w, /imgs/webp/freshman-246.webp 246w, /imgs/webp/freshman-369.webp 369w, /imgs/webp/freshman-492.webp 492w, /imgs/webp/freshman-615.webp 615w',
        sizes: '246px'
    },
];
const specialImages = {
    18: {
        src: '/imgs/webp/🤔.webp',
        srcset: '/imgs/webp/🤔.webp 123w',
        sizes: '123px'
    },
    200: {
        src: '/imgs/webp/😮.webp',
        srcset: '/imgs/webp/😮.webp 123w',
        sizes: '123px'
    },
    300: {
        src: '/imgs/webp/🤡.webp',
        srcset: '/imgs/webp/🤡.webp 123w',
        sizes: '123px'
    },
    405: {
        src: '/imgs/webp/👶.webp',
        srcset: '/imgs/webp/👶.webp 123w',
        sizes: '123px'
    },
    800: {
        src: '/imgs/webp/🍪.webp',
        srcset: '/imgs/webp/🍪.webp 123w',
        sizes: '123px'
    },
    1000: {
        src: '/imgs/webp/🧔.webp',
        srcset: '/imgs/webp/🧔.webp 123w',
        sizes: '123px'
    }
};

function handleClick() {
    clickCount += 1;
    const img = document.getElementById('memoji').querySelector('img');

    // Reset styles by default
    img.style.filter = '';

    // Check if this is a special image
    const isSpecialImage = specialImages[clickCount];

    if (isSpecialImage) {
        // Show special image and reset filter
        let image = specialImages[clickCount];
        img.src = image.src;
        img.srcset = image.srcset;
        img.sizes = image.sizes;
        lastImageChangeClick = clickCount; // Reset the burn effect counter
    } else if (clickCount < 16) {
        // Handle default images (clicks 0-15)
        let image = defaultImages[clickCount % defaultImages.length];
        img.src = image.src;
        img.srcset = image.srcset;
        img.sizes = image.sizes;
        if (clickCount % defaultImages.length === 0) {
            lastImageChangeClick = clickCount; // Reset when cycling through default images
        }
    }

    // Apply deep burn effect only when NOT on a special image AND in the right range
    if (!isSpecialImage && clickCount >= 16 && clickCount < 1000) {
        document.getElementById('description').textContent = clickCount;
        // Calculate from the last image change instead of from click 16
        const clicksSinceLastChange = clickCount - lastImageChangeClick;
        const filterValue = 100 + 0.5 * clicksSinceLastChange;
        img.style.filter = `contrast(${filterValue}%) brightness(${filterValue}%) saturate(${filterValue}%)`;
    }

    // Apply deep burn effect for post-1000 clicks (not on special image)
    if (!isSpecialImage && clickCount > 1000) {
        const clicksSinceLastChange = clickCount - lastImageChangeClick;
        const filterValue = 100 + 0.5 * clicksSinceLastChange;
        img.style.filter = `contrast(${filterValue}%) brightness(${filterValue}%) saturate(${filterValue}%)`;
    }

    // Handle special click events
    switch (clickCount) {
        case 21:
            window.open("https://www.youtube.com/watch?v=dQw4w9WgXcQ", '_blank');
            break;
        case 40:
            window.open("https://www.youtube.com/watch?v=uGvS0s0l2K4", '_blank');
            break;
        case 69:
            window.open("https://www.youtube.com/watch?v=SiAk2Q4a0lA", '_blank');
            break;
        case 800:
            document.getElementById('description').textContent = `${clickCount} at this point you're better off playing cookie clicker...`;
            break;
        case 911:
            document.getElementById('description').textContent = `9/11 - it was an inside job`;
            window.open("https://www.youtube.com/watch?v=St7ny38gLp4", '_blank');
            break;
        case 1000:
            document.getElementById('description').textContent = `${clickCount} absolute chad...`;
            break;
    }
}

window.onload = function () {
    const img = document.getElementById('memoji').querySelector('img');
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.transition = 'filter 0.3s ease, width 0.3s ease, height 0.3s ease';
}
