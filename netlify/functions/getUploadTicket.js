import { createClient } from "@supabase/supabase-js";

export const config = { path: "/.netlify/functions/getUploadTicket" };

function cors(res) {
  return {
    ...res,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json",
    },
  };
}

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE, SUPABASE_BUCKET } = process.env;

// الأنواع المسموح بها وحجم 10MB
const ALLOWED = new Set(["application/pdf", "image/png", "image/jpeg"]);
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

export async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") {
      return cors({ statusCode: 200, body: "" });
    }
    if (event.httpMethod !== "POST") {
      return cors({
        statusCode: 405,
        body: JSON.stringify({ error: "Method Not Allowed" }),
      });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !SUPABASE_BUCKET) {
      return cors({
        statusCode: 500,
        body: JSON.stringify({ error: "Missing Supabase env vars" }),
      });
    }

    const { mime = "application/pdf" } = JSON.parse(event.body || "{}");

    // تحقّق النوع
    if (!ALLOWED.has(mime)) {
      return cors({
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

    // ✅ مسار داخل الـbucket فقط (بدون اسم الـbucket)
    const OBJECT_PREFIX = "incoming/"; // يمكن تغييره لمجلد آخر
    const objectPath = `${OBJECT_PREFIX}${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.${ext}`;

    // إنشاء عميل Supabase باستخدام مفتاح الدور الخدمي
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    const THIRTY_MINUTES = 60 * 30;
    const { data, error } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .createSignedUploadUrl(objectPath, THIRTY_MINUTES);

    if (error) {
      console.error("[SIGNED UPLOAD URL ERROR]", error);
      return cors({
        statusCode: 500,
        body: JSON.stringify({ error: error.message }),
      });
    }

    // رابط PUT + التوكن
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/upload/sign/${objectPath}`;

    const resp = {
      path: objectPath,
      token: data?.token,
      uploadUrl,
      contentType: mime,
      maxBytes: MAX_BYTES,
      expiresAt: Date.now() + THIRTY_MINUTES * 1000,
    };

    return cors({ statusCode: 200, body: JSON.stringify(resp) });
  } catch (err) {
    console.error("[getUploadTicket ERROR]", err);
    return cors({
      statusCode: 500,
      body: JSON.stringify({ error: err.message || String(err) }),
    });
  }
}
