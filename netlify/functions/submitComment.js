// netlify/functions/submitComment.js
export const config = { path: "/.netlify/functions/submitComment" };

/* CORS مبسّط */
function cors(res) {
  return {
    ...res,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Content-Type": "application/json",
    },
  };
}

/* تبطيء بسيط ضد السبام بالذاكرة */
const rlStore = new Map(); // ip -> { count, resetAt }
const RL_WINDOW_MS = 5 * 60 * 1000;   // 5 دقائق
const RL_MAX       = 5;               // 5 طلبات/نافذة

function rateLimit(ip) {
  const now = Date.now();
  const rec = rlStore.get(ip);
  if (!rec || now > rec.resetAt) {
    rlStore.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS });
    return { ok: true };
  }
  if (rec.count >= RL_MAX) {
    return { ok: false, retryAfter: Math.ceil((rec.resetAt - now) / 1000) };
  }
  rec.count += 1;
  return { ok: true };
}

import { createClient } from "@supabase/supabase-js";

/* المتغيرات البيئية */
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE,
  HCAPTCHA_SECRET,
  SUPABASE_PENDING_COMMENTS_TABLE, // اسم الجدول الاختياري
} = process.env;

const PENDING_TABLE = SUPABASE_PENDING_COMMENTS_TABLE || "pending_comments";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return cors({ statusCode: 200, body: "" });
  if (event.httpMethod !== "POST") {
    return cors({ statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) });
  }

  // تحقق المتغيرات
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: "Missing Supabase env" }) });
  }
  if (!HCAPTCHA_SECRET) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: "Missing hCaptcha secret" }) });
  }

  try {
    const { issueNumber, fullName, comment, hcaptchaToken } = JSON.parse(event.body || "{}");

    // التحقق المبدئي
    const errs = [];
    const num = Number(issueNumber);
    if (!Number.isFinite(num) || num <= 0) errs.push("رقم الملف غير صالح.");
    if (!fullName || String(fullName).trim().length < 8) errs.push("الاسم الكامل مطلوب (≥ 8 أحرف).");
    if (!comment || String(comment).trim().length < 40) errs.push("التعليق قصير (≥ 40 حرفًا).");
    if (!hcaptchaToken) errs.push("رمز hCaptcha مفقود.");
    if (errs.length) {
      return cors({ statusCode: 422, body: JSON.stringify({ error: errs.join(" ") }) });
    }

    // استنتاج IP للحد من السبام وإرفاقه بالسجل
    const ip =
      event.headers["x-nf-client-connection-ip"] ||
      event.headers["client-ip"] ||
      (event.headers["x-forwarded-for"] || "").split(",")[0] ||
      "";

    // تبطيء بسيط
    const rl = rateLimit(ip || "unknown");
    if (!rl.ok) {
      return cors({
        statusCode: 429,
        body: JSON.stringify({ error: "عدد محاولات متقارب جدًا. حاول لاحقًا.", retryAfter: rl.retryAfter }),
        headers: { "Retry-After": String(rl.retryAfter) },
      });
    }

    // تحقق hCaptcha على الخادم
    const form = new URLSearchParams();
    form.set("secret", HCAPTCHA_SECRET);
    form.set("response", String(hcaptchaToken));
    if (ip) form.set("remoteip", ip);

    const verifyRes = await fetch("https://hcaptcha.com/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const verifyJson = await verifyRes.json().catch(() => ({}));
    if (!verifyRes.ok || !verifyJson.success) {
      return cors({
        statusCode: 403,
        body: JSON.stringify({ error: "فشل التحقق من hCaptcha." }),
      });
    }

    // حفظ التعليق كمعلّق للمراجعة في Supabase (RLS مغلق والكتابة بمفتاح الخدمة)
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
    const { error: insErr } = await sb.from(PENDING_TABLE).insert({
      issue_number: num,
      full_name: String(fullName).trim(),
      comment: String(comment).trim(),
      // created_at يتم ضبطه افتراضيًا من قاعدة البيانات
    });

    if (insErr) {
      return cors({ statusCode: 500, body: JSON.stringify({ error: `DB insert error: ${insErr.message}` }) });
    }

    // رد نجاح للمستخدم (بدون إنشاء تعليق GitHub مباشرة)
    return cors({
      statusCode: 200,
      body: JSON.stringify({ ok: true, message: "تم استلام تعليقك للمراجعة اليدوية قبل النشر." }),
    });
  } catch (e) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: e.message || String(e) }) });
  }
}