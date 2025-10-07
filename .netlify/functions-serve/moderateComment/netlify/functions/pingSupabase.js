// netlify/functions/pingSupabase.js
import { createClient } from "@supabase/supabase-js";

export const config = { path: "/.netlify/functions/pingSupabase" };

function cors(res) {
  return {
    ...res,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Content-Type": "application/json",
    },
  };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return cors({ statusCode: 200, body: "" });
  }
  if (event.httpMethod !== "GET") {
    return cors({ statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) });
  }

  try {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE, SUPABASE_BUCKET } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !SUPABASE_BUCKET) {
      return cors({
        statusCode: 500,
        body: JSON.stringify({ ok: false, where: "env", error: "Missing Supabase env vars" }),
      });
    }

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
      body: JSON.stringify({ ok: false, where: "catch", error: e.message || String(e) }),
    });
  }
}
