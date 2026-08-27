const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyBOd3JO_sRnL5F8iVDV4VkmepgqWEuhj_g4DVUVs8vXx2W6UAU9wgM6uBNFKKhDUFg/exec";
const CLINIC_WHATSAPP = "201125337717";
const signatureHtml = `<div class="form-signature">Future Reservation System © 2026</div>`;

let currentLang = "ar";
let themes = ["default", "pink", "purple", "mint", "rose"];
let currentThemeIndex = 0;
let isDark = true;
let currentBookingType = "first";
let demandTimer = null;
let flipInterval = null;

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
        holidayFooter: "الإجازة الأسبوعية: الخميس والجمعة",
        mapBtn: "افتحي الموقع على الخريطة",
        holidayTitle: "تنبيه المواعيد",
        holidayMsg: "يوم الخميس والجمعة من العطلات الرسمية بالعيادة. من فضلكِ اختاري يوماً آخر للحجز.",
        understood: "فهمت",
        clickToStart: "اضغطي للبدء",
        groupMedical: "الكشوفات الطبية",
        groupServices: "الخدمات الإضافية",
        groupSpecial: "أقسام مميزة",
        toggleMode: "تغيير المظهر (داكن/فاتح)"
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
        holidayFooter: "Weekly holiday: Thursday and Friday",
        mapBtn: "Open Location",
        holidayTitle: "Appointment Alert",
        holidayMsg: "Thursday and Friday are clinic holidays. Please choose another booking day.",
        understood: "OK",
        clickToStart: "Tap to Start",
        groupMedical: "Medical Visits",
        groupServices: "Extra Services",
        groupSpecial: "Special Sections",
        toggleMode: "Toggle Mode (Dark/Light)"
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
        demand: "يوجد 3 أشخاص يستخدمون نظام الحجز الآن",
        nameErr: "من فضلك اكتبي الاسم ثلاثي",
        phoneErr: "رقم الهاتف يجب أن يكون 11 رقم",
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
        demand: "3 people are using the booking system now",
        nameErr: "Please enter full name",
        phoneErr: "Phone number must be 11 digits",
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
    currentThemeIndex = Math.floor(Math.random() * themes.length);
    setTheme(themes[currentThemeIndex]);

    renderBookingStart();
    animateStats();
    updateClock();
    setInterval(updateClock, 1000);
    applyLanguage();

    // غلق قائمة الألوان عند الضغط خارجها
    document.addEventListener("click", function(event) {
        let menu = document.getElementById("themeMenu");
        let btn = document.querySelector(".control-group .fa-palette").parentElement;
        if (menu && btn && !menu.contains(event.target) && !btn.contains(event.target)) {
            menu.classList.remove("open");
        }
    });
});

function startExperience() {
    let splash = document.getElementById("splash");
    splash.classList.add("hide");
    setTimeout(() => { splash.style.display = "none"; }, 800);
}

function toggleThemeMenu() {
    document.getElementById("themeMenu").classList.toggle("open");
}

function t(key) { return formText[currentLang][key] || key; }
function toggleMobileMenu() { document.getElementById("mobileMenu").classList.toggle("open"); }

function toggleLanguage() {
    currentLang = currentLang === "ar" ? "en" : "ar";
    document.getElementById("langBtn").innerText = currentLang === "ar" ? "EN" : "AR";
    document.documentElement.lang = currentLang;
    document.body.classList.toggle("en-mode", currentLang === "en");
    applyLanguage();
    renderBookingStart();
}

function applyLanguage() {
    document.querySelectorAll("[data-i18n]").forEach(el => {
        const key = el.getAttribute("data-i18n");
        if (dict[currentLang][key]) el.innerText = dict[currentLang][key];
    });
}

function toggleDarkMode() {
    isDark = !isDark;
    document.documentElement.setAttribute("data-mode", isDark ? "dark" : "light");
    document.getElementById("themeMenu").classList.remove("open");
}

