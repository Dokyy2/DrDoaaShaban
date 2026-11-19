import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const INVITE_REDIRECTS = new Map([
  ["http://127.0.0.1:5500", "http://127.0.0.1:5500/dashboard/"],
  ["http://localhost:5500", "http://localhost:5500/dashboard/"],
  ["http://127.0.0.1:5501", "http://127.0.0.1:5501/dashboard/"],
  ["http://localhost:5501", "http://localhost:5501/dashboard/"],
]);
// Keep local CORS origins and invite redirects in sync so an accepted local
// origin never reaches the invitation flow without a safe return destination.
const ALLOWED_ORIGINS = new Set([
  "https://dokyy2.github.io",
  ...INVITE_REDIRECTS.keys(),
]);
const TEAM_ROLES = new Set(["doctor", "secretary"]);
const ACTIVE_TEAM_ROLES = new Set(["owner", "doctor", "secretary"]);

function responseHeaders(origin: string | null): HeadersInit {
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
  return new Response(JSON.stringify(data), { status, headers: responseHeaders(origin) });
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > 16_384) return null;
  const raw = await request.text();
  if (raw.length > 16_384) return null;
  try {
    const value: unknown = JSON.parse(raw || "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown> : null;
  } catch { return null; }
}

async function api(path: string, method: string, key: string, token: string, body?: unknown) {
  const url = `${Deno.env.get("SUPABASE_URL")!.replace(/\/+$/, "")}${path}`;
  const result = await fetch(url, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(method === "GET" ? { Accept: "application/json" } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await result.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { ok: result.ok, status: result.status, data };
}

function safeError(data: any): string {
  const code = String(data?.code || data?.error_code || "");
  if (code === "clinic team limit reached") return "وصل عدد حسابات الفريق النشطة إلى الحد الأقصى (5).";
  const message = String(data?.message || data?.msg || "");
  if (/duplicate|already registered|already been registered/i.test(message)) return "يوجد حساب بهذا البريد الإلكتروني بالفعل.";
  if (/last doctor/i.test(message)) return "لا يمكن تعطيل آخر حساب للطبيبة.";
  if (/owner access/i.test(message)) return "تغيير الصلاحيات متاح لمالك النظام فقط.";
  if (/doctor access|required|42501/i.test(message)) return "هذه العملية متاحة للطبيبة فقط.";
  if (/team limit reached|54000/i.test(message)) return "وصل عدد حسابات الفريق النشطة إلى الحد الأقصى (5).";
  if (/invalid team|invalid.*invitation|22023/i.test(message)) return "راجعي البريد الإلكتروني والبيانات المدخلة.";
  if (/not found/i.test(message)) return "الحساب المطلوب غير موجود.";
  return "تعذر إتمام العملية. راجعي الاتصال ثم حاولي مرة أخرى.";
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "مصدر الطلب غير مسموح." }, 403, null);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders(origin) });
  if (request.method !== "POST") return json({ error: "طريقة الطلب غير مدعومة." }, 405, origin);

  const bearer = request.headers.get("authorization") || "";
  const token = bearer.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!token || !anonKey || !serviceKey || !supabaseUrl) {
    return json({ error: "إعدادات الخدمة أو جلسة الدخول غير مكتملة." }, 401, origin);
  }

  const input = await readJson(request);
  if (!input || typeof input.action !== "string") return json({ error: "بيانات الطلب غير صحيحة." }, 400, origin);

  try {
    const caller = await api("/auth/v1/user", "GET", anonKey, token);
    if (!caller.ok || !caller.data?.id) return json({ error: "انتهت جلسة الدخول. سجّلي الدخول مرة أخرى." }, 401, origin);
    const profileResult = await api(`/rest/v1/profiles?id=eq.${encodeURIComponent(caller.data.id)}&select=id,role,full_name`, "GET", serviceKey, serviceKey);
    const actor = Array.isArray(profileResult.data) ? profileResult.data[0] : null;
    if (!ACTIVE_TEAM_ROLES.has(String(actor?.role || ""))) return json({ error: "هذا الحساب غير مخوّل لإدارة فريق العيادة." }, 403, origin);

    const rpc = (name: string, args: Record<string, unknown>) =>
      api(`/rest/v1/rpc/${name}`, "POST", anonKey, token, args);
    const admin = (path: string, method: string, body?: unknown) =>
      api(path, method, serviceKey, serviceKey, body);
    const permissionResult = await rpc("my_clinic_permissions", {});
    if (!permissionResult.ok || !Array.isArray(permissionResult.data?.permissions)) {
      return json({ error: "تعذر التحقق من صلاحيات الحساب. حدّثي الصفحة وحاولي مرة أخرى." }, 403, origin);
    }
    const permissions = new Set(permissionResult.data.permissions.map((value: unknown) => String(value)));

    if (input.action === "team.list") {
      if (actor.role !== "owner" && !permissions.has("team.view")) return json({ error: "عرض حسابات الفريق غير متاح لهذا الحساب." }, 403, origin);
      const [usersResult, profilesResult, auditResult] = await Promise.all([
        admin("/auth/v1/admin/users?page=1&per_page=1000", "GET"),
        admin("/rest/v1/profiles?select=id,full_name,role,created_at&order=created_at.asc", "GET"),
        admin("/rest/v1/clinic_team_events?select=id,actor_id,target_email,action,old_role,new_role,created_at&order=created_at.desc&limit=200", "GET"),
      ]);
      if (!usersResult.ok || !profilesResult.ok || !auditResult.ok) throw new Error("team listing failed");
      const users = Array.isArray(usersResult.data?.users) ? usersResult.data.users : [];
      const profiles = Array.isArray(profilesResult.data) ? profilesResult.data : [];
      const byId = new Map(profiles.map((profile: any) => [profile.id, profile]));
      const members = users.flatMap((user: any) => {
        const profile: any = byId.get(user.id);
        if (!profile) return [];
        return [{
          id: user.id,
          email: String(user.email || ""),
          full_name: String(profile.full_name || user.user_metadata?.full_name || ""),
          role: profile.role,
          created_at: profile.created_at,
          last_sign_in_at: user.last_sign_in_at || null,
          invited_at: user.invited_at || null,
          disabled: Boolean(user.banned_until && new Date(user.banned_until).getTime() > Date.now()),
          is_self: user.id === caller.data.id,
        }];
      });
      const audit = Array.isArray(auditResult.data) ? auditResult.data.map((event: any) => ({
        id:event.id, actor_name:String(byId.get(event.actor_id)?.full_name || "طبيبة"), target_email:String(event.target_email || ""),
        action:event.action, old_role:event.old_role, new_role:event.new_role, created_at:event.created_at,
      })) : [];
      return json({ members, audit, active_limit: 5, active_count: members.filter((m: any) => ACTIVE_TEAM_ROLES.has(m.role) && !m.disabled).length }, 200, origin);
    }

    if (input.action === "team.invite") {
      if (actor.role !== "owner" && !permissions.has("team.invite")) return json({ error: "دعوة أعضاء الفريق غير متاحة لهذا الحساب." }, 403, origin);
      const email = String(input.email || "").trim().toLowerCase();
      const fullName = String(input.full_name || "").trim();
      const role = String(input.role || "secretary");
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || fullName.length < 2 || fullName.length > 100 || !TEAM_ROLES.has(role)) {
        return json({ error: "أدخلي اسمًا وبريدًا إلكترونيًا صحيحين واختاري الصلاحية." }, 400, origin);
      }
      const redirectTo = origin ? INVITE_REDIRECTS.get(origin) : null;
      if (!redirectTo) return json({ error: "تعذر تحديد عنوان آمن لإكمال الدعوة. افتحي لوحة الإدارة من الرابط المحلي المعتمد." }, 400, origin);

      // Never run Auth Admin invite against an existing account. In particular,
      // do not risk changing or suspending an account if profile activation fails.
      let page = 1;
      while (page <= 100) {
        const existingPage = await admin(`/auth/v1/admin/users?page=${page}&per_page=1000`, "GET");
        if (!existingPage.ok) throw new Error("could not verify invitation email");
        const existingUsers = Array.isArray(existingPage.data?.users) ? existingPage.data.users : [];
        if (existingUsers.some((user: any) => String(user.email || "").trim().toLowerCase() === email)) {
          return json({ error: "هذا البريد مسجل مسبقًا. استخدمي بريدًا غير مرتبط بحساب في النظام." }, 409, origin);
        }
        if (existingUsers.length < 1000) break;
        page += 1;
      }
      if (page > 100) throw new Error("could not finish invitation email lookup");

      const reserved = await rpc("reserve_clinic_team_invite", { p_email: email, p_role: role });
      if (!reserved.ok || !reserved.data) return json({ error: safeError(reserved.data) }, reserved.status >= 400 ? 409 : 500, origin);
      const reservationId = reserved.data;
      const invited = await admin(`/auth/v1/invite?redirect_to=${encodeURIComponent(redirectTo)}`, "POST", { email, data: { full_name: fullName } });
      if (!invited.ok || !invited.data?.id) {
        await rpc("release_clinic_team_invite", { p_reservation_id: reservationId });
        return json({ error: safeError(invited.data) }, invited.status >= 400 ? invited.status : 502, origin);
      }
      const profileActivated = await rpc("complete_clinic_team_invite", { p_reservation_id: reservationId, p_user_id: invited.data.id, p_full_name: fullName });
      if (!profileActivated.ok) {
        await rpc("release_clinic_team_invite", { p_reservation_id: reservationId });
        return json({ error: "وصلت الدعوة، لكن تعذر تفعيل صلاحية الحساب. سيظل الحساب بلا وصول للوحة حتى تراجع الطبيبة الإعدادات؛ لا تعيدي إرسال الدعوة لنفس البريد الآن." }, 502, origin);
      }
      return json({ ok: true, message: "تم إرسال دعوة الدخول وتحديد الصلاحية." }, 200, origin);
    }

    if (input.action === "team.role" || input.action === "team.disable") {
      if (actor?.role !== "owner") return json({ error: "تغيير الصلاحيات وإيقاف الحسابات متاح لمالك النظام فقط." }, 403, origin);
      const userId = String(input.user_id || "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId) || userId === caller.data.id) {
        return json({ error: "لا يمكن تعديل الحساب الحالي من هنا." }, 400, origin);
      }
      const role = input.action === "team.disable" ? "pending" : String(input.role || "");
      if (!new Set(["doctor", "secretary", "pending"]).has(role)) return json({ error: "الصلاحية المختارة غير مدعومة." }, 400, origin);
      const changed = await rpc("change_clinic_team_role", { p_user_id: userId, p_role: role });
      if (!changed.ok) return json({ error: safeError(changed.data) }, changed.status >= 400 ? 409 : 500, origin);
      const authChanged = role === "pending"
        ? await admin(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, "PUT", { ban_duration: "876000h" })
        : await admin(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, "PUT", { ban_duration: "none" });
      if (!authChanged.ok) return json({ error: "تم تحديث دور الحساب، لكن تعذر تحديث حالة تسجيل الدخول. أعيدي تحميل الفريق قبل أي تعديل آخر." }, 502, origin);
      return json({ ok: true, message: role === "pending" ? "تم إيقاف وصول الحساب." : "تم تحديث صلاحية الحساب." }, 200, origin);
    }

    return json({ error: "العملية المطلوبة غير مدعومة." }, 400, origin);
  } catch {
    return json({ error: "تعذر الاتصال بخدمة إدارة الفريق. لم يتم تأكيد اكتمال العملية." }, 502, origin);
  }
});
