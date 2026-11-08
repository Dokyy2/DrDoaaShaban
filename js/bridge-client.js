(() => {
  const GOOGLE_SCRIPT_ORIGINS = new Set(['https://script.googleusercontent.com', 'https://script.google.com']);
  let frame;
  let frameOrigin = '';
  let readyPromise;
  const pending = new Map();

  function ensureFrame() {
    if (frame && frameOrigin) return Promise.resolve();
    if (readyPromise) return readyPromise;
    const bridgeUrl = String(window.CLINIC_BRIDGE?.url || '').trim();
    if (!bridgeUrl) return Promise.reject(new Error('خدمة الحجز الموحدة غير جاهزة بعد.'));
    readyPromise = new Promise((resolve, reject) => {
      const receive = event => {
        if (!frame || event.source !== frame.contentWindow || !GOOGLE_SCRIPT_ORIGINS.has(event.origin)) return;
        if (event.data?.type === 'clinic-bridge-ready') {
          frameOrigin = event.origin;
          clearTimeout(timeout);
          resolve();
          return;
        }
        if (event.data?.type !== 'clinic-bridge-response' || typeof event.data.id !== 'string') return;
        const entry = pending.get(event.data.id);
        if (!entry) return;
        clearTimeout(entry.timeout);
        pending.delete(event.data.id);
        entry.resolve(event.data.result);
      };
      const timeout = window.setTimeout(() => {
        window.removeEventListener('message', receive);
        frame?.remove();
        frame = null;
        readyPromise = null;
        reject(new Error('تعذر فتح قناة الاتصال الآمنة مع بوابة العيادة.'));
      }, 20000);
      window.addEventListener('message', receive);
      frame = document.createElement('iframe');
      frame.title = 'Clinic secure bridge';
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10000px;top:-10000px;border:0;';
      frame.src = bridgeUrl + (bridgeUrl.includes('?') ? '&' : '?') + 'mode=rpc&v=1';
      document.body.appendChild(frame);
    });
    return readyPromise;
  }

  async function call(action, payload = {}, accessToken = '') {
    await ensureFrame();
    const id = (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const request = { action, payload, ...(accessToken ? { accessToken } : {}) };
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        pending.delete(id);
        reject(new Error('انتهت مهلة استجابة بوابة العيادة.'));
      }, 45000);
      pending.set(id, { resolve, reject, timeout });
      frame.contentWindow.postMessage({ type: 'clinic-bridge-request', id, request }, frameOrigin);
    });
  }

  window.ClinicBridge = Object.freeze({ call });
})();
