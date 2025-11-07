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
} = process.env;

/* أمان: دقّق السلسلة وأزل أي بادئة bucket/ */
function normalizePath(p = "") {
  let path = String(p || "").replace(/^\/+/, "");
  // لو المسار جاء بصيغة "proofs/..." قصّه إلى ما بعد اسم البكت
  if (SUPABASE_BUCKET && path.startsWith(SUPABASE_BUCKET + "/")) {
    path = path.slice(SUPABASE_BUCKET.length + 1);
  }
  return path;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return cors({ statusCode: 200, body: "" });
  if (event.httpMethod !== "POST") {
    return cors({ statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) });
  }

  // فحص المتغيرات
  if (!ADMIN_HASH || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !SUPABASE_BUCKET) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: "Server env missing" }) });
  }
  const table = SUPABASE_PROOFS_TABLE || "complaint_proofs";

  try {
    // حمولة الطلب: { issueNumber, password, expiresIn? }
    const { issueNumber, password, expiresIn } = JSON.parse(event.body || "{}");

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

    // مدة الصلاحية (ثوانٍ) — افتراضي 10 دقائق
    const ttl = Math.max(60, Math.min(60 * 60, Number(expiresIn) || 600));

    // توليد رابط مؤقّت من التخزين
    const { data: signed, error: sErr } = await supabase
      .storage
      .from(SUPABASE_BUCKET)
      .createSignedUrl(objectPath, ttl);

    if (sErr) {
      return cors({ statusCode: 500, body: JSON.stringify({ error: `sign error: ${sErr.message}` }) });
    }

    const expiresAt = Date.now() + ttl * 1000;
    return cors({
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        url: signed?.signedUrl || "",
        expiresAt,
      }),
    });
  } catch (e) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: e.message || String(e) }) });
  }
}
