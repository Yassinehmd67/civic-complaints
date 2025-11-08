// netlify/functions/approvePendingComment.js
import bcrypt from "bcryptjs";

export const config = { path: "/.netlify/functions/approvePendingComment" };

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

import { createClient } from "@supabase/supabase-js";

const {
  REPO_OWNER, REPO_NAME, GITHUB_TOKEN,
  SUPABASE_URL, SUPABASE_SERVICE_ROLE,
  ADMIN_HASH,
  SUPABASE_PENDING_COMMENTS_TABLE,
} = process.env;

const PENDING_TABLE = SUPABASE_PENDING_COMMENTS_TABLE || "pending_comments";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return cors({ statusCode: 200, body: "" });
  if (event.httpMethod !== "POST")   return cors({ statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) });

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) return cors({ statusCode: 500, body: JSON.stringify({ error: "Supabase env missing" }) });
  if (!REPO_OWNER || !REPO_NAME || !GITHUB_TOKEN) return cors({ statusCode: 500, body: JSON.stringify({ error: "GitHub env missing" }) });
  if (!ADMIN_HASH) return cors({ statusCode: 500, body: JSON.stringify({ error: "ADMIN_HASH missing" }) });

  try {
    const { id, action, password } = JSON.parse(event.body || "{}"); // action = "approve" | "reject"

    if (!id || !action || !password) return cors({ statusCode: 422, body: JSON.stringify({ error: "invalid payload" }) });

    const ok = await bcrypt.compare(String(password), String(ADMIN_HASH));
    if (!ok) return cors({ statusCode: 401, body: JSON.stringify({ error: "كلمة السر غير صحيحة" }) });

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    // جلب السجل
    const { data: row, error: selErr } = await sb.from(PENDING_TABLE).select("*").eq("id", id).maybeSingle();
    if (selErr) return cors({ statusCode: 500, body: JSON.stringify({ error: selErr.message }) });
    if (!row)   return cors({ statusCode: 404, body: JSON.stringify({ error: "not found" }) });

    if (action === "approve") {
      // أنشر على GitHub ثم احذف السجل
      const body = `**الاسم الكامل:** ${row.full_name}\n\n${row.comment}\n\n_(مقبول من الإدارة)_`;
      const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues/${row.issue_number}/comments`;
      const gh = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GITHUB_TOKEN}`,
          "Accept": "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ body }),
      });
      if (!gh.ok) {
        const t = await gh.text();
        return cors({ statusCode: 500, body: JSON.stringify({ error: `GitHub error: ${t}` }) });
      }
    }

    // حذف السجل سواء تمت الموافقة أو الرفض
    const { error: delErr } = await sb.from(PENDING_TABLE).delete().eq("id", id);
    if (delErr) return cors({ statusCode: 500, body: JSON.stringify({ error: delErr.message }) });

    return cors({ statusCode: 200, body: JSON.stringify({ ok: true }) });
  } catch (e) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: e.message || String(e) }) });
  }
}