// netlify/functions/getUploadTicket.js
import { createClient } from "@supabase/supabase-js";

export const config = { path: "/.netlify/functions/getUploadTicket" };

/* ---------- CORS ---------- */
function cors(res) {
  return {
    ...res,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Content-Type": "application/json",
      ...(res.headers || {}),
    },
  };
}

/* ---------- Utils ---------- */
function ipFromHeaders(h = {}) {
  const raw =
    h["x-forwarded-for"] ||
    h["X-Forwarded-For"] ||
    h["x-nf-client-connection-ip"] ||
    h["client-ip"] ||
    h["Client-IP"] ||
    "";
  return String(raw).split(",")[0].trim() || undefined;
}

function extFromMime(m) {
  if (m === "application/pdf") return "pdf";
  if (m === "image/png") return "png";
  if (m === "image/jpeg") return "jpg";
  if (m === "image/webp") return "webp";
  if (m === "image/heic") return "heic";
  if (m === "image/heif") return "heif";
  return null;
}

function extFromFilename(name = "") {
  const m = String(name).toLowerCase().match(/\.(pdf|png|jpe?g|webp|heic|heif)$/i);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  return ext === "jpeg" ? "jpg" : ext;
}

function todayParts(tz = "Africa/Casablanca") {
  const d = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const da = parts.find((p) => p.type === "day")?.value;
  return { y, m, da };
}

/* ---------- Handler ---------- */
export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return cors({ statusCode: 200, body: "" });
  if (event.httpMethod !== "POST") {
    return cors({
      statusCode: 405,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    });
  }

  const {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE,
    SUPABASE_BUCKET,
    HCAPTCHA_SECRET, // ✅ سر hCaptcha
  } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !SUPABASE_BUCKET) {
    return cors({
      statusCode: 500,
      body: JSON.stringify({
        error: "Missing Supabase env vars",
        missing: {
          SUPABASE_URL: !!SUPABASE_URL,
          SUPABASE_SERVICE_ROLE: !!SUPABASE_SERVICE_ROLE,
          SUPABASE_BUCKET: !!SUPABASE_BUCKET,
        },
      }),
    });
  }
  if (!HCAPTCHA_SECRET) {
    return cors({
      statusCode: 500,
      body: JSON.stringify({ error: "Missing hCaptcha secret (HCAPTCHA_SECRET)" }),
    });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return cors({ statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) });
  }

  const mime = String(body.mime || "").trim();
  const filename = String(body.filename || "").trim();
  const captchaToken = String(body.captchaToken || "").trim();
  const remoteIp = ipFromHeaders(event.headers || {});

  // السماح بأنواع شائعة على الهاتف
  const allowed = [
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/heic",
    "image/heif",
    "application/octet-stream",
  ];
  if (!mime || !allowed.includes(mime)) {
    return cors({
      statusCode: 415,
      body: JSON.stringify({ error: "Unsupported or missing mime", allowed, got: mime || null }),
    });
  }

  if (!captchaToken) {
    return cors({ statusCode: 400, body: JSON.stringify({ error: "captchaToken is required" }) });
  }

  // تحقق hCaptcha
  try {
    const verifyRes = await fetch("https://hcaptcha.com/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: HCAPTCHA_SECRET,
        response: captchaToken,
        ...(remoteIp ? { remoteip: remoteIp } : {}),
      }),
    });
    const verifyJson = await verifyRes.json().catch(() => ({}));
    if (!verifyJson.success) {
      return cors({
        statusCode: 400,
        body: JSON.stringify({
          error: "فشل التحقق من hCaptcha",
          diagnostics: {
            "error-codes": verifyJson["error-codes"] || null,
            hostname: verifyJson.hostname || null,
            challenge_ts: verifyJson.challenge_ts || null,
            credit: verifyJson.credit || null,
          },
        }),
      });
    }
  } catch (e) {
    return cors({
      statusCode: 502,
      body: JSON.stringify({ error: "hCaptcha verify request failed", detail: e.message || String(e) }),
    });
  }

  // تحديد الامتداد
  let ext = extFromMime(mime);
  if (!ext) ext = extFromFilename(filename);
  if (!ext) ext = (mime === "application/pdf") ? "pdf" : "jpg";

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
    const { y, m, da } = todayParts("Africa/Casablanca");
    const rand = Math.random().toString(36).slice(2, 10);
    const path = `incoming/${y}/${m}/${da}/${Date.now()}-${rand}.${ext}`;

    const { data, error } = await supabase
      .storage
      .from(SUPABASE_BUCKET)
      .createSignedUploadUrl(path);

    if (error) {
      return cors({
        statusCode: 500,
        body: JSON.stringify({ error: "createSignedUploadUrl failed", detail: error.message || String(error) }),
      });
    }

    const token = data?.token;
    if (!token) {
      return cors({ statusCode: 500, body: JSON.stringify({ error: "Missing upload token from Supabase" }) });
    }

    return cors({ statusCode: 200, body: JSON.stringify({ ok: true, path, token }) });
  } catch (e) {
    return cors({
      statusCode: 500,
      body: JSON.stringify({ error: "Unexpected error creating upload ticket", detail: e.message || String(e) }),
    });
  }
}
