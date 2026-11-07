const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwP_Kllz_3jkLxGj2hJpNAQ6Vt4I_JOU9EnC0LB471hFJitfEoxQLdsbec8P7hcmraC/exec";
const CLINIC_WHATSAPP = "201125337717";
const IS_LOCAL_PREVIEW = location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname);

let currentLang = "ar";
const themes = ["lagoon", "lavender", "peach", "sky", "sage", "berry", "honey"];
let currentBookingType = "first";
let lastPetalScroll = 0;
let lastPetalAt = 0;
let activePetals = 0;
let presenceTimer = null;
let currentBookingView = "start";
let lastPregnancyCalcDate = "";

const dict = {
    ar: {
        brandName: "د. دعاء شعبان",
        brandSub: "أخصائية نساء وتوليد وتجميل نسائي",
        navAbout: "عن الدكتورة",
        navServices: "الخدمات",
        navBooking: "الحجز",
        navAssistant: "مساعدك بعد الولادة",
        navReviews: "آراء المرضى",
        navContact: "العنوان",
        heroTitle: "حجزك مع د. دعاء شعبان أصبح أسهل",
        heroText: "تقدري تختاري نوع الكشف، تسجلي بياناتك، وتبعتي تفاصيل مختصرة أو صورة تحليل/روشتة عند الحاجة. النظام يساعدكِ على تنظيم الحجز بسرعة ووضوح.",
        bookNow: "احجزي موعدك الآن",
        whatsappNow: "تواصلي واتساب",
        statExperience: "خبرة طبية",
        statBirth: "عملية ولادة",
        statVisits: "كشف ومتابعة",
        statAesthetic: "تجميل نسائي",
        aboutTitle1: "نبذة عن",
        aboutTitle2: "د. دعاء شعبان",
        aboutText1: "د/ دعاء شعبان هي أخصائية النساء والتوليد والتجميل النسائي، حاصلة على ماجستير النساء والتوليد من جامعة الأزهر، وبكالوريوس الطب والجراحة. تقدم خدمات طبية متكاملة تهدف إلى الحفاظ على صحة المرأة في مختلف مراحل حياتها.",
        aboutText2: "تؤمن د/ دعاء بأن الراحة النفسية للمريضة جزء أساسي من العلاج، لذلك تحرص على تقديم شرح واضح ومتابعة دقيقة لكل حالة.",
        servicesTitle: "خدمات العيادة المتكاملة",
        servicesLead: "رعاية متخصصة للمرأة في كل مرحلة، من الكشف والمتابعة وحتى التجميل النسائي ورعاية الحمل.",
        service1Title: "متابعة الحمل",
        service1Text: "متابعة دورية دقيقة لصحة الأم والجنين مع إرشادات طبية مناسبة لكل مرحلة.",
        service2Title: "كشف نساء وتوليد",
        service2Text: "تشخيص ومتابعة مشاكل النساء والتوليد بأمان وخصوصية وشرح واضح للحالة.",
        service3Title: "التجميل النسائي",
        service3Text: "خدمات تجميل نسائي باهتمام طبي دقيق وتجربة مريحة وآمنة.",
        service4Title: "مراجعة التحاليل",
        service4Text: "إرسال التحاليل أو الأشعة لعرضها على الدكتورة ومراجعتها حسب الحالة.",
        service5Title: "استشارة خلال المتابعة",
        service5Text: "استشارة منظمة خلال مدة المتابعة المسموح بها لضمان أفضل استفادة.",
        service6Title: "رعاية قبل وبعد الولادة",
        service6Text: "تنظيم حجز الولادة والتواصل مع العيادة لترتيب التفاصيل المناسبة.",
        assistantTitle: "بعد الولادة مش هنسيبك",
        assistantText: "المساعد الذكي هيساعدك تعرفي خطوات تسجيل شهادة الميلاد، متابعة التطعيمات، ورعاية صحتك وصحة طفلك بطريقة سهلة وواضحة.",
        assistantBtn: "افتحي المساعد الذكي",
        reviewsTitle: "آراء المرضى",
        reviewsLead: "اسحبي يمين أو شمال لمشاهدة المزيد من الآراء.",
        contactTitle: "بيانات العيادة",
        addressLabel: "العنوان:",
        addressText: "اللبيني – الهرم، بجوار أولاد رجب",
        phoneLabel: "للاستفسار أو التعديل:",
        hoursLabel: "مواعيد العمل:",
        hoursText: "من 4 مساءً إلى 10 مساءً",
        holidayFooter: "الإجازة الأسبوعية: الاثنين والخميس والجمعة",
        mapBtn: "افتحي الموقع على الخريطة",
        holidayTitle: "تنبيه المواعيد",
        holidayMsg: "الإجازة الأسبوعية للعيادة أيام الاثنين والخميس والجمعة. من فضلكِ اختاري يوماً آخر للحجز.",
        understood: "فهمت",
        clickToStart: "جاري تجهيز الموقع",
        splashWait: "لحظات ونبدأ معكِ",
        pregnancyNudgeKicker: "هدية صغيرة لكِ",
        pregnancyNudgeTitle: "رحلتك للأمومة 💗",
        pregnancyNudgeText: "احسبي فاضل قد إيه على مقابلة صغيرك، وشوفي رحلتك وصلت لكام في المية.",
        pregnancyNudgeCta: "احسبي رحلتك",
        pregnancyNudgeFoot: "حساب تقريبي لعمر الحمل وموعد الولادة",
        pregnancyFloatLabel: "حاسبة الحمل",
        groupMedical: "الكشوفات الطبية",
        groupServices: "الخدمات الإضافية",
        groupSpecial: "أقسام مميزة",

    },
    en: {
        brandName: "Dr. Doaa Shaban",
        brandSub: "OB/GYN and Aesthetic Gynecology Specialist",
        navAbout: "About",
        navServices: "Services",
        navBooking: "Booking",
        navAssistant: "After-birth Assistant",
        navReviews: "Reviews",
        navContact: "Location",
        heroTitle: "Booking with Dr. Doaa Shaban is now easier",
        heroText: "Choose your visit type, enter your details, and optionally send a short message or attachment. The system helps organize your booking clearly and quickly.",
        bookNow: "Book Now",
        whatsappNow: "WhatsApp",
        statExperience: "Medical experience",
        statBirth: "Delivery operations",
        statVisits: "Visits and follow-ups",
        statAesthetic: "Aesthetic cases",
        aboutTitle1: "About",
        aboutTitle2: "Dr. Doaa Shaban",
        aboutText1: "Dr. Doaa Shaban is an obstetrics, gynecology, and aesthetic gynecology specialist with a Master's degree from Al-Azhar University and a Bachelor of Medicine and Surgery.",
        aboutText2: "She believes that patient comfort is an essential part of care, so she provides clear explanations and careful follow-up for every case.",
        servicesTitle: "Integrated Clinic Services",
        servicesLead: "Specialized care for women at every stage, from consultations and follow-ups to aesthetic gynecology and pregnancy care.",
        service1Title: "Pregnancy Follow-up",
        service1Text: "Regular follow-up for mother and baby with suitable guidance for each stage.",
        service2Title: "OB/GYN Visit",
        service2Text: "Diagnosis and follow-up with privacy, safety, and clear medical explanation.",
        service3Title: "Aesthetic Gynecology",
        service3Text: "Aesthetic gynecology services with careful medical attention and a comfortable experience.",
        service4Title: "Lab Review",
        service4Text: "Send reports or scans for review according to your case.",
        service5Title: "Follow-up Consultation",
        service5Text: "Organized consultation during the allowed follow-up period.",
        service6Title: "Before and After Delivery Care",
        service6Text: "Delivery booking organization and clinic communication for details.",
        assistantTitle: "After delivery, we are still with you",
        assistantText: "The smart assistant helps you understand birth certificate steps, vaccination follow-up, and care for you and your baby.",
        assistantBtn: "Open Smart Assistant",
        reviewsTitle: "Patient Reviews",
        reviewsLead: "Swipe horizontally to view more reviews.",
        contactTitle: "Clinic Details",
        addressLabel: "Address:",
        addressText: "El Lebiny - Haram, next to Awlad Ragab",
        phoneLabel: "For inquiries or changes:",
        hoursLabel: "Working hours:",
        hoursText: "From 4 PM to 10 PM",
        holidayFooter: "Weekly holidays: Monday, Thursday, and Friday",
        mapBtn: "Open Location",
        holidayTitle: "Appointment Alert",
        holidayMsg: "The clinic is closed every Monday, Thursday, and Friday. Please choose another booking day.",
        understood: "OK",
        clickToStart: "Preparing the website",
        splashWait: "Just a moment and we will begin",
        pregnancyNudgeKicker: "A little gift for you",
        pregnancyNudgeTitle: "Your journey to motherhood 💗",
        pregnancyNudgeText: "See how far along your journey is and how long until you meet your little one.",
        pregnancyNudgeCta: "Check your journey",
        pregnancyNudgeFoot: "An estimate of pregnancy age and due date",
        pregnancyFloatLabel: "Pregnancy calculator",
        groupMedical: "Medical Visits",
        groupServices: "Extra Services",
        groupSpecial: "Special Sections",

    }
};

