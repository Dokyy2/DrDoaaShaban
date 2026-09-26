# Dr Doaa Shaban

موقع عيادة د. دعاء شعبان ونظام الحجز الإلكتروني.

## تشغيل المشروع

افتح `index.html` مباشرة، أو شغّله من خلال Live Server.

## تقسيم الملفات

- `index.html`: هيكل الصفحة.
- `css/main.css`: التصميم الأصلي ونظام الحجز.
- `css/gallery.css`: تصميم ألبوم الذكريات والأنيميشن الجديد.
- `js/main.js`: منطق الموقع والحجز والربط الحالي مع Google Apps Script.
- `js/gallery.js`: فتح الألبوم وتقليب الصفحات فقط.
- `assets/images`: صور الاسبلاش والبانر والدكتورة.
- `assets/images/gallery`: غلاف الألبوم وصور صفحاته.
- `google-apps-script/Code.gs`: نسخة مرجعية مطابقة لكود Google Apps Script المرسل، بلا تعديلات.

## استبدال الصور

استبدل الصور مع الاحتفاظ بنفس الأسماء:

- `splash.png`
- `banner.png`
- `doctor.png`
- `gallery/album-cover.svg`
- `gallery/memory-01.svg` إلى `gallery/memory-05.svg`

يمكن استخدام صور JPG أو PNG بدل SVG، لكن عندها يجب تعديل الامتداد في `index.html`.
