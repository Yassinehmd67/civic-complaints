// netlify/functions/getUploadTicket.js
import { createClient } from "@supabase/supabase-js";

export const config = { path: "/.netlify/functions/getUploadTicket" };

// أصل افتراضي؛ يمكنك ضبطه من المتغيرات أو إبقاءه *
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || "*";

function corsHeaders(origin) {
  // إن استخدمت نطاقًا محددًا، أعد نفس الأصل الوارد؛ وإلا استخدم *
  const allowOrigin = (ALLOWED_ORIGIN === "*") ? "*" : (origin || ALLOWED_ORIGIN);
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "content-type, authorization, x-client-info, apikey",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json",
  };
}

function cors(res, origin) {
  return { ...res, headers: { ...(res.headers||{}), ...corsHeaders(origin) } };
}

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE, SUPABASE_BUCKET } = process.env;

const ALLOWED = new Set(["application/pdf", "image/png", "image/jpeg"]);
const MAX_BYTES = 10 * 1024 * 1024;

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || "";
  // ✅ ردّ الـ preflight
  if (event.httpMethod === "OPTIONS") {
    return cors({ statusCode: 204, body: "" }, origin);
  }
  if (event.httpMethod !== "POST") {
    return cors({ statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) }, origin);
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !SUPABASE_BUCKET) {
      return cors({ statusCode: 500, body: JSON.stringify({ error: "Missing Supabase env vars" }) }, origin);
    }

    const { mime = "application/pdf" } = JSON.parse(event.body || "{}");
    if (!ALLOWED.has(mime)) {
      return cors({ statusCode: 415, body: JSON.stringify({ error: "نوع الملف غير مسموح. المسموح: PDF/PNG/JPG" }) }, origin);
    }

    const ext = mime === "application/pdf" ? "pdf" : (mime === "image/png" ? "png" : "jpg");

    // مسار داخل الـbucket فقط
    const OBJECT_PREFIX = "incoming/";
    const objectPath = `${OBJECT_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    const THIRTY_MINUTES = 60 * 30;
    const { data, error } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .createSignedUploadUrl(objectPath, THIRTY_MINUTES);

    if (error) {
      console.error("[SIGNED UPLOAD URL ERROR]", error);
      return cors({ statusCode: 500, body: JSON.stringify({ error: error.message }) }, origin);
    }

    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/upload/sign/${objectPath}`;
    const resp = {
      path: objectPath,
      token: data?.token,
      uploadUrl,
      contentType: mime,
      maxBytes: MAX_BYTES,
      expiresAt: Date.now() + THIRTY_MINUTES * 1000,
    };

    return cors({ statusCode: 200, body: JSON.stringify(resp) }, origin);
  } catch (err) {
    console.error("[getUploadTicket ERROR]", err);
    return cors({ statusCode: 500, body: JSON.stringify({ error: err.message || String(err) }) }, origin);
  }
}
