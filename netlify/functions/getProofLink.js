// netlify/functions/getProofLink.js
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";

export const config = { path: "/.netlify/functions/getProofLink" };

/* CORS موحّد */
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

/* بيئة التشغيل */
const {
  ADMIN_HASH,                 // هاش bcrypt لكلمة سر المشرف
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE,      // مفتاح service role (سِرّي)
  SUPABASE_BUCKET,            // مثال: proofs
  SUPABASE_PROOFS_TABLE,      // مثال: complaint_proofs
  HCAPTCHA_SECRET,            // التحقق من hCaptcha على الخادم
  ORIGIN_WHITELIST,           // اختياري: example.com,foo.netlify.app
} = process.env;

const table = SUPABASE_PROOFS_TABLE || "complaint_proofs";

/* أمان: دقّق السلسلة وأزل أي بادئة bucket/ */
function normalizePath(p = "") {
  let path = String(p || "").replace(/^\/+/, "");
  // لو المسار جاء بصيغة "proofs/..." قصّه إلى ما بعد اسم البكت
  if (SUPABASE_BUCKET && path.startsWith(SUPABASE_BUCKET + "/")) {
    path = path.slice(SUPABASE_BUCKET.length + 1);
  }
  // منع محاولات الخروج من المسار
  if (path.includes("..")) return "";
  return path;
}

/* ========= تبطيء بسيط لكل IP ========= */
const RL_WINDOW_MS = 10 * 60 * 1000; // 10 دقائق
const RL_LIMIT = 60;                  // حد أعلى قليلًا لوظيفة المشرف
const rlMap = new Map();              // ip -> [timestamps]
function rateHit(ip) {
  const now = Date.now();
  const arr = (rlMap.get(ip) || []).filter((t) => now - t < RL_WINDOW_MS);
  arr.push(now);
  rlMap.set(ip, arr);
  return arr.length;
}

/* ========= تحقّق hCaptcha ========= */
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

/* ========= تحقّق Origin (اختياري) ========= */
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
  if (event.httpMethod !== "POST") {
    return cors({ statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) });
  }

  // فحص المتغيرات الأساسية
  if (!ADMIN_HASH || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !SUPABASE_BUCKET) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: "Server env missing" }) });
  }

  // فحص Origin
  if (!isOriginAllowed(event.headers || {})) {
    return cors({ statusCode: 403, body: JSON.stringify({ error: "Origin not allowed" }) });
  }

  // تبطيء حسب IP
  const ipHeader =
    event.headers["x-nf-client-connection-ip"] ||
    event.headers["client-ip"] ||
    (event.headers["x-forwarded-for"] || "").split(",")[0] ||
    null;

  if (rateHit(ipHeader || "unknown") > RL_LIMIT) {
    return cors({
      statusCode: 429,
      body: JSON.stringify({ error: "طلبات كثيرة من نفس العنوان. حاول لاحقًا." }),
    });
  }

  try {
    // حمولة الطلب: { issueNumber, password, hcaptchaToken, expiresIn? }
    const { issueNumber, password, hcaptchaToken, expiresIn } = JSON.parse(event.body || "{}");

    // hCaptcha إلزامي
    const okCaptcha = await verifyHCaptcha(hcaptchaToken);
    if (!okCaptcha) {
      return cors({ statusCode: 400, body: JSON.stringify({ error: "فشل التحقق من hCaptcha" }) });
    }

    // تحقق مدخلات
    const num = Number(issueNumber);
    if (!Number.isFinite(num) || num <= 0) {
      return cors({ statusCode: 422, body: JSON.stringify({ error: "issueNumber غير صالح" }) });
    }
    if (!password) {
      return cors({ statusCode: 422, body: JSON.stringify({ error: "كلمة السر مطلوبة" }) });
    }

    // تحقق كلمة السر (Bcrypt)
    const ok = await bcrypt.compare(String(password), String(ADMIN_HASH));
    if (!ok) {
      return cors({ statusCode: 403, body: JSON.stringify({ error: "كلمة السر غير صحيحة" }) });
    }

    // Supabase عميل بصلاحية Service Role
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    // جلب المسار من الجدول
    const { data: row, error: qErr } = await supabase
      .from(table)
      .select("proof_path")
      .eq("issue_number", num)
      .maybeSingle();

    if (qErr) {
      return cors({ statusCode: 500, body: JSON.stringify({ error: `DB error: ${qErr.message}` }) });
    }
    if (!row || !row.proof_path) {
      return cors({ statusCode: 404, body: JSON.stringify({ error: "لا يوجد ملف مرتبط بهذه الشكوى" }) });
    }

    const objectPath = normalizePath(row.proof_path);
    if (!objectPath) {
      return cors({ statusCode: 500, body: JSON.stringify({ error: "مسار الملف غير صالح" }) });
    }

    // مدة الصلاحية (ثوانٍ) — افتراضي 10 دقائق، نقيّدها بين 60 ثانية و 30 دقيقة
    const ttl = Math.max(60, Math.min(60 * 30, Number(expiresIn) || 600));

    // توليد رابط مؤقّت من التخزين
    const { data: signed, error: sErr } = await supabase
      .storage
      .from(SUPABASE_BUCKET)
      .createSignedUrl(objectPath, ttl);

    if (sErr) {
      return cors({ statusCode: 500, body: JSON.stringify({ error: `sign error: ${sErr.message}` }) });
    }

    const signedUrl = signed?.signedUrl || "";
    const expiresAt = Date.now() + ttl * 1000;

    // نُرجع signedUrl صراحةً (مع توافق خلفي عبر url)
    return cors({
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        signedUrl,
        url: signedUrl,   // توافق مع نسخ الواجهة القديمة
        expiresAt,
        ttl,
      }),
    });
  } catch (e) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: e.message || String(e) }) });
  }
}
