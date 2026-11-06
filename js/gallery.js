(() => {
    const viewer = document.getElementById("storyViewer");
    const triggers = [...document.querySelectorAll(".clinic-story")];
    if (!viewer || !triggers.length) return;

    const image = document.getElementById("storyViewerImage");
    const kicker = document.getElementById("storyViewerKicker");
    const title = document.getElementById("storyViewerTitle");
    const caption = document.getElementById("storyViewerCaption");
    const progress = document.getElementById("storyProgress");
    const count = document.getElementById("storyViewerCount");
    const pauseButton = document.getElementById("storyPause");
    const STORY_DURATION = 6500;
    let currentIndex = 0;
    let timer = null;
    let paused = false;
    let activeTrigger = null;
    let touchStartX = 0;

    triggers.forEach(button => button.setAttribute("aria-haspopup", "dialog"));

    function renderProgress() {
        progress.innerHTML = triggers.map((_, index) => {
            const state = index < currentIndex ? " is-complete" : index === currentIndex ? " is-active" : "";
            return `<span class="story-progress-segment${state}"><i></i></span>`;
        }).join("");
        const activeBar = progress.querySelector(".is-active");
        if (activeBar) activeBar.style.setProperty("--story-duration", `${STORY_DURATION}ms`);
    }

    function scheduleAdvance() {
        window.clearTimeout(timer);
        if (!paused) timer = window.setTimeout(() => showStory(currentIndex + 1), STORY_DURATION);
    }

    function updatePauseButton() {
        pauseButton.setAttribute("aria-pressed", String(paused));
        pauseButton.setAttribute("aria-label", paused ? "استئناف عرض القصص" : "إيقاف عرض القصص مؤقتًا");
        pauseButton.innerHTML = paused
            ? '<i class="fa-solid fa-play" aria-hidden="true"></i>'
            : '<i class="fa-solid fa-pause" aria-hidden="true"></i>';
    }

    function showStory(index, focusClose = false) {
        currentIndex = (index + triggers.length) % triggers.length;
        const source = triggers[currentIndex].dataset;
        image.src = source.image;
        image.alt = source.alt || "ذكرى من العيادة";
        kicker.textContent = source.kicker || "";
        title.textContent = source.title || "";
        caption.textContent = source.caption || "";
        count.textContent = `${currentIndex + 1} / ${triggers.length}`;
        renderProgress();
        triggers.forEach((button, buttonIndex) => button.classList.toggle("is-current", buttonIndex === currentIndex));
        scheduleAdvance();
        if (focusClose) document.querySelector(".story-viewer-close").focus();
    }

    function openStory(index, trigger) {
        activeTrigger = trigger || triggers[index];
        window.pushInSiteOverlay?.("story");
        paused = false;
        updatePauseButton();
        viewer.classList.add("is-open");
        viewer.setAttribute("aria-hidden", "false");
        document.body.classList.add("story-viewer-open");
        showStory(index, true);
    }

    function closeStory(fromHistory = false) {
        if (!fromHistory && history.state?.clinicOverlay === "story") {
            history.back();
            return;
        }
        window.clearTimeout(timer);
        viewer.classList.remove("is-open");
        viewer.setAttribute("aria-hidden", "true");
        document.body.classList.remove("story-viewer-open");
        if (activeTrigger) activeTrigger.focus();
    }

    function goNext() { paused = false; updatePauseButton(); viewer.classList.remove("is-paused"); showStory(currentIndex + 1); }
    function goPrevious() { paused = false; updatePauseButton(); viewer.classList.remove("is-paused"); showStory(currentIndex - 1); }

    triggers.forEach((button, index) => button.addEventListener("click", () => openStory(index, button)));
    viewer.querySelectorAll("[data-story-close]").forEach(button => button.addEventListener("click", closeStory));
    document.getElementById("storyNext").addEventListener("click", goNext);
    document.getElementById("storyPrev").addEventListener("click", goPrevious);
    pauseButton.addEventListener("click", () => {
        paused = !paused;
        viewer.classList.toggle("is-paused", paused);
        updatePauseButton();
        if (paused) window.clearTimeout(timer);
        else scheduleAdvance();
    });

    document.addEventListener("keydown", event => {
        if (!viewer.classList.contains("is-open")) return;
        if (event.key === "Escape") closeStory();
        if (event.key === "ArrowLeft") goNext();
        if (event.key === "ArrowRight") goPrevious();
        if (event.key === "Tab") {
            const focusable = [...viewer.querySelectorAll('button:not([disabled]):not([tabindex="-1"])')];
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    });

    viewer.addEventListener("touchstart", event => {
        if (event.target.closest("button")) return;
        touchStartX = event.changedTouches[0].clientX;
    }, { passive: true });
    viewer.addEventListener("touchend", event => {
        if (!touchStartX || event.target.closest("button")) return;
        const distance = event.changedTouches[0].clientX - touchStartX;
        touchStartX = 0;
        if (Math.abs(distance) < 48) return;
        if (distance < 0) goNext();
        else goPrevious();
    }, { passive: true });

    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) entry.target.classList.add("is-visible");
        });
    }, { threshold: 0.15 });
    document.querySelectorAll(".reveal-on-scroll").forEach(element => observer.observe(element));
    document.documentElement.dataset.galleryReady = "true";
    document.documentElement.dataset.galleryBound = "true";
    window.openClinicStory = openStory;
    window.closeClinicStory = closeStory;
})();

