import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_ORIGINS = new Set([
  "https://dokyy2.github.io",
  "http://127.0.0.1:5501",
  "http://localhost:5501",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
]);
const MAX_REQUEST_BYTES = 8_000_000;

function headers(origin: string | null): HeadersInit {
  const result: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    result["Access-Control-Allow-Origin"] = origin;
    result["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    result["Access-Control-Allow-Headers"] = "authorization, apikey, content-type, x-client-info";
    result["Access-Control-Max-Age"] = "600";
  }
  return result;
}

function json(data: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(data), { status, headers: headers(origin) });
}

async function readBoundedBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_REQUEST_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_REQUEST_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json({ status: "error", message: "مصدر الطلب غير مسموح." }, 403, null);
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(origin) });
  if (request.method !== "POST") return json({ status: "error", message: "طريقة الطلب غير مدعومة." }, 405, origin);

  const raw = await readBoundedBody(request);
  if (raw === null) return json({ status: "error", message: "حجم الطلب أكبر من الحد المسموح." }, 413, origin);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return json({ status: "error", message: "صيغة الطلب غير صحيحة." }, 400, origin);
  }
  if (!body || Array.isArray(body) || body.action !== "booking.create" ||
      !body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) {
    return json({ status: "error", message: "عملية الحجز غير مكتملة." }, 400, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ status: "error", message: "إعدادات خدمة الحجز غير مكتملة." }, 503, origin);
  }

  try {
    const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/rpc/create_booking`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        "Accept-Profile": "public",
        "Content-Profile": "public",
      },
      body: JSON.stringify({ payload: body.payload }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    let result: unknown;
    try {
      result = JSON.parse(text);
    } catch {
      return json({ status: "error", message: "وصل رد غير مفهوم من قاعدة الحجوزات." }, 502, origin);
    }
    if (!response.ok) return json({ status: "error", message: "تعذر تسجيل الحجز في قاعدة البيانات." }, 502, origin);
    return json(result, 200, origin);
  } catch {
    return json({ status: "error", message: "انقطع الاتصال بقاعدة الحجوزات قبل وصول التأكيد. قد يكون الطلب اتسجل؛ لا تعيدي إرساله قبل مراجعة لوحة الإدارة." }, 502, origin);
  }
});
