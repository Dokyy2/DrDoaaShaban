(() => {
    const modal = document.getElementById("albumModal");
    if (!modal) return;
    document.documentElement.dataset.galleryReady = "true";

    const pages = [...modal.querySelectorAll(".album-page")];
    const currentLabel = document.getElementById("albumCurrent");
    const totalLabel = document.getElementById("albumTotal");
    let currentPage = 0;
    let locked = false;

    totalLabel.textContent = String(pages.length);

    function showPage(nextIndex) {
        if (locked || nextIndex === currentPage) return;
        locked = true;

        const oldPage = pages[currentPage];
        const normalized = (nextIndex + pages.length) % pages.length;
        oldPage.classList.add("is-turning");

        window.setTimeout(() => {
            oldPage.classList.remove("is-active", "is-turning");
            currentPage = normalized;
            pages[currentPage].classList.add("is-active");
            currentLabel.textContent = String(currentPage + 1);
            locked = false;
        }, 360);
    }

    function openAlbum() {
        modal.classList.add("is-open");
        modal.setAttribute("aria-hidden", "false");
        document.body.classList.add("album-open");
        modal.querySelector(".album-close").focus();
    }

    function closeAlbum() {
        modal.classList.remove("is-open");
        modal.setAttribute("aria-hidden", "true");
        document.body.classList.remove("album-open");
    }

    window.openStoryAlbum = openAlbum;
    window.closeStoryAlbum = closeAlbum;

    document.addEventListener("click", event => {
        if (event.target.closest("[data-open-album]")) openAlbum();
        if (event.target.closest("[data-close-album]")) closeAlbum();
    });
    modal.querySelector("[data-album-next]").addEventListener("click", () => showPage(currentPage + 1));
    modal.querySelector("[data-album-prev]").addEventListener("click", () => showPage(currentPage - 1));

    document.addEventListener("keydown", event => {
        if (!modal.classList.contains("is-open")) return;
        if (event.key === "Escape") closeAlbum();
        if (event.key === "ArrowLeft") showPage(currentPage + 1);
        if (event.key === "ArrowRight") showPage(currentPage - 1);
    });

    let touchStartX = 0;
    modal.addEventListener("touchstart", event => {
        touchStartX = event.changedTouches[0].clientX;
    }, { passive: true });
    modal.addEventListener("touchend", event => {
        const distance = event.changedTouches[0].clientX - touchStartX;
        if (Math.abs(distance) < 50) return;
        showPage(currentPage + (distance < 0 ? 1 : -1));
    }, { passive: true });

    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) entry.target.classList.add("is-visible");
        });
    }, { threshold: 0.18 });
    document.querySelectorAll(".reveal-on-scroll").forEach(element => observer.observe(element));
    document.documentElement.dataset.galleryBound = "true";
})();
