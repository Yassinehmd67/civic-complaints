// netlify/functions/pingSupabase.js
import { createClient } from "@supabase/supabase-js";

export const config = { path: "/.netlify/functions/pingSupabase" };

function cors(res) {
  return {
    ...res,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json",
    },
  };
}

export async function handler() {
  try {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE, SUPABASE_BUCKET } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !SUPABASE_BUCKET) {
      return cors({
        statusCode: 500,
        body: JSON.stringify({ ok: false, where: "env", error: "Missing Supabase env vars" }),
      });
    }

    // مجرّد محاولة ناعمة للاتصال (بدون تسريب بيانات)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
    const { data, error } = await supabase.storage.getBucket(SUPABASE_BUCKET);

    if (error) {
      return cors({
        statusCode: 500,
        body: JSON.stringify({ ok: false, where: "storage", error: error.message }),
      });
    }

    return cors({
      statusCode: 200,
      body: JSON.stringify({ ok: true, bucket: data?.name || SUPABASE_BUCKET }),
    });
  } catch (e) {
    return cors({
      statusCode: 500,
      body: JSON.stringify({ ok: false, where: "catch", error: String(e?.message || e) }),
    });
  }
}
