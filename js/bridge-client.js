(() => {
  async function call(action, payload = {}, accessToken = '') {
    const config = window.CLINIC_SUPABASE || {};
    const baseUrl = String(config.url || '').replace(/\/+$/, '');
    const apiKey = String(config.anonKey || '');
    if (!baseUrl || !apiKey) throw new Error('إعدادات الاتصال بخدمة الحجز غير مكتملة.');

    const headers = {
      apikey: apiKey,
      'Content-Type': 'application/json',
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    let response;
    try {
      const functionName = String(window.CLINIC_BOOKING_FUNCTION || 'clinic-db-booking');
      response = await fetch(`${baseUrl}/functions/v1/${functionName}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action, payload }),
        cache: 'no-store',
        credentials: 'omit',
        signal: AbortSignal.timeout(35_000),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new Error('تأخر رد قاعدة الحجوزات. قد يكون الطلب اتسجل بالفعل؛ لا تعيدي الإرسال قبل مراجعة لوحة الإدارة.');
      }
      throw new Error('تعذر الاتصال بقاعدة الحجوزات. راجعي الاتصال ثم حاولي مرة أخرى.');
    }

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error('وصل رد غير مفهوم من بوابة العيادة.');
    }
    if (!response.ok && result?.status !== 'error') {
      throw new Error('تعذر تنفيذ الطلب عبر قاعدة الحجوزات.');
    }
    return result;
  }

  window.ClinicBridge = Object.freeze({ call });
})();
