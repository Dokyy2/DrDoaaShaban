(() => {
    const isLocalPreview = location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname);
    const legacyRenderBookingStart = window.renderBookingStart;
    const legacyRenderBookingForm = window.renderBookingForm;
    const legacyRenderPregnancyCalc = window.renderPregnancyCalc;

    window.startRandomFlips = () => {};
    window.visitCard = (type, icon, label, special = false) => {
        const desc = visitDesc[currentLang][type];
        const familyClass = type === "contacts" ? "family-card" : "";
        return `<button class="visit-option ${special ? "special" : ""} ${familyClass}" type="button" onclick="selectVisit('${type}')">
            <span class="visit-option-icon"><i class="fa-solid ${icon}" aria-hidden="true"></i></span>
            <span class="visit-option-copy"><strong>${label}</strong><span>${desc}</span></span>
            <span class="visit-option-arrow" aria-hidden="true"><i class="fa-solid fa-arrow-left"></i></span>
        </button>`;
    };

    function addStepCue(container, text) {
        const head = container?.querySelector(".booking-head");
        if (!head || head.querySelector(".booking-step-kicker")) return;
        const cue = document.createElement("span");
        cue.className = "booking-step-kicker";
        cue.textContent = text;
        head.prepend(cue);
    }

    window.renderBookingStart = (...args) => {
        legacyRenderBookingStart?.(...args);
        const panel = document.querySelector("#bookingArea .booking-panel");
        addStepCue(panel, currentLang === "ar" ? "خطوة ١ · اختاري الخدمة" : "STEP 1 · CHOOSE A SERVICE");
        if (panel && !panel.querySelector(".booking-reassurance")) {
            const note = document.createElement("div");
            note.className = "booking-reassurance";
            note.innerHTML = `<span aria-hidden="true">💗</span>${currentLang === "ar" ? "اختاري الخدمة المناسبة، وبعدها اكتبي بيانات التواصل الضرورية فقط. العيادة هتتواصل معاكي لتأكيد التفاصيل." : "Choose a service, then share only the contact details needed. The clinic will reach out to confirm."}`;
            panel.appendChild(note);
        }
    };

    window.renderBookingForm = (...args) => {
        legacyRenderBookingForm?.(...args);
        addStepCue(document.querySelector("#bookingArea .booking-panel"), currentLang === "ar" ? "خطوة ٢ · بياناتك بأمان" : "STEP 2 · YOUR DETAILS");
    };
    window.renderPregnancyCalc = (...args) => {
        legacyRenderPregnancyCalc?.(...args);
        addStepCue(document.querySelector("#bookingArea .booking-panel"), currentLang === "ar" ? "خطوة ٢ · بياناتك بأمان" : "STEP 2 · YOUR DETAILS");
    };

    window.showSuccess = ((legacy) => (...args) => { legacy(...args); decorateSuccess(); })(window.showSuccess);
    window.showBirthSuccess = ((legacy) => (...args) => { legacy(...args); decorateSuccess(); })(window.showBirthSuccess);
    if (window.showFamilyMember) window.showFamilyMember = ((legacy) => (...args) => { legacy(...args); decorateSuccess(); })(window.showFamilyMember);
    window.showSoftAlert = ((legacy) => (...args) => {
        legacy(...args);
        const alert = document.getElementById("softAlert");
        alert?.classList.remove("notification-arrive");
        if (alert) { void alert.offsetWidth; alert.classList.add("notification-arrive"); }
    })(window.showSoftAlert);

    function decorateSuccess() {
        const area = document.getElementById("bookingArea");
        const card = area?.querySelector(".result-card");
        if (!card) return;
        if (!card.querySelector(".result-celebration")) {
            const flourish = document.createElement("div");
            flourish.className = "result-celebration";
            flourish.setAttribute("aria-hidden", "true");
            flourish.textContent = "💗 ✨ 🌸 ✨ 💗";
            card.prepend(flourish);
        }
        const title = card.querySelector("h2");
        if (title && !/[🎉✨]/u.test(title.textContent)) title.textContent += " 🎉";
        celebrateBooking();
    }

    function celebrateBooking() {
        const layer = document.getElementById("bookingCelebration");
        if (!layer || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const symbols = ["💗", "🌸", "✨", "💕", "🌷", "💖"];
        layer.replaceChildren();
        layer.classList.add("is-active");
        for (let i = 0; i < 24; i++) {
            const piece = document.createElement("span");
            piece.className = "celebration-piece";
            piece.textContent = symbols[Math.floor(Math.random() * symbols.length)];
            piece.style.setProperty("--x", `${Math.round(Math.random() * 100)}vw`);
            piece.style.setProperty("--delay", `${Math.random() * 420}ms`);
            piece.style.setProperty("--drift", `${Math.round((Math.random() - .5) * 180)}px`);
            layer.appendChild(piece);
        }
        setTimeout(() => { layer.classList.remove("is-active"); layer.replaceChildren(); }, 2400);
    }

    // Opening the local admin build must never post a real request to Supabase or Apps Script.
    if (isLocalPreview) {
        document.body.classList.add("local-preview-active");
        const banner = document.getElementById("localPreviewBanner");
        if (banner) banner.hidden = false;
        window.submitBooking = () => {
            const valid = validateRequired(false);
            if (!valid) return;
            const message = document.getElementById("pMessage")?.value.trim() || "";
            showSuccess(valid, "LOCAL-DEMO", visitLabel(currentBookingType), message, false);
        };
        window.submitBirth = () => {
            const valid = validateRequired(true);
            if (!valid) return;
            showBirthSuccess(valid, "LOCAL-DEMO", currentLang === "ar" ? "معاينة محلية" : "Local preview");
        };
    }

    function applyPreviewTheme() {
        const themes = ["lagoon", "lavender", "peach", "sky", "sage", "berry", "honey"];
        let previous = "";
        const saved = window.name.match(/(?:^|;)clinicLastTheme=([^;]*)/);
        if (saved) { try { previous = decodeURIComponent(saved[1]); } catch (_) {} }
        if (!previous) { try { previous = sessionStorage.getItem("clinicLastTheme") || ""; } catch (_) {} }
        if (!previous) { try { previous = localStorage.getItem("clinicLastTheme") || ""; } catch (_) {} }
        const options = themes.filter(theme => theme !== previous);
        const theme = options[Math.floor(Math.random() * options.length)];
        document.documentElement.setAttribute("data-theme", theme);
        document.documentElement.setAttribute("data-mode", "light");
        try { localStorage.setItem("clinicLastTheme", theme); } catch (_) {}
        try { sessionStorage.setItem("clinicLastTheme", theme); } catch (_) {}
        const rest = window.name.replace(/(?:^|;)clinicLastTheme=[^;]*/, "").replace(/^;/, "");
        window.name = [rest, `clinicLastTheme=${encodeURIComponent(theme)}`].filter(Boolean).join(";");
    }

    function initScrollEffects() {
        const layer = document.getElementById("scrollDecorations");
        let lastY = 0, lastAt = 0, active = 0;
        window.addEventListener("scroll", () => {
            const back = document.getElementById("backToTop");
            back?.classList.toggle("visible", scrollY > 500);
            if (!layer || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
            const now = Date.now();
            if (Math.abs(scrollY - lastY) < 55 || now - lastAt < 115 || active >= 16) return;
            lastY = scrollY; lastAt = now; active++;
            const petal = document.createElement("span");
            petal.className = "scroll-particle";
            petal.textContent = ["🌸", "♡", "✿", "♥"][Math.floor(Math.random() * 4)];
            petal.style.left = `${8 + Math.random() * 84}%`;
            petal.style.setProperty("--drift", `${Math.round(Math.random() * 90 - 45)}px`);
            petal.style.color = getComputedStyle(document.documentElement).getPropertyValue(["--primary-color", "--medical-blue", "--accent-pink"][Math.floor(Math.random() * 3)]).trim();
            layer.appendChild(petal);
            setTimeout(() => { petal.remove(); active = Math.max(0, active - 1); }, 2600);
        }, { passive: true });
    }

    function initAssistantFloat() {
        const section = document.getElementById("assistant"), float = document.getElementById("assistantFloat");
        const modal = document.getElementById("assistantModal"), trigger = document.getElementById("assistantOpen");
        if (!section || !float || !modal || !trigger) return;
        let reached = false;
        const dock = visible => {
            if (visible) reached = true;
            float.hidden = !reached;
            float.classList.toggle("is-docked-to-page", visible);
            if (visible) hideHint();
            else if (reached && !float.dataset.hintShown) showHint();
        };
        if ("IntersectionObserver" in window) {
            const observer = new IntersectionObserver(entries => entries.forEach(entry => dock(entry.isIntersecting)), { threshold: .16, rootMargin: "-8% 0px -8% 0px" });
            observer.observe(section);
        } else window.addEventListener("scroll", () => dock(section.getBoundingClientRect().top < innerHeight && section.getBoundingClientRect().bottom > 0), { passive: true });
        trigger.addEventListener("click", () => {
            hideHint(); modal.hidden = false; trigger.setAttribute("aria-expanded", "true"); document.body.classList.add("assistant-modal-open");
            const frame = modal.querySelector("iframe"); if (!frame.getAttribute("src")) frame.src = frame.dataset.src;
        });
        modal.querySelectorAll("[data-close-assistant]").forEach(button => button.addEventListener("click", () => {
            modal.hidden = true; trigger.setAttribute("aria-expanded", "false"); document.body.classList.remove("assistant-modal-open"); trigger.focus();
        }));
        document.addEventListener("keydown", event => {
            if (event.key !== "Escape" || modal.hidden) return;
            modal.hidden = true; trigger.setAttribute("aria-expanded", "false"); document.body.classList.remove("assistant-modal-open"); trigger.focus();
        });
        function showHint() {
            const hint = document.getElementById("assistantHint");
            if (!hint || float.hidden || float.dataset.hintShown) return;
            float.dataset.hintShown = "true"; hint.hidden = false; requestAnimationFrame(() => hint.classList.add("show")); setTimeout(hideHint, 3200);
        }
        function hideHint() {
            const hint = document.getElementById("assistantHint"); if (!hint) return;
            hint.classList.remove("show"); setTimeout(() => { hint.hidden = true; }, 350);
        }
    }

    function initPresence() {
        const pill = document.getElementById("visitorPresence");
        if (!pill) return;
        const copy = pill.querySelector(".presence-copy"), pips = pill.querySelector(".presence-pips");
        if (isLocalPreview) {
            copy.textContent = currentLang === "ar" ? "عداد الزائرات يتفعّل بعد نشر تحديث الخادم" : "Live count activates after the server update is published";
            pips.innerHTML = "<i></i><i></i><i></i>"; pill.hidden = false; pill.classList.add("is-preview"); return;
        }
        const key = "clinicPresenceVisitorId";
        let visitor;
        try {
            visitor = sessionStorage.getItem(key);
            if (!visitor) { const bytes = new Uint8Array(16); crypto.getRandomValues(bytes); visitor = Array.from(bytes, v => v.toString(16).padStart(2, "0")).join(""); sessionStorage.setItem(key, visitor); }
        } catch (_) { visitor = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.padEnd(32, "0").slice(0, 32); }
        window.clinicAdminPresenceCallback = result => {
            if (result?.status !== "success") return;
            const count = Math.min(5, Math.max(0, Number(result.activeUsers) || 0));
            pips.innerHTML = Array.from({ length: count }, () => "<i></i>").join("");
            copy.textContent = result.moreThanFive ? (currentLang === "ar" ? "معكِ ٥ زائرات أو أكثر الآن 💗" : "5 or more visitors are here 💗") : (currentLang === "ar" ? `معكِ ${count} زائرات الآن 💗` : `${count} visitors here 💗`);
            pill.hidden = false;
        };
        const heartbeat = () => {
            if (document.visibilityState !== "visible" || window.__clinicAdminPresencePending) return;
            window.__clinicAdminPresencePending = true;
            const script = document.createElement("script");
            const finish = () => { script.remove(); window.__clinicAdminPresencePending = false; };
            script.onerror = finish; script.onload = finish;
            script.src = `${SCRIPT_URL}?mode=presence&visitor=${encodeURIComponent(visitor)}&callback=clinicAdminPresenceCallback&ts=${Date.now()}`;
            document.head.appendChild(script); setTimeout(finish, 9000);
        };
        heartbeat(); setInterval(heartbeat, 30000);
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") heartbeat(); });
    }

    window.addEventListener("load", () => {
        applyPreviewTheme();
        initScrollEffects();
        initAssistantFloat();
        initPresence();
        document.getElementById("splash")?.classList.add("loading");
        setTimeout(() => window.startExperience?.(), 3000);
    });
})();

