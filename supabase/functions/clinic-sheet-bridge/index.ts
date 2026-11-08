import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const GAS_EXEC_URL = "https://script.google.com/macros/s/AKfycbyrZHXlwUVU4LiEnayilP3IhWqXUXgFlOc95ed9DTnznY4_vdqqidJkjdSxWU3rZw3GVw/exec";
const ALLOWED_ORIGINS = new Set([
  "https://dokyy2.github.io",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
]);
const ALLOWED_ACTIONS = new Set([
  "booking.create",
  "attachment.get",
  "admin.appointment.update",
  "admin.appointment.create",
  "admin.settings.update",
  "admin.patient-note.update",
  "admin.expense.create",
  "admin.alert.resolve",
  "admin.reconcile.preview",
  "admin.reconcile.link",
]);
const MAX_REQUEST_BYTES = 8_000_000;

function corsHeaders(origin: string | null): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "authorization, apikey, content-type, x-client-info";
    headers["Access-Control-Max-Age"] = "600";
  }
  return headers;
}

function json(data: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });
}

async function readBoundedBody(request: Request): Promise<string | null> {
  const declaredSize = Number(request.headers.get("content-length") || 0);
  if (declaredSize > MAX_REQUEST_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json({ status: "error", code: "origin_not_allowed", message: "مصدر الطلب غير مسموح." }, 403, null);
  }
  if (request.method === "OPTIONS") {
    if (origin && !ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== "POST") {
    return json({ status: "error", code: "method_not_allowed", message: "طريقة الطلب غير مدعومة." }, 405, origin);
  }

  const raw = await readBoundedBody(request);
  if (raw === null) {
    return json({ status: "error", code: "request_too_large", message: "حجم الطلب أكبر من الحد المسموح." }, 413, origin);
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return json({ status: "error", code: "invalid_request", message: "صيغة الطلب غير صحيحة." }, 400, origin);
  }
  if (!body || Array.isArray(body) || typeof body !== "object" || typeof body.action !== "string" || !ALLOWED_ACTIONS.has(body.action)) {
    return json({ status: "error", code: "unsupported_action", message: "العملية المطلوبة غير مدعومة." }, 400, origin);
  }

  const isPublicBooking = body.action === "booking.create";
  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!isPublicBooking && bearer.length < 40) {
    return json({ status: "error", code: "unauthorized", message: "انتهت الجلسة أو لا توجد صلاحية." }, 401, origin);
  }

  // Apps Script remains the authority for staff roles and the Sheet-first write.
  // Forward the user's session only in the request body; never log it.
  const forwarded = {
    action: body.action,
    payload: body.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? body.payload : {},
    ...(isPublicBooking ? {} : { accessToken: bearer }),
  };
  try {
    const upstream = await fetch(GAS_EXEC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(forwarded),
      redirect: "follow",
      signal: AbortSignal.timeout(120_000),
    });
    const text = await upstream.text();
    let result: unknown;
    try {
      result = JSON.parse(text);
    } catch {
      return json({ status: "error", code: "upstream_invalid_response", message: "تعذر قراءة استجابة بوابة العيادة." }, 502, origin);
    }
    return json(result, 200, origin);
  } catch {
    return json({ status: "error", code: "upstream_unavailable", message: "تعذر الاتصال ببوابة العيادة." }, 502, origin);
  }
});