const formText = {
    ar: {
        chooseTitle: "احجزي موعدك بسهولة",
        chooseLead: "يرجى تحديد الخدمة الطبية المطلوبة أدناه، ثم إكمال البيانات اللازمة لتأكيد الحجز بنجاح.",
        first: "كشف نساء أول مرة",
        follow: "كشف نساء متابعة",
        consult: "استشارة متابعة",
        aesthetic: "التجميل النسائي",
        birth: "حجز ولادة",
        labs: "إرسال تحاليل أو أشعة",
        pregnancy: "احسبي حملك",
        contacts: "انضمي لعائلة العيادة",
        contactsDesc: "اتركي بياناتك لتصلك العروض والمتابعة وقنوات التواصل",
        name: "الاسم الثلاثي",
        phone: "رقم الهاتف",
        bookingDate: "تاريخ الحجز",
        contactDate: "تاريخ مناسب للتواصل",
        deliveryDate: "تاريخ الولادة المتوقع",
        lastVisit: "تاريخ آخر زيارة للعيادة",
        message: "رسالة مختصرة أو الأعراض",
        messagePlaceholder: "اكتبي رسالة مختصرة أو الأعراض / اليوم المناسب...",
        uploadCheck: "أريد إرسال روشتة / تحليل / أشعة",
        uploadNote: "سيتم توضيح وجود المرفقات في بيانات الحجز.",
        confirm: "تأكيد الحجز",
        send: "إرسال",
        birthBtn: "حجز الولادة",
        contactBtn: "تسجيل بياناتي",
        back: "رجوع للخدمات",
        demand: "سيتم مراجعة طلبك والتواصل معكِ لتأكيد الموعد.",
        nameErr: "من فضلك اكتبي الاسم ثلاثي",
        phoneErr: "أدخلي رقم موبايل مصري صحيحًا من 11 رقمًا يبدأ بـ 01",
        pregTitle: "حاسبة الحمل",
        pregLead: "اختاري أول يوم في آخر دورة لحساب عمر الحمل التقريبي.",
        pregDate: "تاريخ أول يوم في آخر دورة",
        pregBtn: "احسبي الآن",
        pregResultTitle: "نتيجة حساب الحمل",
        errData: "من فضلك أكملي البيانات: ",
        alertTitle: "بيانات ناقصة"
    },
    en: {
        chooseTitle: "Book Your Appointment Easily",
        chooseLead: "Please select the required medical service below, then complete the necessary details to confirm.",
        first: "First OB/GYN Visit",
        follow: "Follow-up Visit",
        consult: "Follow-up Consultation",
        aesthetic: "Aesthetic Gynecology",
        birth: "Delivery Booking",
        labs: "Send Labs or Scans",
        pregnancy: "Pregnancy Calculator",
        contacts: "Join the Clinic Family",
        contactsDesc: "Leave your details to receive offers, updates, and clinic channels",
        name: "Full name",
        phone: "Phone number",
        bookingDate: "Booking date",
        contactDate: "Suitable contact date",
        deliveryDate: "Expected delivery date",
        lastVisit: "Last clinic visit",
        message: "Short message or symptoms",
        messagePlaceholder: "Write a short message, symptoms, or suitable day...",
        uploadCheck: "I want to send a prescription / lab / scan",
        uploadNote: "Attachment availability will be shown in booking details.",
        confirm: "Confirm Booking",
        send: "Send",
        birthBtn: "Book Delivery",
        contactBtn: "Register My Details",
        back: "Back to services",
        demand: "The clinic will review your request and contact you to confirm.",
        nameErr: "Please enter full name",
        phoneErr: "Enter a valid 11-digit Egyptian mobile number starting with 01",
        pregTitle: "Pregnancy Calculator",
        pregLead: "Choose the first day of your last period to estimate pregnancy age.",
        pregDate: "First day of last period",
        pregBtn: "Calculate Now",
        pregResultTitle: "Pregnancy Result",
        errData: "Please complete: ",
        alertTitle: "Missing Details"
    }
};

const visitDesc = {
    ar: {
        first: "تشخيص دقيق وتقييم شامل للحالة.",
        follow: "متابعة الخطة العلاجية والاطمئنان.",
        consult: "استشارة طبية سريعة خلال المتابعة.",
        aesthetic: "أحدث التقنيات لراحتك وجمالك.",
        birth: "تجهيز وترتيب كافة إجراءات الولادة.",
        labs: "مراجعة دقيقة للتحاليل والأشعة.",
        pregnancy: "حساب دقيق لعمر الحمل وموعد الولادة.",
        contacts: "انضمي لتصلك نصائحنا وعروضنا."
    },
    en: {
        first: "Accurate diagnosis and full assessment.",
        follow: "Follow-up on your treatment plan.",
        consult: "Quick medical consultation.",
        aesthetic: "Latest techniques for your comfort.",
        birth: "Preparation for delivery procedures.",
        labs: "Review of your lab results and scans.",
        pregnancy: "Accurate calculation of pregnancy age.",
        contacts: "Join to receive our tips and offers."
    }
};

window.addEventListener("load", () => {
    applyRandomTheme();

    if (IS_LOCAL_PREVIEW) {
        document.getElementById("localPreviewBanner").hidden = false;
    }
    initScrollDecorations();
    initAssistantFloat();
    initPresenceCounter();
    initPregnancyNudge();
    initInSiteNavigation();

    renderBookingStart();
    animateStats();
    updateClock();
    setInterval(updateClock, 1000);
    applyLanguage();

    updateBackToTop();
    window.addEventListener("scroll", updateBackToTop, { passive: true });
    const splash = document.getElementById("splash");
    splash.classList.add("loading");
    window.setTimeout(startExperience, 3000);
});

