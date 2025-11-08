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
      "Cache-Control": "public, max-age=30",
    },
  };
}

/* ========= تبطيء بسيط لكل IP ========= */
const RL_WINDOW_MS = 5 * 60 * 1000; // 5 دقائق
const RL_LIMIT = 50;                // أقصى 50 طلب لكل 5 دقائق
const rlMap = new Map();            // ip -> [timestamps]
function rateHit(ip) {
  const now = Date.now();
  const arr = (rlMap.get(ip) || []).filter((t) => now - t < RL_WINDOW_MS);
  arr.push(now);
  rlMap.set(ip, arr);
  return arr.length;
}

/* ========= تحقّق Origin (اختياري) ========= */
const { ORIGIN_WHITELIST } = process.env;
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

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return cors({ statusCode: 200, body: "" });
  if (event.httpMethod !== "GET")
    return cors({ statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) });

  // التحقق من Origin
  if (!isOriginAllowed(event.headers || {})) {
    return cors({ statusCode: 403, body: JSON.stringify({ ok: false, error: "Origin not allowed" }) });
  }

  // تبطيء حسب IP
  const ipHeader =
    event.headers["x-nf-client-connection-ip"] ||
    event.headers["client-ip"] ||
    (event.headers["x-forwarded-for"] || "").split(",")[0] ||
    "unknown";
  if (rateHit(ipHeader) > RL_LIMIT) {
    return cors({
      statusCode: 429,
      body: JSON.stringify({ ok: false, error: "طلبات كثيرة من نفس العنوان. حاول لاحقًا." }),
    });
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
      console.error("[pingSupabase] storage error:", error);
      return cors({
        statusCode: 500,
        body: JSON.stringify({ ok: false, where: "storage", error: "Storage access failed" }),
      });
    }

    return cors({
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        bucket: data?.name || SUPABASE_BUCKET,
        ts: Date.now(),
      }),
    });
  } catch (e) {
    console.error("[pingSupabase] catch:", e);
    return cors({
      statusCode: 500,
      body: JSON.stringify({ ok: false, where: "catch", error: "Unexpected server error" }),
    });
  }
}
