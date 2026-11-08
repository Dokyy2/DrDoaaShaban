/*
 * ضع بيانات مشروع Supabase هنا بعد إنشائه. المفتاح publishable مسموح ظهوره في المتصفح
 * عند تطبيق سياسات RLS الموجودة في supabase/schema.sql.
 */
window.CLINIC_SUPABASE = {
    url: "https://ccuharkcusmsjdxfuamq.supabase.co",
    anonKey: "sb_publishable_YZj1fj5qxItnugNHxvSg6Q_0Mr0yxJ1"
};

// Local-admin booking uses a Supabase Edge Function; the original Sheet is not used here.
window.CLINIC_BOOKING_FUNCTION = "clinic-db-booking";