function initInSiteNavigation() {
    const initialSection = location.hash.replace(/^#/, "") || "home";
    history.replaceState({ ...(history.state || {}), clinicSite: true, clinicSection: initialSection, clinicBookingView: "start" }, "", location.href);
    let activeSection = initialSection;
    let sectionTimer = 0;
    let restoringSection = false;

    const rememberSection = id => {
        if (!id || id === activeSection || restoringSection) return;
        window.clearTimeout(sectionTimer);
        sectionTimer = window.setTimeout(() => {
            if (id === activeSection || restoringSection) return;
            activeSection = id;
            const current = history.state && typeof history.state === "object" ? history.state : {};
            history.pushState({ ...current, clinicSite: true, clinicSection: id }, "", location.href);
        }, 260);
    };

    if ("IntersectionObserver" in window) {
        const sectionObserver = new IntersectionObserver(entries => {
            const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
            if (visible) rememberSection(visible.target.id);
        }, { rootMargin: "-28% 0px -58% 0px", threshold: [0, 0.2, 0.45, 0.7] });
        document.querySelectorAll("main > section[id], main > .hero[id]").forEach(section => sectionObserver.observe(section));
    }

    document.addEventListener("click", event => {
        const link = event.target.closest('a[href^="#"]');
        if (!link) return;
        const id = link.getAttribute("href").slice(1);
        const target = id && document.getElementById(id);
        if (!target) return;
        event.preventDefault();
        window.clearTimeout(sectionTimer);
        activeSection = id;
        const nextState = { ...(history.state || {}), clinicSite: true, clinicSection: id };
        if (id === "booking") nextState.clinicBookingView = "start";
        history.pushState(nextState, "", `#${id}`);
        if (id === "booking") renderBookingStart();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    window.addEventListener("popstate", event => {
        const state = event.state || {};
        if (!state.clinicSite) return;
        window.clearTimeout(sectionTimer);
        activeSection = state.clinicSection || "home";
        closeInSiteOverlaysOnBack(state);
        if (state.clinicBookingView) restoreBookingView(state);
        const section = document.getElementById(state.clinicSection || "home");
        if (section) {
            restoringSection = true;
            section.scrollIntoView({ behavior: "smooth", block: "start" });
            window.setTimeout(() => { restoringSection = false; }, 700);
        }
    });
}

function pushInSiteOverlay(overlay) {
    const current = history.state && typeof history.state === "object" ? history.state : {};
    if (current.clinicOverlay === overlay) return;
    history.pushState({ ...current, clinicSite: true, clinicOverlay: overlay }, "", location.href);
}

function closeInSiteOverlaysOnBack(state) {
    const storyViewer = document.getElementById("storyViewer");
    if (storyViewer?.classList.contains("is-open") && state.clinicOverlay !== "story") window.closeClinicStory?.(true);
    const modal = document.getElementById("assistantModal");
    if (modal && !modal.hidden && state.clinicOverlay !== "assistant") closeAssistantModalFromHistory();
}

function closeAssistantModalFromHistory() {
    const modal = document.getElementById("assistantModal");
    const trigger = document.getElementById("assistantOpen");
    if (!modal || !trigger) return;
    modal.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    document.body.classList.remove("assistant-modal-open");
    trigger.focus();
}

function pushBookingView(view, details = {}) {
    const current = history.state && typeof history.state === "object" ? history.state : {};
    history.pushState({ ...current, clinicSite: true, clinicSection: "booking", clinicBookingView: view, ...details }, "", location.href);
    currentBookingView = view;
}

function pushBookingResult(view) {
    const current = history.state && typeof history.state === "object" ? history.state : {};
    const startState = { ...current, clinicSite: true, clinicSection: "booking", clinicBookingView: "start" };
    history.replaceState(startState, "", location.href);
    history.pushState({ ...startState, clinicBookingView: view }, "", location.href);
    currentBookingView = view;
}

function goBackInSite() {
    if (history.state?.clinicSite && history.state.clinicBookingView && history.state.clinicBookingView !== "start") {
        history.back();
        return;
    }
    renderBookingStart();
    document.getElementById("bookingArea")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function restoreBookingView(state) {
    const view = state.clinicBookingView;
    currentBookingView = view;
    if (view === "start") return renderBookingStart();
    if (view === "form") {
        currentBookingType = state.type || "first";
        return renderBookingForm();
    }
    if (view === "pregnancyCalc") {
        currentBookingType = "pregnancy";
        return renderPregnancyCalc(lastPregnancyCalcDate);
    }
    if (view === "pregnancyResult") {
        currentBookingType = "pregnancy";
        return calculatePregnancyForDate(lastPregnancyCalcDate, false);
    }
    if ((view === "success" || view === "duplicated") && document.querySelector("#bookingArea .result-card")) return;
    renderBookingStart();
}

function bookingDataNotice() {
    const heading = "CLINIC DATA & PRIVACY NOTICE";
    const copy = IS_LOCAL_PREVIEW
        ? (currentLang === "ar" ? "معاينة محلية فقط — لا يتم إرسال أو حفظ البيانات." : "Local preview only — no information is sent or saved.")
        : (currentLang === "ar" ? "بيانات الحجز تحت إدارة عيادة د. دعاء شعبان، وتُستخدم لمتابعة طلبك." : "Booking details are handled by Dr. Doaa Shaban Clinic to follow up on your request.");
    const clinicName = currentLang === "ar" ? "عيادة د. دعاء شعبان" : "DR. DOAA SHABAN CLINIC";
    return `<aside class="booking-data-notice" aria-label="${heading}"><span class="notice-heading"><i class="fa-solid fa-house-medical" aria-hidden="true"></i> ${heading}</span><p>${copy}</p><strong>${clinicName}</strong></aside>`;
}

function startExperience() {
    let splash = document.getElementById("splash");
    if (!splash || splash.classList.contains("hide")) return;
    splash.classList.add("hide");
    setTimeout(() => { splash.style.display = "none"; }, 700);
}

function initAssistantFloat() {
    const section = document.getElementById("assistant");
    const float = document.getElementById("assistantFloat");
    const modal = document.getElementById("assistantModal");
    const trigger = document.getElementById("assistantOpen");
    if (!section || !float || !modal || !trigger) return;
    let reached = false;
    const setDocked = (visible) => {
        if (visible) reached = true;
        float.hidden = !reached;
        float.classList.toggle("is-docked-to-page", visible);
        if (visible) hideAssistantHint();
        else if (reached && !float.dataset.hintShown) showAssistantHint();
    };
    if ("IntersectionObserver" in window) {
        const observer = new IntersectionObserver(entries => {
            for (const entry of entries) setDocked(entry.isIntersecting);
        }, { threshold: 0.16, rootMargin: "-8% 0px -8% 0px" });
        observer.observe(section);
    } else {
        const update = () => setDocked(section.getBoundingClientRect().top < innerHeight && section.getBoundingClientRect().bottom > 0);
        window.addEventListener("scroll", update, { passive: true });
        update();
    }
    trigger.addEventListener("click", () => {
        hideAssistantHint();
        pushInSiteOverlay("assistant");
        modal.hidden = false;
        trigger.setAttribute("aria-expanded", "true");
        document.body.classList.add("assistant-modal-open");
        const frame = modal.querySelector("iframe");
        if (!frame.getAttribute("src")) frame.src = frame.dataset.src;
    });
    modal.querySelectorAll("[data-close-assistant]").forEach(button => button.addEventListener("click", () => {
        if (history.state?.clinicOverlay === "assistant") history.back();
        else closeAssistantModalFromHistory();
    }));
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !modal.hidden) {
            if (history.state?.clinicOverlay === "assistant") history.back();
            else closeAssistantModalFromHistory();
        }
    });
}

function showAssistantHint() {
    const float = document.getElementById("assistantFloat");
    const hint = document.getElementById("assistantHint");
    if (!float || !hint || float.hidden || float.dataset.hintShown) return;
    float.dataset.hintShown = "true";
    hint.hidden = false;
    requestAnimationFrame(() => hint.classList.add("show"));
    window.setTimeout(hideAssistantHint, 3200);
}

function hideAssistantHint() {
    const hint = document.getElementById("assistantHint");
    if (!hint) return;
    hint.classList.remove("show");
    window.setTimeout(() => { hint.hidden = true; }, 350);
}

function getPresenceVisitorId() {
    const key = "clinicPresenceVisitorId";
    try {
        let id = sessionStorage.getItem(key);
        if (!id) {
            const bytes = new Uint8Array(16);
            crypto.getRandomValues(bytes);
            id = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
            sessionStorage.setItem(key, id);
        }
        return id;
    } catch {
        return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.padEnd(32, "0").slice(0, 32);
    }
}

function initPresenceCounter() {
    const pill = document.getElementById("visitorPresence");
    if (!pill) return;
    const copy = pill.querySelector(".presence-copy");
    const pips = pill.querySelector(".presence-pips");
    if (IS_LOCAL_PREVIEW) {
        copy.textContent = currentLang === "ar" ? "عداد الزائرات يتفعّل بعد نشر تحديث الخادم" : "Live visitor count activates after the server update is published";
        pips.innerHTML = "<i></i><i></i><i></i>";
        pill.hidden = false;
        pill.classList.add("is-preview");
        return;
    }
    const visitorId = getPresenceVisitorId();
    let failedBeforeResponse = true;
    window.clinicPresenceCallback = (result) => {
        failedBeforeResponse = false;
        if (!result || result.status !== "success") return;
        const count = Math.max(0, Math.min(5, Number(result.activeUsers) || 0));
        pips.innerHTML = Array.from({ length: count }, () => "<i></i>").join("");
        copy.textContent = count === 0
            ? (currentLang === "ar" ? "أنتِ أول زائرة الآن 🌷" : "You are the first visitor 🌷")
            : (result.moreThanFive
                ? (currentLang === "ar" ? "معكِ ٥ زائرات أو أكثر الآن 💗" : "5 or more visitors are here 💗")
                : (currentLang === "ar" ? `معكِ ${count} ${count === 1 ? "زائرة" : "زائرات"} الآن 💗` : `${count} visitor${count === 1 ? "" : "s"} here 💗`));
        pill.hidden = false;
    };
    const heartbeat = () => {
        if (document.visibilityState !== "visible" || window.__clinicPresenceInFlight) return;
        window.__clinicPresenceInFlight = true;
        const script = document.createElement("script");
        const timeout = window.setTimeout(() => { script.remove(); window.__clinicPresenceInFlight = false; }, 9000);
        script.onerror = () => { clearTimeout(timeout); script.remove(); window.__clinicPresenceInFlight = false; };
        script.onload = () => { clearTimeout(timeout); script.remove(); window.__clinicPresenceInFlight = false; };
        script.src = `${SCRIPT_URL}?mode=presence&visitor=${encodeURIComponent(visitorId)}&callback=clinicPresenceCallback&ts=${Date.now()}`;
        document.head.appendChild(script);
        if (failedBeforeResponse) window.setTimeout(() => { if (pill.hidden) pill.hidden = true; }, 9500);
    };
    heartbeat();
    presenceTimer = window.setInterval(heartbeat, 30000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") heartbeat(); });
}

function t(key) { return formText[currentLang][key] || key; }
function toggleMobileMenu() { document.getElementById("mobileMenu").classList.toggle("open"); }

function toggleLanguage() {
    currentLang = currentLang === "ar" ? "en" : "ar";
    document.getElementById("langBtn").innerText = currentLang === "ar" ? "EN" : "AR";
    document.documentElement.lang = currentLang;
    document.body.classList.toggle("en-mode", currentLang === "en");
    const backToTop = document.getElementById("backToTop");
    if (backToTop) {
        const label = currentLang === "ar" ? "العودة إلى أعلى الصفحة" : "Back to top";
        backToTop.setAttribute("aria-label", label);
        backToTop.title = label;
    }
    applyLanguage();
    renderBookingStart();
}

function applyLanguage() {
    document.querySelectorAll("[data-i18n]").forEach(el => {
        const key = el.getAttribute("data-i18n");
        if (dict[currentLang][key]) el.innerText = dict[currentLang][key];
    });
}

function pregnancyMascotArt() {
    return `<img src="assets/images/Calc.jpg" alt="" aria-hidden="true" loading="lazy">`;
}

function initPregnancyNudge() {
    const nudge = document.getElementById("pregnancyNudge");
    const float = document.getElementById("pregnancyFloat");
    if (!nudge || !float) return;
    const art = pregnancyMascotArt();
    nudge.querySelector(".pregnancy-nudge-art").innerHTML = art;
    nudge.querySelector(".pregnancy-nudge-mini-art").innerHTML = art;
    float.querySelector(".pregnancy-float-art").innerHTML = art;

    const openCalculator = () => {
        dismissPregnancyNudge();
        document.getElementById("booking")?.scrollIntoView({ behavior: "smooth", block: "start" });
        window.setTimeout(() => selectVisit("pregnancy"), 420);
    };
    document.getElementById("pregnancyNudgeCta")?.addEventListener("click", openCalculator);
    float.addEventListener("click", openCalculator);
    nudge.querySelectorAll("[data-close-pregnancy-nudge]").forEach(button => button.addEventListener("click", dismissPregnancyNudge));
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !nudge.hidden) dismissPregnancyNudge();
    });

    window.setTimeout(() => {
        float.hidden = false;
        let alreadyShown = false;
        try { alreadyShown = sessionStorage.getItem("clinicPregnancyNudgeShown") === "1"; } catch (error) {}
        const bookingStarted = currentBookingView !== "start" || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
        if (alreadyShown || bookingStarted || document.visibilityState !== "visible") return;
        try { sessionStorage.setItem("clinicPregnancyNudgeShown", "1"); } catch (error) {}
        nudge.hidden = false;
        document.body.classList.add("pregnancy-nudge-open");
        nudge.querySelector(".pregnancy-nudge-close")?.focus({ preventScroll: true });
    }, 7200);
}

