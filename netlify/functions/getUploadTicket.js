// netlify/functions/getUploadTicket.js
import { createClient } from "@supabase/supabase-js";

export const config = { path: "/.netlify/functions/getUploadTicket" };

/* =========================
   CORS موحّد
   ========================= */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, apikey",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
function withCors(res) {
  return { ...res, headers: { ...(res.headers || {}), ...CORS_HEADERS } };
}

/* =========================
   المتغيرات البيئية
   ========================= */
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE,
  SUPABASE_BUCKET,

  // أمان إضافي
  HCAPTCHA_SECRET,    // مفتاح hCaptcha السري (خادم)
  ORIGIN_WHITELIST,   // مثال: example.com,foo.netlify.app
} = process.env;

/* =========================
   قيود نوع/حجم الملف (سقف 10MB)
   ========================= */
const ALLOWED = new Map([
  ["application/pdf", "pdf"],
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
]);
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

/* =========================
   تبطيء (Rate Limit) لكل IP
   ========================= */
const RL_WINDOW_MS = 10 * 60 * 1000; // 10 دقائق
const RL_LIMIT = 30;                 // 30 تذكرة لكل 10 دقائق
const rlMap = new Map();             // ip -> [timestamps]
function rateHit(ip) {
  const now = Date.now();
  const arr = (rlMap.get(ip) || []).filter((t) => now - t < RL_WINDOW_MS);
  arr.push(now);
  rlMap.set(ip, arr);
  return arr.length;
}

/* =========================
   أدوات أمان
   ========================= */
function isOriginAllowed(headers) {
  if (!ORIGIN_WHITELIST) return true;
  const allow = ORIGIN_WHITELIST.split(",").map((s) => s.trim()).filter(Boolean);
  const origin = headers.origin || headers.Origin || "";
  if (!origin) return true;
  try {
    const u = new URL(origin);
    const host = u.host.toLowerCase();
    return allow.some((h) => host === h.toLowerCase());
  } catch {
    return false;
  }
}

async function verifyHCaptcha(token) {
  if (!HCAPTCHA_SECRET) return false;
  if (!token || typeof token !== "string" || token.length < 10) return false;
  const res = await fetch("https://hcaptcha.com/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      secret: HCAPTCHA_SECRET,
      response: token,
    }),
  });
  if (!res.ok) return false;
  const data = await res.json().catch(() => ({}));
  return !!data.success;
}

/* =========================
   مسار آمن داخل البكت (بدون اسم البكت)
   ========================= */
function safeObjectPath(ext) {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  // داخل مجلد incoming/سنة/شهر/يوم
  return `incoming/${yyyy}/${mm}/${dd}/${stamp}-${rand}.${ext}`;
}

export async function handler(event) {
  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return withCors({ statusCode: 200, body: "" });
  }
  if (event.httpMethod !== "POST") {
    return withCors({ statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) });
  }

  try {
    // تحقق بيئة
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !SUPABASE_BUCKET) {
      return withCors({
        statusCode: 500,
        body: JSON.stringify({ error: "Missing Supabase env vars" }),
      });
    }

    // تحقّق Origin
    if (!isOriginAllowed(event.headers || {})) {
      return withCors({
        statusCode: 403,
        body: JSON.stringify({ error: "Origin not allowed" }),
      });
    }

    // تبطيء حسب IP
    const ipHeader =
      event.headers["x-nf-client-connection-ip"] ||
      event.headers["client-ip"] ||
      (event.headers["x-forwarded-for"] || "").split(",")[0] ||
      "unknown";
    if (rateHit(ipHeader) > RL_LIMIT) {
      return withCors({
        statusCode: 429,
        body: JSON.stringify({ error: "طلبات كثيرة من نفس العنوان. حاول لاحقًا." }),
      });
    }

    // حمولة الواجهة: { mime, hcaptchaToken, contentLength? }
    const { mime = "application/pdf", hcaptchaToken, contentLength } = JSON.parse(event.body || "{}");

    // hCaptcha إلزامي
    const passed = await verifyHCaptcha(hcaptchaToken);
    if (!passed) {
      return withCors({
        statusCode: 400,
        body: JSON.stringify({ error: "فشل التحقق من hCaptcha" }),
      });
    }

    // قيود MIME
    if (!ALLOWED.has(mime)) {
      return withCors({
        statusCode: 415,
        body: JSON.stringify({ error: "نوع الملف غير مسموح. المسموح: PDF/PNG/JPG" }),
      });
    }
    const ext = ALLOWED.get(mime);

    // (اختياري) تحقّق حجم مُعلن من الواجهة إن وُجد
    if (contentLength != null) {
      const n = Number(contentLength);
      if (!Number.isFinite(n) || n <= 0) {
        return withCors({
          statusCode: 400,
          body: JSON.stringify({ error: "قيمة contentLength غير صالحة." }),
        });
      }
      if (n > MAX_BYTES) {
        return withCors({
          statusCode: 413,
          body: JSON.stringify({ error: "الحجم يتجاوز الحد الأقصى 10MB." }),
        });
      }
    }

    // إنشاء عميل Supabase باستخدام مفتاح الدور الخدمي
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    // تأكد أن البكت خاص (ليس عامًا)
    const { data: bucketInfo, error: bucketErr } = await supabase.storage.getBucket(SUPABASE_BUCKET);
    if (bucketErr) {
      return withCors({
        statusCode: 500,
        body: JSON.stringify({ error: "تعذّر التحقق من خصائص البكت" }),
      });
    }
    if (bucketInfo?.public === true) {
      // منع الإصدار إذا كان البكت عامًا
      return withCors({
        statusCode: 500,
        body: JSON.stringify({
          error: "Bucket must be Private. غيّر خصائص البكت إلى Private أولًا.",
        }),
      });
    }

    // مسار آمن داخل البكت (بدون اسم البكت)
    const objectPath = safeObjectPath(ext);

    // نحاول تذكرة رفع صالحة لـ 15 دقيقة
    const FIFTEEN_MIN = 60 * 15;
    const { data, error } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .createSignedUploadUrl(objectPath, FIFTEEN_MIN);

    if (error) {
      console.error("[SIGNED UPLOAD URL ERROR]", error);
      return withCors({
        statusCode: 500,
        body: JSON.stringify({ error: "تعذّر إنشاء تذكرة الرفع" }),
      });
    }

    // Endpoint الرفع المباشر (PUT) + التوكن
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/upload/sign/${objectPath}`;

    // معلومات تُعاد للواجهة
    const resp = {
      path: objectPath,            // خزّنه مع الشكوى (على الخادم فقط)
      token: data?.token,          // يوضع في Authorization عند الرفع
      uploadUrl,                   // Endpoint الرفع المباشر
      contentType: mime,           // استخدمه كـ Content-Type
      maxBytes: MAX_BYTES,         // تذكير للواجهة
      expiresAt: Date.now() + FIFTEEN_MIN * 1000,
    };

    return withCors({ statusCode: 200, body: JSON.stringify(resp) });
  } catch (err) {
    console.error("[getUploadTicket ERROR]", err);
    return withCors({
      statusCode: 500,
      body: JSON.stringify({ error: err.message || String(err) }),
    });
  }
}
