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
      response = await fetch(`${baseUrl}/functions/v1/clinic-sheet-bridge`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action, payload }),
        cache: 'no-store',
        credentials: 'omit',
      });
    } catch {
      throw new Error('تعذر الاتصال ببوابة العيادة. راجعي الاتصال ثم حاولي مرة أخرى.');
    }

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error('وصل رد غير مفهوم من بوابة العيادة.');
    }
    if (!response.ok && result?.status !== 'error') {
      throw new Error('تعذر تنفيذ الطلب عبر بوابة العيادة.');
    }
    return result;
  }

  window.ClinicBridge = Object.freeze({ call });
})();