function dismissPregnancyNudge() {
    const nudge = document.getElementById("pregnancyNudge");
    if (!nudge || nudge.hidden) return;
    nudge.classList.add("is-closing");
    document.body.classList.remove("pregnancy-nudge-open");
    window.setTimeout(() => { nudge.hidden = true; nudge.classList.remove("is-closing"); }, 320);
    document.getElementById("pregnancyFloat")?.focus({ preventScroll: true });
}

function applyRandomTheme() {
    let previousTheme = "";
    const savedInWindow = window.name.match(/(?:^|;)clinicLastTheme=([^;]*)/);
    if (savedInWindow) {
        try { previousTheme = decodeURIComponent(savedInWindow[1]); } catch (error) {}
    }
    if (!previousTheme) try { previousTheme = sessionStorage.getItem("clinicLastTheme") || ""; } catch (error) {}
    if (!previousTheme) try { previousTheme = localStorage.getItem("clinicLastTheme") || ""; } catch (error) {}
    const choices = themes.filter(theme => theme !== previousTheme);
    const theme = choices[Math.floor(Math.random() * choices.length)];
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("clinicLastTheme", theme); } catch (error) {}
    try { sessionStorage.setItem("clinicLastTheme", theme); } catch (error) {}
    const windowState = window.name.replace(/(?:^|;)clinicLastTheme=[^;]*/, "").replace(/^;/, "");
    window.name = [windowState, `clinicLastTheme=${encodeURIComponent(theme)}`].filter(Boolean).join(";");
}

function updateBackToTop() {
    const button = document.getElementById("backToTop");
    if (button) button.classList.toggle("visible", window.scrollY > 500);
}

