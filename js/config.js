/*
 * ضع بيانات مشروع Supabase هنا بعد إنشائه. المفتاح publishable مسموح ظهوره في المتصفح
 * عند تطبيق سياسات RLS الموجودة في supabase/schema.sql.
 */
window.CLINIC_SUPABASE = {
    url: "https://gtpmzbjakfvjpvpliwnj.supabase.co",
    anonKey: "sb_publishable_1A87lubP-CsDOCC_RSVRfw_FkrYWnS6"
};

// Local-admin booking uses a Supabase Edge Function; the original Sheet is not used here.
window.CLINIC_BOOKING_FUNCTION = "clinic-db-booking";
