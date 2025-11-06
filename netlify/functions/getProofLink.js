// netlify/functions/getProofLink.js
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";

export const config = { path: "/.netlify/functions/getProofLink" };

function cors(res) {
  return {
    ...res,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Key",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Content-Type": "application/json",
    },
  };
}

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE,
  SUPABASE_BUCKET,
  SUPABASE_PROOFS_TABLE, // اختياري
  ADMIN_HASH,
  ADMIN_KEY,             // اختياري: مفتاح ثابت عبر الهيدر
} = process.env;

const PROOFS_TABLE = SUPABASE_PROOFS_TABLE || "complaint_proofs";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return cors({ statusCode: 200, body: "" });
  if (event.httpMethod !== "POST") return cors({ statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) });

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !SUPABASE_BUCKET) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: "Missing Supabase env vars" }) });
  }
  if (!ADMIN_HASH && !ADMIN_KEY) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: "Missing admin secret (ADMIN_HASH or ADMIN_KEY)" }) });
  }

  try {
    const { issueNumber, password } = JSON.parse(event.body || "{}");
    const n = Number(issueNumber);
    if (!n || !Number.isFinite(n) || n <= 0) {
      return cors({ statusCode: 422, body: JSON.stringify({ error: "invalid issueNumber" }) });
    }

    // تحقّق إداري: كلمة سر (Bcrypt) أو مفتاح ثابت بالهيدر
    const headerKey = event.headers["x-admin-key"] || event.headers["X-Admin-Key"];
    let isAdmin = false;

    // تباطؤ بسيط ضد التخمين
    await new Promise(r => setTimeout(r, 150));

    if (ADMIN_KEY && headerKey && headerKey === ADMIN_KEY) {
      isAdmin = true;
    } else if (ADMIN_HASH && password) {
      isAdmin = await bcrypt.compare(String(password), String(ADMIN_HASH));
    }

    if (!isAdmin) {
      return cors({ statusCode: 401, body: JSON.stringify({ error: "unauthorized" }) });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    // جلب المسار الخاص للمرفق
    const { data, error } = await sb
      .from(PROOFS_TABLE)
      .select("proof_path")
      .eq("issue_number", n)
      .single();

    if (error || !data?.proof_path) {
      return cors({ statusCode: 404, body: JSON.stringify({ error: "proof not found for this issue" }) });
    }

    // توليد رابط موقّت (30 دقيقة)
    const EXPIRES = 60 * 30;
    const { data: sdata, error: serror } = await sb
      .storage
      .from(SUPABASE_BUCKET)
      .createSignedUrl(data.proof_path, EXPIRES);

    if (serror || !sdata?.signedUrl) {
      return cors({ statusCode: 500, body: JSON.stringify({ error: "failed to create signed url" }) });
    }

    return cors({
      statusCode: 200,
      body: JSON.stringify({ ok: true, issueNumber: n, signedUrl: sdata.signedUrl, expiresIn: EXPIRES }),
    });
  } catch (e) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: e.message || String(e) }) });
  }
}