function updateClock() {
    const now = new Date();
    const locale = currentLang === "ar" ? "ar-EG" : "en-US";
    document.getElementById("clockNow").innerText = now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    document.getElementById("todayText").innerText = now.toLocaleDateString(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

function animateStats() {
    document.querySelectorAll(".stat-number").forEach(el => {
        const target = parseInt(el.dataset.target, 10);
        let current = 0;
        const step = Math.max(1, Math.ceil(target / 90));
        const timer = setInterval(() => {
            current += step;
            if (current >= target) {
                current = target;
                clearInterval(timer);
            }
            el.innerText = "+" + current.toLocaleString(currentLang === "ar" ? "ar-EG" : "en-US");
        }, 24);
    });
}

function todayISO() {
    const now = new Date();
    const pad = value => String(value).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function localDateFromISO(value) {
    const [year, month, day] = (value || "").split("-").map(Number);
    return new Date(year, month - 1, day);
}

function normalizeDigits(value) {
    return String(value || "").replace(/[٠-٩۰-۹]/g, digit => {
        const code = digit.charCodeAt(0);
        return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    });
}

function initScrollDecorations() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const layer = document.getElementById("scrollDecorations");
    const symbols = ["🌸", "♡", "✿", "♥"];
    window.addEventListener("scroll", () => {
        const now = Date.now();
        if (Math.abs(window.scrollY - lastPetalScroll) < 55 || now - lastPetalAt < 115 || activePetals >= 16) return;
        lastPetalScroll = window.scrollY;
        lastPetalAt = now;
        activePetals++;
        const petal = document.createElement("span");
        petal.className = "scroll-particle";
        petal.textContent = symbols[Math.floor(Math.random() * symbols.length)];
        petal.style.left = `${8 + Math.random() * 84}%`;
        petal.style.setProperty("--drift", `${Math.round(Math.random() * 90 - 45)}px`);
        const tones = ["--primary-color", "--medical-blue", "--accent-pink"];
        petal.style.color = getComputedStyle(document.documentElement).getPropertyValue(tones[Math.floor(Math.random() * tones.length)]).trim();
        layer.appendChild(petal);
        window.setTimeout(() => { petal.remove(); activePetals = Math.max(0, activePetals - 1); }, 2600);
    }, { passive: true });
}

function renderBookingStart() {
    document.getElementById("bookingArea").innerHTML = `
        <div class="booking-panel">
            <div class="booking-head">
                <span class="booking-step-kicker">${currentLang === "ar" ? "خطوة ١ · اختاري الخدمة" : "STEP 1 · CHOOSE A SERVICE"}</span>
                <h2>${t("chooseTitle")} <span aria-hidden="true">🌸</span></h2>
                <p>${t("chooseLead")}</p>
            </div>

            <div class="booking-meta">
                <div class="meta-stat"><i class="fa-solid fa-bolt"></i><span>${currentLang === 'ar' ? 'حجز فوري' : 'Instant Booking'}</span></div>
                <div class="meta-stat"><i class="fa-solid fa-shield-halved"></i><span>${currentLang === 'ar' ? 'سرية تامة' : 'High Privacy'}</span></div>
                <div class="meta-stat"><i class="fa-solid fa-clock-rotate-left"></i><span>${currentLang === 'ar' ? 'متابعة مستمرة' : 'Continuous Care'}</span></div>
            </div>

            <div class="group-title" data-i18n="groupMedical">${dict[currentLang].groupMedical}</div>
            <div class="visit-grid">
                ${visitCard("first", "fa-user-doctor", t("first"))}
                ${visitCard("follow", "fa-rotate-right", t("follow"))}
                ${visitCard("consult", "fa-comments", t("consult"))}
                ${visitCard("birth", "fa-baby", t("birth"))}
            </div>

            <div class="group-title" data-i18n="groupSpecial">${dict[currentLang].groupSpecial}</div>
            <div class="visit-grid">
                ${visitCard("aesthetic", "fa-spa", t("aesthetic"), true)}
                ${visitCard("contacts", "fa-address-book", t("contacts"))}
            </div>

            <div class="group-title" data-i18n="groupServices">${dict[currentLang].groupServices}</div>
            <div class="visit-grid">
                ${visitCard("pregnancy", "fa-baby-carriage", t("pregnancy"))}
                ${visitCard("labs", "fa-vial-circle-check", t("labs"))}
            </div>
            <div class="booking-reassurance"><span aria-hidden="true">💗</span>${currentLang === "ar" ? "اختاري الخدمة المناسبة، وبعدها اكتبي بيانات التواصل الضرورية فقط. العيادة هتتواصل معاكي لتأكيد التفاصيل." : "Choose a service, then share only the contact details needed. The clinic will reach out to confirm."}</div>
        </div>
    `;
}

function visitCard(type, icon, label, special = false) {
    const familyClass = type === "contacts" ? "family-card" : "";
    const desc = visitDesc[currentLang][type];

    return `
        <button class="visit-option ${special ? "special" : ""} ${familyClass}" type="button" onclick="selectVisit('${type}')">
            <span class="visit-option-icon ${type === "pregnancy" ? "pregnancy-option-icon" : ""}">${type === "pregnancy" ? pregnancyMascotArt() : `<i class="fa-solid ${icon}" aria-hidden="true"></i>`}</span>
            <span class="visit-option-copy"><strong>${label}</strong><span>${desc}</span></span>
            <span class="visit-option-arrow" aria-hidden="true"><i class="fa-solid fa-arrow-left"></i></span>
        </button>
    `;
}

function selectVisit(type) {
    currentBookingType = type;
    if (type === "pregnancy") {
        pushBookingView("pregnancyCalc", { type });
        renderPregnancyCalc();
    } else {
        pushBookingView("form", { type });
        renderBookingForm();
    }
}

function visitLabel(type) {
    const labels = {
        first: t("first"),
        follow: t("follow"),
        consult: t("consult"),
        aesthetic: t("aesthetic"),
        birth: t("birth"),
        labs: t("labs"),
        pregnancy: t("pregnancy"),
        contacts: t("contacts")
    };
    return labels[type] || t("first");
}

function getBookingIdPrefix(type) {
    switch (type) {
        case 'first': return 'A';
        case 'follow': return 'B';
        case 'consult': return 'C';
        case 'aesthetic': return 'D';
        case 'birth': return 'E';
        default: return 'F';
    }
}

function renderBookingForm() {
    const isBirth = currentBookingType === "birth";
    const isConsult = currentBookingType === "consult";
    const isLabs = currentBookingType === "labs";
    const isContacts = currentBookingType === "contacts";
    const today = todayISO();

    document.getElementById("bookingArea").innerHTML = `
        <div class="booking-panel" id="activeForm">
            <div class="booking-head">
                <span class="booking-step-kicker">${currentLang === "ar" ? "خطوة ٢ · بياناتك بأمان" : "STEP 2 · YOUR DETAILS"}</span>
                <h2 style="font-size:clamp(1.8rem, 4vw, 2.5rem); padding: 5px 20px;">${visitLabel(currentBookingType)}</h2>
                <p id="liveBookingHint">${isContacts ? t("contactsDesc") : t("demand")}</p>
                <div class="booking-privacy-note"><i class="fa-solid fa-heart-circle-check" aria-hidden="true"></i> ${isContacts
                    ? (currentLang === "ar" ? "ستُستخدم بيانات الاتصال للتواصل من العيادة." : "Your contact details will be used by the clinic to reach you.")
                    : (currentLang === "ar" ? "طلب الحجز مبدئي؛ ستتواصل العيادة معكِ لتأكيد الموعد. اكتبي فقط المعلومات اللازمة للتواصل." : "This is a booking request; the clinic will contact you to confirm. Share only the information needed to arrange it.")}</div>
            </div>

            <div class="form-grid">
                <div class="form-field">
                    <label for="pName">${t("name")}</label>
                    <input type="text" id="pName" placeholder="${t("name")}" autocomplete="name" required aria-required="true" oninput="checkNameInput(this)">
                    <div id="nameErr" class="error-hint">${t("nameErr")}</div>
                </div>

                <div class="form-field">
                    <label for="pPhone">${t("phone")}</label>
                    <input type="tel" id="pPhone" inputmode="numeric" autocomplete="tel" maxlength="11" pattern="01[0-9]{9}" required aria-required="true" placeholder="011xxxxxxxx" oninput="checkPhoneInput(this)">
                    <div id="phoneErr" class="error-hint">${t("phoneErr")}</div>
                </div>

                ${!isContacts ? `
                <div class="form-field full">
                    <label for="pBookingDate">${isBirth ? t("deliveryDate") : (isLabs ? t("contactDate") : t("bookingDate"))}</label>
                    <input type="date" id="pBookingDate" min="${today}" required aria-required="true" onchange="checkWeekend(this)">
                </div>
                ` : ""}

                ${isConsult ? `
                    <div class="form-field full">
                        <label>${t("lastVisit")}</label>
                        <input type="date" id="pLastVisit" max="${today}" onchange="check15Days()">
                        <div id="dateFeedback" class="feedback-box"></div>
                    </div>
                ` : ""}

                <div class="form-field full">
                    <label>${isContacts ? t("contactsDesc") : t("message")}</label>
                    <textarea id="pMessage" placeholder="${isContacts ? t("contactsDesc") : t("messagePlaceholder")}"></textarea>
                </div>

                ${(!isBirth && !isContacts) ? `
                    <div class="form-field full">
                        <label class="checkbox-line">
                            <input type="checkbox" id="needUpload" onchange="toggleUpload(this)">
                            ${t("uploadCheck")}
                        </label>
                        <div id="uploadBox" class="upload-box">
                            <input type="file" id="pAttachment" accept="image/*,.pdf">
                            <div style="font-size:0.75rem;color:var(--text-soft);font-weight:800;margin-top:5px;">${t("uploadNote")}</div>
                        </div>
                    </div>
                ` : ""}
            </div>

            <div class="submit-area" id="submitArea">
                <button class="smart-submit" onclick="${isBirth ? "submitBirth()" : "submitBooking()"}">
                    <i class="fa-solid ${isLabs || isContacts ? "fa-paper-plane" : "fa-calendar-check"}"></i>
                    ${isContacts ? t("contactBtn") : (isLabs ? t("send") : (isBirth ? t("birthBtn") : t("confirm")))}
                </button>
            </div>

            ${bookingDataNotice()}

            <button class="inline-back-btn" onclick="goBackInSite()">
                <i class="fa-solid fa-arrow-right"></i> ${t("back")}
            </button>
        </div>
    `;

    document.getElementById("bookingArea").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderPregnancyCalc(selectedDate = "") {
    const today = todayISO();

    document.getElementById("bookingArea").innerHTML = `
        <div class="booking-panel">
            <div class="booking-head">
                <h2 style="color:#ec4899;">${t("pregTitle")}</h2>
                <p>${t("pregLead")}</p>
            </div>

            <div class="form-grid">
                <div class="form-field full">
                    <label>${t("pregDate")}</label>
                    <input type="date" id="lastPeriodDate" max="${today}" value="${selectedDate}">
                </div>
            </div>

            <button class="smart-submit pregnancy-submit" style="margin-top:16px;" onclick="calculatePregnancy()">
                <i class="fa-solid fa-baby"></i> ${t("pregBtn")}
            </button>

            <div id="pregnancyResult"></div>

            <button class="inline-back-btn" onclick="goBackInSite()">
                <i class="fa-solid fa-arrow-right"></i> ${t("back")}
            </button>
        </div>
    `;
    document.getElementById("bookingArea").scrollIntoView({ behavior: "smooth", block: "start" });
}

function calculatePregnancy() {
    const d = document.getElementById("lastPeriodDate").value;
    calculatePregnancyForDate(d, true);
}

function calculatePregnancyForDate(d, addHistory = true) {
    if (!d) {
        showSoftAlert(t("alertTitle"), currentLang === "ar" ? "اختاري تاريخ أول يوم في آخر دورة" : "Please choose the first day of your last period");
        return;
    }

    const start = new Date(d);
    const totalDays = Math.floor((new Date() - start) / (1000 * 60 * 60 * 24));

    if (totalDays > 296) {
        showSoftAlert(t("alertTitle"), currentLang === "ar" ? "التاريخ غير منطقي، المدة تجاوزت أقصى مدة للحمل (42 أسبوعاً)." : "Date exceeds maximum pregnancy duration (42 weeks).");
        return;
    }
    if (totalDays < 0) {
        showSoftAlert(t("alertTitle"), currentLang === "ar" ? "لا يمكن اختيار تاريخ في المستقبل." : "Cannot choose a future date.");
        return;
    }

    // Keep the menstrual-cycle date only in memory; do not place health data in browser history state.
    lastPregnancyCalcDate = d;

    if (addHistory) {
        const current = history.state && typeof history.state === "object" ? history.state : {};
        const calcState = { ...current, clinicSite: true, clinicSection: "booking", clinicBookingView: "pregnancyCalc" };
        history.replaceState(calcState, "", location.href);
        history.pushState({ ...calcState, clinicBookingView: "pregnancyResult" }, "", location.href);
        currentBookingView = "pregnancyResult";
    }

    document.getElementById("pregnancyResult").innerHTML = `
        <div class="processing-card" style="margin-top:18px;">
            <div class="spinner"></div>
            <p style="font-weight:900;color:var(--dark-pink);">${currentLang === "ar" ? "جارٍ الحساب..." : "Calculating..."}</p>
        </div>
    `;

    setTimeout(() => {
        const weeks = Math.floor(totalDays / 7);
        const days = totalDays % 7;
        const month = Math.min(9, Math.max(1, Math.ceil(weeks / 4.3)));
        const due = new Date(start);
        due.setDate(due.getDate() + 280);
        const locale = currentLang === "ar" ? "ar-EG" : "en-US";
        const dueText = due.toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });

        const resultText = currentLang === "ar"
            ? `أنتِ في الشهر <strong>${month}</strong> وموعد الولادة المتوقع هو <strong style="color:#dc2626;">${dueText}</strong>`
            : `Month: <strong>${month}</strong> | Due Date: <strong style="color:#dc2626;">${dueText}</strong>`;

        const neonWeeks = `<div class="neon-text">${weeks} ${currentLang === "ar" ? "أسبوع" : "Weeks"} ${days > 0 ? (currentLang === "ar" ? "و " + days + " يوم" : "and " + days + " Days") : ""}</div>`;
        const journeyPercent = Math.min(100, Math.round(totalDays / 280 * 100));
        const trimesterIndex = weeks < 14 ? 0 : weeks < 28 ? 1 : 2;
        const journeyTitle = currentLang === "ar" ? "رحلتك للأمومة" : "Your journey to motherhood";
        const journeyLabel = currentLang === "ar" ? `${journeyPercent}% من رحلة الأربعين أسبوعًا` : `${journeyPercent}% of the 40-week journey`;
        const weekCount = currentLang === "ar" ? `${weeks} من 40 أسبوعًا` : `${weeks} of 40 weeks`;
        const trimesterLabels = currentLang === "ar" ? ["الثلث الأول", "الثلث الثاني", "الثلث الأخير"] : ["First trimester", "Second trimester", "Third trimester"];
        const trimesterTrack = `<div class="pregnancy-trimester-track" aria-label="${currentLang === "ar" ? "مرحلة الحمل التقريبية" : "Approximate pregnancy stage"}">${trimesterLabels.map((label, index) => `<span class="pregnancy-trimester ${index === trimesterIndex ? "is-active" : ""}">${label}</span>`).join("")}</div>`;

        const prayer = currentLang === "ar"
            ? "اللهم سهّل حملها وولادتها، واحفظها هي وجنينها، وارزقها ساعة ولادة هينة وطفلاً سليماً معافى 🤰🏻🤲🏻."
            : "May God make your pregnancy and delivery easy, protect you and your baby, and bless you with a healthy child 🤰🏻🤲🏻.";

        document.getElementById("pregnancyResult").innerHTML = `
            <div class="pregnancy-result-card">
                <div class="baby-icon"><i class="fa-solid fa-baby-carriage"></i></div>
                <h3>${t("pregResultTitle")}</h3>
                <div class="pregnancy-journey" role="progressbar" aria-label="${journeyTitle}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${journeyPercent}">
                    <div class="pregnancy-journey-ring" style="--progress:${journeyPercent}%"><span><i class="fa-solid fa-heart" aria-hidden="true"></i></span></div>
                    <div class="pregnancy-journey-copy"><strong>${journeyTitle}</strong><span>${journeyLabel}</span></div>
                    <b class="pregnancy-week-count">${weekCount}</b>
                </div>
                ${trimesterTrack}
                ${neonWeeks}
                <p class="result-text">${resultText}</p>
                <div class="pregnancy-prayer">${prayer}</div>
            </div>
        `;
    }, 1000);
}

function toggleUpload(el) {
    document.getElementById("uploadBox").style.display = el.checked ? "block" : "none";
}

function checkNameInput(el) {
    const err = document.getElementById("nameErr");
    const invalid = el.value.trim() && el.value.trim().split(/\s+/).length < 3;
    err.style.display = invalid ? "block" : "none";
    el.setAttribute("aria-invalid", invalid ? "true" : "false");
}

function checkPhoneInput(el) {
    el.value = normalizeDigits(el.value).replace(/[^0-9]/g, "").slice(0, 11);
    const err = document.getElementById("phoneErr");
    const invalid = el.value.length > 0 && !/^01\d{9}$/.test(el.value);
    err.style.display = invalid ? "block" : "none";
    el.setAttribute("aria-invalid", invalid ? "true" : "false");
}

function checkWeekend(el) {
    if (!el.value) return;

    const selectedDate = localDateFromISO(el.value);
    const today = localDateFromISO(todayISO());
    if (selectedDate < today) {
        showSoftAlert(t("alertTitle"), currentLang === "ar" ? "لا يمكن اختيار تاريخ سابق لليوم." : "Please choose today or a future date.");
        el.value = "";
        return;
    }

    const isExpectedDeliveryDate = currentBookingType === "birth";
    const day = selectedDate.getDay();
    if (!isExpectedDeliveryDate && (day === 1 || day === 4 || day === 5)) {
        document.getElementById("fridayAlert").style.display = "flex";
        el.value = "";
        return;
    }
    if (currentBookingType === "consult") check15Days();
}

function closeFri() {
    document.getElementById("fridayAlert").style.display = "none";
}

function showSoftAlert(title, msg) {
    document.getElementById("softAlertTitle").innerText = title;
    document.getElementById("softAlertMsg").innerText = msg;
    const alert = document.getElementById("softAlert");
    alert.style.display = "flex";
    alert.classList.remove("notification-arrive");
    void alert.offsetWidth;
    alert.classList.add("notification-arrive");
}

function closeSoftAlert() {
    const alert = document.getElementById("softAlert");
    alert.style.display = "none";
    alert.classList.remove("notification-arrive");
}

function check15Days() {
    const lastVisitVal = document.getElementById("pLastVisit").value;
    const bookingDateVal = document.getElementById("pBookingDate").value;
    const fb = document.getElementById("dateFeedback");
    const sub = document.getElementById("submitArea");

    if (!lastVisitVal || !bookingDateVal) return;

    const diff = Math.floor((new Date(bookingDateVal) - new Date(lastVisitVal)) / (1000 * 60 * 60 * 24));

    if (diff > 15) {
        fb.innerHTML = `<span style="color:var(--error-red);">${currentLang === "ar" ? "المدة تجاوزت 15 يوماً. من فضلك احجزي كشف جديد." : "More than 15 days. Please book a new visit."}</span>`;
        sub.innerHTML = `<button class="smart-submit" onclick="selectVisit('first')">${currentLang === "ar" ? "حجز كشف جديد" : "Book New Visit"}</button>`;
    } else {
        fb.innerHTML = `<span style="color:var(--success-green);">${currentLang === "ar" ? "متاح للاستشارة. متبقي " + (15 - diff) + " يوم داخل مدة المتابعة." : "Consultation available. " + (15 - diff) + " days remaining."}</span>`;
        sub.innerHTML = `<button class="smart-submit" onclick="submitBooking()"><i class="fa-solid fa-calendar-check"></i> ${t("confirm")}</button>`;
    }
}

function validateRequired(isBirth = false) {
    const name = document.getElementById("pName").value.trim();
    const phoneEl = document.getElementById("pPhone");
    const phone = normalizeDigits(phoneEl.value).replace(/[^0-9]/g, "");
    phoneEl.value = phone;
    const dateEl = document.getElementById("pBookingDate");
    const date = dateEl ? dateEl.value : "";
    const lastVisit = document.getElementById("pLastVisit") ? document.getElementById("pLastVisit").value : "";
    const isContacts = currentBookingType === "contacts";

    if (!isContacts && date) {
        const selectedDate = localDateFromISO(date);
        const today = localDateFromISO(todayISO());
        if (selectedDate < today) {
            showSoftAlert(t("alertTitle"), currentLang === "ar" ? "لا يمكن اختيار تاريخ سابق لليوم." : "Please choose today or a future date.");
            return null;
        }
        const weekday = selectedDate.getDay();
        if (!isBirth && (weekday === 1 || weekday === 4 || weekday === 5)) {
            showSoftAlert(t("holidayTitle"), t("holidayMsg"));
            return null;
        }
    }

    let errors = [];
    if (name.split(/\s+/).length < 3) errors.push(t("name"));
    if (!/^01\d{9}$/.test(phone)) errors.push(t("phone"));
    if (!isContacts && !date) errors.push(isBirth ? t("deliveryDate") : t("bookingDate"));
    if (currentBookingType === "consult" && !lastVisit) errors.push(t("lastVisit"));

    if (errors.length) {
        showSoftAlert(t("alertTitle"), t("errData") + errors.join(" - "));
        return null;
    }

    return { name, phone, date, lastVisit };
}

function fileToBase64(file) {
    return new Promise(resolve => {
        if (!file) return resolve({ attachmentName: "", attachmentBase64: "" });
        const reader = new FileReader();
        reader.onload = () => resolve({
            attachmentName: file.name,
            attachmentBase64: String(reader.result).split(",")[1] || ""
        });
        reader.onerror = () => resolve({ attachmentName: file.name, attachmentBase64: "" });
        reader.readAsDataURL(file);
    });
}

function showProcessing() {
    const steps = IS_LOCAL_PREVIEW
        ? (currentLang === "ar"
            ? ["جارٍ تجهيز المعاينة المحلية...", "جارٍ مراجعة البيانات...", "جارٍ عرض النتيجة التجريبية..."]
            : ["Preparing local preview...", "Reviewing the details...", "Showing the simulated result..."])
        : (currentLang === "ar"
            ? ["جارٍ إرسال البيانات...", "جارٍ مراجعة الموعد...", "جارٍ تأكيد الحجز..."]
            : ["Sending data...", "Reviewing appointment...", "Confirming booking..."]);

    let index = 0;

    document.getElementById("bookingArea").innerHTML = `
        <div class="processing-card">
            <div class="spinner"></div>
            <p id="progressText" style="font-weight:900;color:var(--dark-pink);">${steps[0]}</p>
        </div>
    `;

    // النزول التلقائي لمنتصف الشاشة لتكون علامة التحميل واضحة للمستخدم
    document.getElementById("bookingArea").scrollIntoView({ behavior: "smooth", block: "center" });

    const timer = setInterval(() => {
        const el = document.getElementById("progressText");
        if (!el) {
            clearInterval(timer);
            return;
        }
        index = (index + 1) % steps.length;
        el.innerText = steps[index];
    }, 600);

    return timer;
}

function isSupabaseConfigured() {
    return typeof window.CLINIC_SUPABASE !== "undefined" &&
        Boolean(window.CLINIC_SUPABASE.url && window.CLINIC_SUPABASE.anonKey);
}

async function sendBooking(payload) {
    if (!isSupabaseConfigured()) {
        const response = await fetch(SCRIPT_URL, { method: "POST", body: JSON.stringify(payload) });
        if (!response.ok) throw new Error("تعذر الاتصال بخدمة الحجز");
        return response.json();
    }

    const { url, anonKey } = window.CLINIC_SUPABASE;
    const headers = { "Content-Type": "application/json", apikey: anonKey };
    // Publishable keys are API keys, not JWTs; legacy anon keys are JWTs.
    if (!anonKey.startsWith("sb_publishable_")) headers.Authorization = `Bearer ${anonKey}`;
    const response = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/rpc/create_booking`, {
        method: "POST",
        headers,
        body: JSON.stringify({ payload })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "تعذر إرسال طلب الحجز");
    return result;
}

function showFamilyMember(valid, message) {
    pushBookingResult("success");
    document.getElementById("bookingArea").innerHTML = `
        <div class="result-card family-welcome-card">
            <div class="result-celebration" aria-hidden="true">💗 ✨ 🌸 ✨ 💗</div>
            <div class="result-icon"><i class="fa-solid fa-heart-circle-check"></i></div>
            <h2>${currentLang === "ar" ? "أنتِ من عائلة العيادة بالفعل" : "You are already part of our clinic family"}</h2>
            <p>${escapeHtml(message || (currentLang === "ar" ? "من أول يوم حجزتِ فيه معنا أصبحتِ جزءًا من عائلة العيادة." : "You have been part of our clinic family since your first visit."))}</p>
            <div class="details-box"><div class="detail-item"><span class="detail-label">${currentLang === "ar" ? "الاسم" : "Name"}</span><span class="detail-value">${escapeHtml(valid.name)}</span></div><div class="detail-item"><span class="detail-label">${currentLang === "ar" ? "الهاتف" : "Phone"}</span><span class="detail-value">${escapeHtml(valid.phone)}</span></div></div>
            ${bookingDataNotice()}
            <button class="inline-back-btn" onclick="goBackInSite()">${currentLang === "ar" ? "رجوع للرئيسية" : "Back"}</button>
        </div>`;
    document.getElementById("bookingArea").scrollIntoView({ behavior: "smooth", block: "center" });
    celebrateBooking();
}

async function submitBooking() {
    const valid = validateRequired(false);
    if (!valid) return;

    const message = document.getElementById("pMessage").value.trim();
    const file = document.getElementById("pAttachment") ? document.getElementById("pAttachment").files[0] : null;
    const attachment = await fileToBase64(file);
    const hasAttachment = !!attachment.attachmentName;
    const progressTimer = showProcessing();
    const payload = {
        name: valid.name,
        phone: valid.phone,
        type: currentBookingType,
        bookingDate: currentBookingType === "contacts" ? "" : (valid.date || todayISO()),
        lastVisit: valid.lastVisit || "",
        message,
        source: visitLabel(currentBookingType),
        attachmentName: attachment.attachmentName,
        attachmentBase64: attachment.attachmentBase64,
        attachmentType: attachment.attachmentType
    };

    if (IS_LOCAL_PREVIEW) {
        clearInterval(progressTimer);
        showSuccess(valid, `LOCAL-${Math.floor(1000 + Math.random() * 9000)}`, visitLabel(currentBookingType), message, hasAttachment);
        return;
    }

    try {
        const response = await sendBooking(payload);
        clearInterval(progressTimer);
        if (response.status === "holiday" || response.status === "invalid" || response.status === "error") {
            showSoftAlert(currentLang === "ar" ? "تعذر تسجيل الطلب" : "Request not registered", response.message || t("errData"));
            return;
        }
        if (response.status === "family_member") {
            showFamilyMember(valid, response.message);
            return;
        }
        if (!["success", "duplicate", "duplicated"].includes(response.status)) {
            showSoftAlert(currentLang === "ar" ? "تعذر تسجيل الطلب" : "Request not registered", currentLang === "ar"
                ? response.message || "لم يصل تأكيد التسجيل من النظام. حاولي مرة أخرى أو تواصلي مع العيادة."
                : response.message || "The system did not confirm registration. Please try again or contact the clinic.");
            return;
        }

        const prefix = getBookingIdPrefix(currentBookingType);
        const rawId = String(response.id || response.bookingId || Math.floor(1000 + Math.random() * 9000));
        const finalId = rawId.startsWith("BK-") ? rawId : prefix + rawId.replace(/[^0-9]/g, "");
        if (["duplicate", "duplicated"].includes(response.status)) {
            const oldData = {
                name: response.oldName || response.name || valid.name,
                phone: response.oldPhone || response.phone || valid.phone,
                date: response.oldDate || response.date || valid.date || todayISO()
            };
            const duplicateId = String(response.bookingId || response.id || finalId);
            const duplicateFinalId = duplicateId.startsWith("BK-") ? duplicateId : prefix + duplicateId.replace(/[^0-9]/g, "");
            showDuplicated(oldData, duplicateFinalId, response.message || (currentLang === "ar" ? "يوجد حجز مسبق بهذا الرقم." : "There is already a booking for this number."), hasAttachment, message);
            return;
        }
        showSuccess(valid, finalId, visitLabel(currentBookingType), message, hasAttachment);
    } catch (error) {
        clearInterval(progressTimer);
        showSoftAlert(currentLang === "ar" ? "تعذر إرسال الطلب" : "Unable to send request", currentLang === "ar"
            ? "لم يصلنا تأكيد تسجيل الطلب. تحققي من الاتصال وحاولي مرة أخرى، أو تواصلي مع العيادة مباشرة."
            : "We could not confirm that your request was registered. Check your connection and try again, or contact the clinic directly.");
    }
}


async function submitBirth() {
    const valid = validateRequired(true);
    if (!valid) return;

    const dueDate = localDateFromISO(valid.date);
    const today = localDateFromISO(todayISO());
    const daysLeft = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
    const message = currentLang === "ar" ? "متبقي تقريباً " + Math.max(0, daysLeft) + " يوم" : "Approximately " + Math.max(0, daysLeft) + " days remaining";
    const progressTimer = showProcessing();
    const payload = {
        name: valid.name,
        phone: valid.phone,
        type: "birth",
        bookingDate: valid.date,
        message,
        source: visitLabel("birth"),
        attachmentName: "",
        attachmentBase64: "",
        attachmentType: ""
    };

    if (IS_LOCAL_PREVIEW) {
        clearInterval(progressTimer);
        showBirthSuccess(valid, `LOCAL-${Math.floor(1000 + Math.random() * 9000)}`, message);
        return;
    }

    try {
        const response = await sendBooking(payload);
        clearInterval(progressTimer);
        if (["holiday", "invalid", "error"].includes(response.status)) {
            showSoftAlert(currentLang === "ar" ? "تعذر تسجيل الطلب" : "Request not registered", response.message || t("errData"));
            return;
        }
        if (!["success", "duplicate", "duplicated"].includes(response.status)) {
            showSoftAlert(currentLang === "ar" ? "تعذر تسجيل الطلب" : "Request not registered", response.message || t("errData"));
            return;
        }
        const prefix = getBookingIdPrefix("birth");
        const rawId = String(response.id || response.bookingId || Math.floor(1000 + Math.random() * 9000));
        const finalId = rawId.startsWith("BK-") ? rawId : prefix + rawId.replace(/[^0-9]/g, "");
        if (["duplicate", "duplicated"].includes(response.status)) {
            const oldData = {
                name: response.oldName || response.name || valid.name,
                phone: response.oldPhone || response.phone || valid.phone,
                date: response.oldDate || response.date || valid.date || todayISO()
            };
            const duplicateId = String(response.bookingId || response.id || finalId);
            const duplicateFinalId = duplicateId.startsWith("BK-") ? duplicateId : prefix + duplicateId.replace(/[^0-9]/g, "");
            showDuplicated(oldData, duplicateFinalId, response.message || (currentLang === "ar" ? "يوجد حجز مسبق بهذا الرقم." : "There is already a booking for this number."), false, message);
            return;
        }
        showBirthSuccess(valid, finalId, message);
    } catch (error) {
        clearInterval(progressTimer);
        showSoftAlert(currentLang === "ar" ? "تعذر إرسال الطلب" : "Unable to send request", currentLang === "ar"
            ? "لم يصلنا تأكيد تسجيل الطلب. تحققي من الاتصال وحاولي مرة أخرى، أو تواصلي مع العيادة مباشرة."
            : "We could not confirm that your request was registered. Check your connection and try again, or contact the clinic directly.");
    }
}


function showBirthSuccess(valid, finalId, message) {
    pushBookingResult("success");
    const now = new Date();
    const regTime = now.toLocaleString(currentLang === "ar" ? "ar-EG" : "en-US");

    const data = {
        id: finalId,
        type: visitLabel("birth"),
        name: valid.name,
        phone: valid.phone,
        date: valid.date,
        regTime,
        message: message,
        hasAttachment: false
    };

    const waUrl = `https://wa.me/${CLINIC_WHATSAPP}?text=${encodeURIComponent(buildWhatsappText(data))}`;

    document.getElementById("bookingArea").innerHTML = `
        <div class="result-card">
            <div class="result-celebration" aria-hidden="true">💗 ✨ 🌸 ✨ 💗</div>
            <div class="result-icon"><i class="fa-solid fa-baby"></i></div>
            <h2 style="color:var(--dark-pink);">${IS_LOCAL_PREVIEW ? (currentLang === "ar" ? "اكتملت معاينة النموذج ✨" : "Preview complete ✨") : (currentLang === "ar" ? "تم تسجيل طلب حجز الولادة 🎉" : "Delivery booking request registered 🎉")}</h2>
            ${detailsHtml(data)}
            <div class="notice-board ${IS_LOCAL_PREVIEW ? "local-preview-result" : ""}">${IS_LOCAL_PREVIEW ? (currentLang === "ar" ? "محاكاة محلية فقط: لم يتم إرسال الحجز أو حفظه في قاعدة البيانات أو الشيت، ولم تُرسل أي رسالة." : "Local preview only: this request was not sent or saved, and no message was sent.") : (currentLang === "ar" ? "برجاء التواصل مع العيادة لتحديد تفاصيل حجز الولادة وموعد الحضور المناسب." : "Please contact the clinic to arrange delivery booking details.")}</div>
            ${bookingDataNotice()}
            ${!IS_LOCAL_PREVIEW ? `<a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="premium-wa-link"><i class="fa-brands fa-whatsapp"></i> ${currentLang === "ar" ? "إرسال البيانات للعيادة" : "Send details to clinic"}</a>` : ""}
            <button class="inline-back-btn" onclick="goBackInSite()">${currentLang === "ar" ? "رجوع للرئيسية" : "Back"}</button>
        </div>
    `;
    document.getElementById("bookingArea").scrollIntoView({ behavior: "smooth", block: "center" });
    celebrateBooking();
    handleVibrate();
}

function buildWhatsappText(data) {
    return currentLang === "ar"
        ? `*طلب حجز جديد*\n🆔 رقم الحجز: ${data.id}\n🩺 النوع: ${data.type}\n👤 الاسم: ${data.name}\n📱 الهاتف: ${data.phone}\n📅 التاريخ: ${data.date}\n🕒 وقت التسجيل: ${data.regTime}\n📎 المرفقات: ${data.hasAttachment ? "يوجد مرفقات" : "لا يوجد"}${data.message ? `\n💬 الرسالة: ${data.message}` : ""}\n\nبرجاء تحديد ساعة الحضور، ولإلغاء أو تعديل الحجز يتم التواصل مع العيادة.`
        : `*New Booking Request*\n🆔 Booking ID: ${data.id}\n🩺 Type: ${data.type}\n👤 Name: ${data.name}\n📱 Phone: ${data.phone}\n📅 Date: ${data.date}\n🕒 Registration time: ${data.regTime}\n📎 Attachments: ${data.hasAttachment ? "Attached" : "None"}${data.message ? `\n💬 Message: ${data.message}` : ""}\n\nPlease confirm attendance time. For cancellation or changes, contact the clinic.`;
}

function detailsHtml(data) {
    return `
        <div class="details-box">
            <div class="detail-item"><span class="detail-label">${currentLang === "ar" ? "رقم الحجز" : "Booking ID"}</span><span class="detail-value highlight-value">${escapeHtml(data.id)}</span></div>
            <div class="detail-item"><span class="detail-label">${currentLang === "ar" ? "نوع الطلب" : "Type"}</span><span class="detail-value">${escapeHtml(data.type)}</span></div>
            <div class="detail-item"><span class="detail-label">${currentLang === "ar" ? "الاسم" : "Name"}</span><span class="detail-value">${escapeHtml(data.name)}</span></div>
            <div class="detail-item"><span class="detail-label">${currentLang === "ar" ? "الهاتف" : "Phone"}</span><span class="detail-value">${escapeHtml(data.phone)}</span></div>
            <div class="detail-item"><span class="detail-label">${currentLang === "ar" ? "تاريخ الحجز" : "Booking date"}</span><span class="detail-value highlight-value">${escapeHtml(data.date)}</span></div>
            <div class="detail-item"><span class="detail-label">${currentLang === "ar" ? "وقت التسجيل" : "Registration time"}</span><span class="detail-value">${escapeHtml(data.regTime)}</span></div>
            <div class="detail-item"><span class="detail-label">${currentLang === "ar" ? "المرفقات" : "Attachments"}</span><span class="detail-value">${data.hasAttachment ? (currentLang === "ar" ? "يوجد مرفقات" : "Attached") : (currentLang === "ar" ? "لا يوجد" : "None")}</span></div>
            ${data.message ? `<div class="detail-item"><span class="detail-label">${currentLang === "ar" ? "الرسالة" : "Message"}</span><span class="detail-value">${escapeHtml(data.message)}</span></div>` : ""}
        </div>
    `;
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
}

function showSuccess(valid, finalId, typeAr, message, hasAttachment) {
    pushBookingResult("success");
    const now = new Date();
    const regTime = now.toLocaleString(currentLang === "ar" ? "ar-EG" : "en-US");

    const data = {
        id: finalId,
        type: typeAr,
        name: valid.name,
        phone: valid.phone,
        date: valid.date || todayISO(),
        regTime,
        message,
        hasAttachment
    };

    const waUrl = `https://wa.me/${CLINIC_WHATSAPP}?text=${encodeURIComponent(buildWhatsappText(data))}`;

    let noticeBoardHtml = "";
    if (typeAr === formText.ar.contacts || typeAr === formText.en.contacts) {
        noticeBoardHtml = currentLang === "ar"
            ? "تم تسجيل بياناتك بنجاح. شكراً لانضمامك لعائلة عيادة د. دعاء شعبان، ستصلك أهم نصائحنا وعروضنا قريباً."
            : "Your details have been successfully registered. Thank you for joining Dr. Doaa Shaban's clinic family.";
    } else {
        noticeBoardHtml = currentLang === "ar"
            ? "برجاء إرسال بيانات الحجز للعيادة عبر واتساب لتحديد ساعة الحضور. يعتبر الحجز غير مؤكد نهائياً بدون التواصل مع العيادة. ولإلغاء أو تعديل الحجز برجاء التواصل مع العيادة."
            : "Please send booking details to the clinic via WhatsApp to confirm attendance time. Booking is not fully confirmed without clinic confirmation. For cancellation or changes, please contact the clinic.";
    }
    if (IS_LOCAL_PREVIEW) {
        noticeBoardHtml = currentLang === "ar"
            ? "محاكاة محلية فقط: لم يتم إرسال الحجز أو حفظه في قاعدة البيانات أو الشيت، ولم تُرسل أي رسالة."
            : "Local preview only: this request was not sent or saved, and no message was sent.";
    }

    document.getElementById("bookingArea").innerHTML = `
        <div class="result-card">
            <div class="result-celebration" aria-hidden="true">💗 ✨ 🌸 ✨ 💗</div>
            <div class="result-icon"><i class="fa-solid fa-calendar-check"></i></div>
            <h2 style="color:var(--dark-pink);">${IS_LOCAL_PREVIEW ? (currentLang === "ar" ? "اكتملت معاينة النموذج ✨" : "Preview complete ✨") : (currentLang === "ar" ? "تم تسجيل البيانات بنجاح 🎉" : "Details registered successfully 🎉")}</h2>
            ${detailsHtml(data)}
            <div class="notice-board ${IS_LOCAL_PREVIEW ? "local-preview-result" : ""}">${noticeBoardHtml}</div>
            ${bookingDataNotice()}
            ${(!IS_LOCAL_PREVIEW && typeAr !== formText.ar.contacts && typeAr !== formText.en.contacts) ? `<a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="premium-wa-link"><i class="fa-brands fa-whatsapp"></i> ${currentLang === "ar" ? "إرسال البيانات للعيادة" : "Send details to clinic"}</a>` : ""}
            <button class="inline-back-btn" onclick="goBackInSite()">${currentLang === "ar" ? "رجوع للرئيسية" : "Back"}</button>
        </div>
    `;

    document.getElementById("bookingArea").scrollIntoView({ behavior: "smooth", block: "center" });
    celebrateBooking();
    handleVibrate();
}

function celebrateBooking() {
    const layer = document.getElementById("bookingCelebration");
    if (!layer || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
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
    window.setTimeout(() => { layer.classList.remove("is-active"); layer.replaceChildren(); }, 2400);
}

function showDuplicated(oldData, finalId, msg, hasAttachment, message) {
    pushBookingResult("duplicated");
    const waUrl = `https://wa.me/${CLINIC_WHATSAPP}`;

    document.getElementById("bookingArea").innerHTML = `
        <div class="result-card" style="border-color:var(--error-red);">
            <div class="result-icon" style="background:linear-gradient(135deg,#ef4444,#be123c);"><i class="fa-solid fa-circle-exclamation"></i></div>
            <h2 style="color:var(--error-red); margin-bottom: 5px;">${currentLang === "ar" ? "يوجد حجز مسبق بالفعل" : "Existing booking found"}</h2>
            <p style="font-weight:800;line-height:1.8; color:var(--text-main); margin-bottom: 20px;">${escapeHtml(msg)}</p>

            <div class="details-box">
                <div class="detail-item"><span class="detail-label">${currentLang === "ar" ? "رقم الكشف" : "Visit ID"}</span><span class="detail-value highlight-value">${finalId}</span></div>
                <div class="detail-item"><span class="detail-label">${currentLang === "ar" ? "تاريخ التسجيل المسبق" : "Previous Registration"}</span><span class="detail-value">${oldData.date}</span></div>
            </div>

            <div class="notice-board">
                ${currentLang === "ar"
                    ? "لإلغاء الحجز أو تعديل الموعد برجاء التواصل مع العيادة مباشرة عبر واتساب."
                    : "To cancel or modify the booking, please contact the clinic directly via WhatsApp."}
            </div>
            ${bookingDataNotice()}
            <a href="${waUrl}" target="_blank" class="premium-wa-link"><i class="fa-brands fa-whatsapp"></i> ${currentLang === "ar" ? "التواصل مع العيادة" : "Contact clinic"}</a>
            <button class="inline-back-btn" onclick="goBackInSite()">${currentLang === "ar" ? "رجوع للرئيسية" : "Back"}</button>
        </div>
    `;
    document.getElementById("bookingArea").scrollIntoView({ behavior: "smooth", block: "center" });
}

function handleVibrate() {
    if ("vibrate" in navigator) navigator.vibrate(60);
}
