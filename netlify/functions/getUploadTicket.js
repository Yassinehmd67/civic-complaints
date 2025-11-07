// netlify/functions/getUploadTicket.js
import { createClient } from "@supabase/supabase-js";

export const config = { path: "/.netlify/functions/getUploadTicket" };

/* =========================
   CORS مبسّط وموحّد لكل الردود
   ========================= */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*", // لا نستخدم كوكيز، لذا * آمنة هنا
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, apikey",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
  "Content-Type": "application/json",
};

function withCors(res) {
  return { ...res, headers: { ...(res.headers || {}), ...CORS_HEADERS } };
}

/* =========================
   المتغيرات البيئية
   ========================= */
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE, SUPABASE_BUCKET } = process.env;

// الأنواع المسموح بها وحجم 10MB
const ALLOWED = new Set(["application/pdf", "image/png", "image/jpeg"]);
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

export async function handler(event) {
  /* ردّ الـ preflight دائمًا مع رؤوس CORS */
  if (event.httpMethod === "OPTIONS") {
    return withCors({ statusCode: 200, body: "" });
  }

  if (event.httpMethod !== "POST") {
    return withCors({
      statusCode: 405,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    });
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !SUPABASE_BUCKET) {
      return withCors({
        statusCode: 500,
        body: JSON.stringify({ error: "Missing Supabase env vars" }),
      });
    }

    // مدخلات اختيارية من الواجهة: نوع الملف
    const { mime = "application/pdf" } = JSON.parse(event.body || "{}");

    // تحقّق النوع
    if (!ALLOWED.has(mime)) {
      return withCors({
        statusCode: 415,
        body: JSON.stringify({
          error: "نوع الملف غير مسموح. المسموح: PDF/PNG/JPG",
        }),
      });
    }

    const ext =
      mime === "application/pdf"
        ? "pdf"
        : mime === "image/png"
        ? "png"
        : "jpg";

    /* =========================
       ✅ مسار داخل الـbucket فقط (بدون اسم الـbucket)
       لمنع تكرار proofs/proofs في العنوان
       ========================= */
    const OBJECT_PREFIX = "incoming/"; // يمكن تغييره
    const objectPath = `${OBJECT_PREFIX}${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.${ext}`;

    // إنشاء عميل Supabase باستخدام مفتاح الدور الخدمي
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    // نحاول تذكرة رفع صالحة لـ 30 دقيقة
    const THIRTY_MINUTES = 60 * 30;
    const { data, error } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .createSignedUploadUrl(objectPath, THIRTY_MINUTES);

    if (error) {
      console.error("[SIGNED UPLOAD URL ERROR]", error);
      return withCors({
        statusCode: 500,
        body: JSON.stringify({ error: error.message }),
      });
    }

    // Endpoint الرفع المباشر (PUT) + التوكن
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/upload/sign/${objectPath}`;

    // معلومات تُعاد للواجهة
    const resp = {
      path: objectPath,       // خزّنه مع الشكوى (على الخادم فقط)
      token: data?.token,     // يوضع في Authorization عند الرفع
      uploadUrl,              // Endpoint الرفع المباشر
      contentType: mime,      // استخدمه كـ Content-Type
      maxBytes: MAX_BYTES,    // تذكير للواجهة
      expiresAt: Date.now() + THIRTY_MINUTES * 1000,
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