function setTheme(theme) {
    if (theme === "default") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    document.getElementById("themeMenu").classList.remove("open");
}

function nextTheme() {
    currentThemeIndex = (currentThemeIndex + 1) % themes.length;
    setTheme(themes[currentThemeIndex]);
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

function todayISO() { return new Date().toISOString().split("T")[0]; }

function renderBookingStart() {
    clearInterval(demandTimer);
    clearInterval(flipInterval);

    document.getElementById("bookingArea").innerHTML = `
        <div class="booking-panel">
            <div class="booking-head">
                <h2>${t("chooseTitle")}</h2>
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
        </div>
    `;
    startRandomFlips();
}

function visitCard(type, icon, label, special = false) {
    const familyClass = type === "contacts" ? "family-card" : "";
    const desc = visitDesc[currentLang][type];
    
    return `
        <div class="flip-card ${special ? "special" : ""} ${familyClass}" onclick="selectVisit('${type}')">
            <div class="flip-card-inner">
                <div class="flip-card-front">
                    <i class="fa-solid ${icon}"></i>
                    <span>${label}</span>
                </div>
                <div class="flip-card-back">
                    <p>${desc}</p>
                </div>
            </div>
        </div>
    `;
}

function startRandomFlips() {
    flipInterval = setInterval(() => {
        const cards = document.querySelectorAll('.flip-card-inner');
        if(cards.length === 0) return;
        
        cards.forEach(c => c.classList.remove('force-flip'));
        
        const randomCard = cards[Math.floor(Math.random() * cards.length)];
        randomCard.classList.add('force-flip');
        
        setTimeout(() => {
            if(randomCard) randomCard.classList.remove('force-flip');
        }, 2000);
    }, 4000);
}

function selectVisit(type) {
    currentBookingType = type;
    if (type === "pregnancy") renderPregnancyCalc();
    else renderBookingForm();
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

    clearInterval(demandTimer);
    clearInterval(flipInterval);

    document.getElementById("bookingArea").innerHTML = `
        <div class="booking-panel" id="activeForm">
            <div class="booking-head">
                <h2 style="font-size:clamp(1.8rem, 4vw, 2.5rem); padding: 5px 20px;">${visitLabel(currentBookingType)}</h2>
                <p id="liveBookingHint">${isContacts ? t("contactsDesc") : t("demand")}</p>
            </div>

            <div class="form-grid">
                <div class="form-field">
                    <label>${t("name")}</label>
                    <input type="text" id="pName" placeholder="${t("name")}" oninput="checkNameInput(this)">
                    <div id="nameErr" class="error-hint">${t("nameErr")}</div>
                </div>

                <div class="form-field">
                    <label>${t("phone")}</label>
                    <input type="tel" id="pPhone" maxlength="11" placeholder="011xxxxxxxx" oninput="checkPhoneInput(this)">
                    <div id="phoneErr" class="error-hint">${t("phoneErr")}</div>
                </div>

                ${!isContacts ? `
                <div class="form-field full">
                    <label>${isBirth ? t("deliveryDate") : (isLabs ? t("contactDate") : t("bookingDate"))}</label>
                    <input type="date" id="pBookingDate" min="${today}" onchange="checkWeekend(this)">
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

            <button class="inline-back-btn" onclick="renderBookingStart()">
                <i class="fa-solid fa-arrow-right"></i> ${t("back")}
            </button>
            ${signatureHtml}
        </div>
    `;

    if (!isContacts) simulateDemand();
    document.getElementById("bookingArea").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderPregnancyCalc() {
    const today = todayISO();
    clearInterval(flipInterval);
    
    document.getElementById("bookingArea").innerHTML = `
        <div class="booking-panel">
            <div class="booking-head">
                <h2 style="color:#ec4899;">${t("pregTitle")}</h2>
                <p>${t("pregLead")}</p>
            </div>

            <div class="form-grid">
                <div class="form-field full">
                    <label>${t("pregDate")}</label>
                    <input type="date" id="lastPeriodDate" max="${today}">
                </div>
            </div>

            <button class="smart-submit pregnancy-submit" style="margin-top:16px;" onclick="calculatePregnancy()">
                <i class="fa-solid fa-baby"></i> ${t("pregBtn")}
            </button>

            <div id="pregnancyResult"></div>

            <button class="inline-back-btn" onclick="renderBookingStart()">
                <i class="fa-solid fa-arrow-right"></i> ${t("back")}
            </button>
            ${signatureHtml}
        </div>
    `;
    document.getElementById("bookingArea").scrollIntoView({ behavior: "smooth", block: "start" });
}

function calculatePregnancy() {
    const d = document.getElementById("lastPeriodDate").value;
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

        const prayer = currentLang === "ar"
            ? "اللهم سهّل حملها وولادتها، واحفظها هي وجنينها، وارزقها ساعة ولادة هينة وطفلاً سليماً معافى 🤰🏻🤲🏻."
            : "May God make your pregnancy and delivery easy, protect you and your baby, and bless you with a healthy child 🤰🏻🤲🏻.";

        document.getElementById("pregnancyResult").innerHTML = `
            <div class="pregnancy-result-card">
                <div class="baby-icon"><i class="fa-solid fa-baby-carriage"></i></div>
                <h3>${t("pregResultTitle")}</h3>
                ${neonWeeks}
                <p class="result-text">${resultText}</p>
                <div class="pregnancy-prayer">${prayer}</div>
            </div>
        `;
    }, 1000);
}

function simulateDemand() {
    let count = 3;
    demandTimer = setInterval(() => {
        const el = document.getElementById("liveBookingHint");
        if (!el) {
            clearInterval(demandTimer);
            return;
        }
        count = Math.max(1, count + (Math.random() > 0.5 ? 1 : -1));
        el.innerText = currentLang === "ar"
            ? "يوجد " + count + " أشخاص يستخدمون نظام الحجز الآن"
            : count + " people are using the booking system now";
    }, 3000);
}

function toggleUpload(el) {
    document.getElementById("uploadBox").style.display = el.checked ? "block" : "none";
}

function checkNameInput(el) {
    const err = document.getElementById("nameErr");
    err.style.display = el.value.trim() && el.value.trim().split(/\s+/).length < 3 ? "block" : "none";
}

function checkPhoneInput(el) {
    el.value = el.value.replace(/[^0-9]/g, "");
    const err = document.getElementById("phoneErr");
    err.style.display = el.value.length > 0 && el.value.length < 11 ? "block" : "none";
}

function checkWeekend(el) {
    if (!el.value) return;

    /* =======================================
       تعديل: إجازة عيد الأضحى المبارك
       من 26 مايو 2026 حتى 31 مايو 2026
       والعودة للعمل يوم الاثنين 1 يونيو 2026
       ======================================= */
    const parts = el.value.split("-").map(Number);
    const selectedDate = new Date(parts[0], parts[1] - 1, parts[2]);
    selectedDate.setHours(0, 0, 0, 0);

    const holidayStart = new Date(2026, 4, 26);
    const holidayEnd = new Date(2026, 4, 31);
    holidayStart.setHours(0, 0, 0, 0);
    holidayEnd.setHours(23, 59, 59, 999);

    if (selectedDate >= holidayStart && selectedDate <= holidayEnd) {
        showSoftAlert(
            currentLang === "ar" ? "إجازة عيد الأضحى" : "Eid Al-Adha Holiday",
            currentLang === "ar"
                ? "العيادة إجازة من الثلاثاء 26 مايو 2026 حتى الأحد 31 مايو 2026، والعودة للعمل يوم الاثنين 1 يونيو 2026. كل عام وأنتم بخير 🎉"
                : "The clinic is closed from Tuesday, May 26, 2026 to Sunday, May 31, 2026, and will reopen on Monday, June 1, 2026. Happy Eid 🎉"
        );
        el.value = "";
        return;
    }
    /* ======================================= */

    const day = selectedDate.getDay();
    if (day === 4 || day === 5) {
        document.getElementById("fridayAlert").style.display = "flex";
        el.value = "";
    }
    if (currentBookingType === "consult") check15Days();
}

function closeFri() {
    document.getElementById("fridayAlert").style.display = "none";
}

function showSoftAlert(title, msg) {
    document.getElementById("softAlertTitle").innerText = title;
    document.getElementById("softAlertMsg").innerText = msg;
    document.getElementById("softAlert").style.display = "flex";
}

function closeSoftAlert() {
    document.getElementById("softAlert").style.display = "none";
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
    const phone = document.getElementById("pPhone").value;
    const dateEl = document.getElementById("pBookingDate");
    const date = dateEl ? dateEl.value : "";
    const lastVisit = document.getElementById("pLastVisit") ? document.getElementById("pLastVisit").value : "";
    const isContacts = currentBookingType === "contacts";

    let errors = [];
    if (name.split(/\s+/).length < 3) errors.push(t("name"));
    if (phone.length < 11) errors.push(t("phone"));
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
    const steps = currentLang === "ar"
        ? ["جارٍ إرسال البيانات...", "جارٍ مراجعة الموعد...", "جارٍ تأكيد الحجز..."]
        : ["Sending data...", "Reviewing appointment...", "Confirming booking..."];

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
        bookingDate: valid.date || todayISO(),
        lastVisit: valid.lastVisit,
        message,
        source: visitLabel(currentBookingType),
        attachmentName: attachment.attachmentName,
        attachmentBase64: attachment.attachmentBase64
    };

    try {
        const res = await fetch(SCRIPT_URL, { method: "POST", body: JSON.stringify(payload) });
        const response = await res.json();
        clearInterval(progressTimer);

        /* --- تعديل إجازة العيد --- */
        if (response.status === "holiday") {
            showSoftAlert(currentLang === "ar" ? "إجازة العيد" : "Eid Holiday", response.message);
            return;
        }
        /* ----------------------- */

        const prefix = getBookingIdPrefix(currentBookingType);
        const rawId = String(response.id || response.bookingId || Math.floor(1000 + Math.random() * 9000));
        const randNum = rawId.replace(/[^0-9]/g, '');
        const finalId = prefix + randNum;

        if (response.status === "duplicated") {
            const oldData = {
                name: response.oldName || valid.name,
                phone: response.oldPhone || valid.phone,
                date: response.oldDate || valid.date || todayISO()
            };
            const oldRawId = String(response.bookingId || finalId);
            const oldCleanId = oldRawId.replace(/[^0-9]/g, '');

            showDuplicated(oldData, prefix + oldCleanId, response.message || (currentLang === "ar" ? "يوجد حجز مسبق بهذا الرقم." : "There is already a booking for this number."), hasAttachment, message);
            return;
        }

        showSuccess(valid, finalId, visitLabel(currentBookingType), message, hasAttachment);
    } catch (e) {
        clearInterval(progressTimer);
        const prefix = getBookingIdPrefix(currentBookingType);
        const finalId = prefix + Math.floor(1000 + Math.random() * 9000);
        showSuccess(valid, finalId, visitLabel(currentBookingType), message, hasAttachment);
    }
}

async function submitBirth() {
    const valid = validateRequired(true);
    if (!valid) return;

    const dueDate = new Date(valid.date);
    const today = new Date();
    const daysLeft = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
    const message = currentLang === "ar" ? "متبقي تقريباً " + Math.max(0, daysLeft) + " يوم" : "Approximately " + Math.max(0, daysLeft) + " days remaining";
    
    const progressTimer = showProcessing();

    const payload = {
        name: valid.name,
        phone: valid.phone,
        type: currentBookingType,
        bookingDate: valid.date,
        message: message,
        source: visitLabel("birth"),
        attachmentName: "",
        attachmentBase64: ""
    };

    try {
        const res = await fetch(SCRIPT_URL, { method: "POST", body: JSON.stringify(payload) });
        const response = await res.json();
        clearInterval(progressTimer);

        /* --- تعديل إجازة العيد --- */
        if (response.status === "holiday") {
            showSoftAlert(currentLang === "ar" ? "إجازة العيد" : "Eid Holiday", response.message);
            return;
        }
        /* ----------------------- */

        const prefix = getBookingIdPrefix("birth");
        const rawId = String(response.id || response.bookingId || Math.floor(1000 + Math.random() * 9000));
        const randNum = rawId.replace(/[^0-9]/g, '');
        const finalId = prefix + randNum;

        if (response.status === "duplicated") {
            const oldData = {
                name: response.oldName || valid.name,
                phone: response.oldPhone || valid.phone,
                date: response.oldDate || valid.date || todayISO()
            };
            const oldRawId = String(response.bookingId || finalId);
            const oldCleanId = oldRawId.replace(/[^0-9]/g, '');

            showDuplicated(oldData, prefix + oldCleanId, response.message || (currentLang === "ar" ? "يوجد حجز مسبق بهذا الرقم." : "There is already a booking for this number."), false, message);
            return;
        }
        
        showBirthSuccess(valid, finalId, message);
    } catch (e) {
        clearInterval(progressTimer);
        const prefix = getBookingIdPrefix("birth");
        const finalId = prefix + Math.floor(1000 + Math.random() * 9000);
        showBirthSuccess(valid, finalId, message);
    }
}

function showBirthSuccess(valid, finalId, message) {
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
            <div class="result-icon"><i class="fa-solid fa-baby"></i></div>
            <h2 style="color:var(--dark-pink);">${currentLang === "ar" ? "تم تسجيل طلب حجز الولادة" : "Delivery booking request registered"}</h2>
            ${detailsHtml(data)}
            <div class="notice-board">${currentLang === "ar" ? "برجاء التواصل مع العيادة لتحديد تفاصيل حجز الولادة وموعد الحضور المناسب." : "Please contact the clinic to arrange delivery booking details."}</div>
            <a href="${waUrl}" target="_blank" class="premium-wa-link"><i class="fa-brands fa-whatsapp"></i> ${currentLang === "ar" ? "إرسال البيانات للعيادة" : "Send details to clinic"}</a>
            <button class="inline-back-btn" onclick="renderBookingStart()">${currentLang === "ar" ? "رجوع للرئيسية" : "Back"}</button>
        </div>
    `;
    document.getElementById("bookingArea").scrollIntoView({ behavior: "smooth", block: "center" });
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
            <div class="detail-item"><span class="detail-label">${currentLang === "ar" ? "رقم الحجز" : "Booking ID"}</span><span class="detail-value highlight-value">${data.id}</span></div>
            <div class="detail-item"><span class="detail-label">${currentLang === "ar" ? "نوع الطلب" : "Type"}</span><span class="detail-value">${data.type}</span></div>
            <div class="detail-item"><span class="detail-label">${currentLang === "ar" ? "الاسم" : "Name"}</span><span class="detail-value">${data.name}</span></div>
            <div class="detail-item"><span class="detail-label">${currentLang === "ar" ? "الهاتف" : "Phone"}</span><span class="detail-value">${data.phone}</span></div>
            <div class="detail-item"><span class="detail-label">${currentLang === "ar" ? "تاريخ الحجز" : "Booking date"}</span><span class="detail-value highlight-value">${data.date}</span></div>
            <div class="detail-item"><span class="detail-label">${currentLang === "ar" ? "وقت التسجيل" : "Registration time"}</span><span class="detail-value">${data.regTime}</span></div>
            <div class="detail-item"><span class="detail-label">${currentLang === "ar" ? "المرفقات" : "Attachments"}</span><span class="detail-value">${data.hasAttachment ? (currentLang === "ar" ? "يوجد مرفقات" : "Attached") : (currentLang === "ar" ? "لا يوجد" : "None")}</span></div>
            ${data.message ? `<div class="detail-item"><span class="detail-label">${currentLang === "ar" ? "الرسالة" : "Message"}</span><span class="detail-value">${data.message}</span></div>` : ""}
        </div>
    `;
}

function showSuccess(valid, finalId, typeAr, message, hasAttachment) {
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

    document.getElementById("bookingArea").innerHTML = `
        <div class="result-card">
            <div class="result-icon"><i class="fa-solid fa-calendar-check"></i></div>
            <h2 style="color:var(--dark-pink);">${currentLang === "ar" ? "تم تسجيل البيانات بنجاح" : "Details registered successfully"}</h2>
            ${detailsHtml(data)}
            <div class="notice-board">${noticeBoardHtml}</div>
            ${(typeAr !== formText.ar.contacts && typeAr !== formText.en.contacts) ? `<a href="${waUrl}" target="_blank" class="premium-wa-link"><i class="fa-brands fa-whatsapp"></i> ${currentLang === "ar" ? "إرسال البيانات للعيادة" : "Send details to clinic"}</a>` : ""}
            <button class="inline-back-btn" onclick="renderBookingStart()">${currentLang === "ar" ? "رجوع للرئيسية" : "Back"}</button>
        </div>
    `;

    document.getElementById("bookingArea").scrollIntoView({ behavior: "smooth", block: "center" });
    handleVibrate();
}

function showDuplicated(oldData, finalId, msg, hasAttachment, message) {
    const waUrl = `https://wa.me/${CLINIC_WHATSAPP}`;

    document.getElementById("bookingArea").innerHTML = `
        <div class="result-card" style="border-color:var(--error-red);">
            <div class="result-icon" style="background:linear-gradient(135deg,#ef4444,#be123c);"><i class="fa-solid fa-circle-exclamation"></i></div>
            <h2 style="color:var(--error-red); margin-bottom: 5px;">${currentLang === "ar" ? "يوجد حجز مسبق بالفعل" : "Existing booking found"}</h2>
            <p style="font-weight:800;line-height:1.8; color:var(--text-main); margin-bottom: 20px;">${msg}</p>
            
            <div class="details-box">
                <div class="detail-item"><span class="detail-label">${currentLang === "ar" ? "رقم الكشف" : "Visit ID"}</span><span class="detail-value highlight-value">${finalId}</span></div>
                <div class="detail-item"><span class="detail-label">${currentLang === "ar" ? "تاريخ التسجيل المسبق" : "Previous Registration"}</span><span class="detail-value">${oldData.date}</span></div>
            </div>

            <div class="notice-board">
                ${currentLang === "ar"
                    ? "لإلغاء الحجز أو تعديل الموعد برجاء التواصل مع العيادة مباشرة عبر واتساب."
                    : "To cancel or modify the booking, please contact the clinic directly via WhatsApp."}
            </div>
            <a href="${waUrl}" target="_blank" class="premium-wa-link"><i class="fa-brands fa-whatsapp"></i> ${currentLang === "ar" ? "التواصل مع العيادة" : "Contact clinic"}</a>
            <button class="inline-back-btn" onclick="renderBookingStart()">${currentLang === "ar" ? "رجوع للرئيسية" : "Back"}</button>
        </div>
    `;
    document.getElementById("bookingArea").scrollIntoView({ behavior: "smooth", block: "center" });
}

function handleVibrate() {
    if ("vibrate" in navigator) navigator.vibrate(60);
}
