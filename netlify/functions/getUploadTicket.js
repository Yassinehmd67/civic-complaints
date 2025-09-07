// netlify/functions/getUploadTicket.js
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

export async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") return cors({ statusCode: 200, body: "" });
    if (event.httpMethod !== "POST")
      return cors({ statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) });

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !SUPABASE_BUCKET) {
      return cors({ statusCode: 500, body: JSON.stringify({ error: "Missing Supabase env vars" }) });
    }

    // اختياريًا: اسم الملف والـ mime يأتون من الواجهة لنبني المسار
    const { mime = "application/pdf" } = JSON.parse(event.body || "{}");
    const ext = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "bin";

    const objectPath = `proofs/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    // نصدر رابط/توكن رفع موقّع صالح لفترة قصيرة (مثلاً 10 دقائق)
    const { data, error } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .createSignedUploadUrl(objectPath, 60 * 10);

    if (error) {
      console.error("[SIGNED UPLOAD URL ERROR]", error);
      return cors({ statusCode: 500, body: JSON.stringify({ error: error.message }) });
    }

    return cors({
      statusCode: 200,
      body: JSON.stringify({
        path: objectPath,
        token: data?.token,     // نستخدمه في المتصفح للرفع المباشر
      }),
    });
  } catch (err) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: err.message || String(err) }) });
  }
}
