/*
 * ضع بيانات مشروع Supabase هنا بعد إنشائه. المفتاح publishable مسموح ظهوره في المتصفح
 * عند تطبيق سياسات RLS الموجودة في supabase/schema.sql.
 */
window.CLINIC_SUPABASE = {
    url: "https://ccuharkcusmsjdxfuamq.supabase.co",
    anonKey: "sb_publishable_YZj1fj5qxItnugNHxvSg6Q_0Mr0yxJ1"
};

// Separate Sheet-first Apps Script bridge (public booking endpoint).
// Never reuse the v2.7.0 booking endpoint for the commercial build.
window.CLINIC_BRIDGE = {
    url: "https://script.google.com/macros/s/AKfycbyrZHXlwUVU4LiEnayilP3IhWqXUXgFlOc95ed9DTnznY4_vdqqidJkjdSxWU3rZw3GVw/exec"
};
