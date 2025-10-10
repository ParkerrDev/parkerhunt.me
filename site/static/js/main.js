let clickCount = 0;
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
    16: {
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
    404: {
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

    // Reset styles
    img.style.filter = '';

    if (clickCount < 16) {
        let image = defaultImages[clickCount % defaultImages.length];
        img.src = image.src;
        img.srcset = image.srcset;
        img.sizes = image.sizes;
    } else if (clickCount >= 16 && clickCount < 1000) {
        document.getElementById('description').textContent = clickCount;

        const filterValue = 100 + 0.5 * (clickCount - 16);
        img.style.filter = `contrast(${filterValue}%) brightness(${filterValue}%) saturate(${filterValue}%)`;
    }

    if (specialImages[clickCount]) {
        let image = specialImages[clickCount];
        img.src = image.src;
        img.srcset = image.srcset;
        img.sizes = image.sizes;
    }

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
            img.src = specialImages[800];
            img.style.filter = `contrast(${(0.5 * (clickCount - 800))}%) brightness(${(0.5 * (clickCount - 800))}%) saturate(${(0.5 * (clickCount - 800))}%)`;
            document.getElementById('description').textContent = `${clickCount} at this point you're better off playing cookie clicker...`;
            break;
        case 911:
            document.getElementById('description').textContent = `9/11 - it was an inside job`;
            window.open("https://www.youtube.com/watch?v=St7ny38gLp4", '_blank');
            break;
        case 1000:
            img.src = specialImages[1000];
            document.getElementById('description').textContent = `${clickCount} absolute chad...`;
            img.style.filter = `contrast(${100 + (0.5 * (clickCount - 1000))}%) brightness(${100 + (0.5 * (clickCount - 1000))}%) saturate(${100 + (0.5 * (clickCount - 1000))}%)`;
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
