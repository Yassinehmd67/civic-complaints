// netlify/functions/moderateComment.js
export const config = { path: "/.netlify/functions/moderateComment" };

import bcrypt from "bcryptjs";

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
const toJSON = (o) => JSON.stringify(o);

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return cors({ statusCode: 200, body: "" });
  if (event.httpMethod !== "POST") return cors({ statusCode: 405, body: toJSON({ ok:false, error:"Method Not Allowed" }) });

  const {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE,
    REPO_OWNER,
    REPO_NAME,
    GITHUB_TOKEN,
    ADMIN_HASH
  } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    return cors({ statusCode: 500, body: toJSON({ ok:false, error:"Missing Supabase env vars" }) });
  }
  if (!REPO_OWNER || !REPO_NAME || !GITHUB_TOKEN) {
    return cors({ statusCode: 500, body: toJSON({ ok:false, error:"Missing GitHub env vars" }) });
  }
  if (!ADMIN_HASH) {
    return cors({ statusCode: 500, body: toJSON({ ok:false, error:"Missing ADMIN_HASH" }) });
  }

  try {
    const { id, action, password } = JSON.parse(event.body || "{}");
    if (!id || !action || !password) {
      return cors({ statusCode: 422, body: toJSON({ ok:false, error:"بيانات ناقصة." }) });
    }

    // تحقق كلمة السر
    const passOk = await bcrypt.compare(password, ADMIN_HASH);
    if (!passOk) return cors({ statusCode: 401, body: toJSON({ ok:false, error:"كلمة السر غير صحيحة." }) });

    // اجلب التعليق من Supabase لمنع التلاعب
    const getUrl = new URL(`${SUPABASE_URL}/rest/v1/pending_comments`);
    getUrl.searchParams.set("id", `eq.${id}`);
    getUrl.searchParams.set("select", "id,issue_number,full_name,comment,created_at");
    const getRes = await fetch(getUrl, {
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE}`,
        "Accept": "application/json",
      }
    });
    if (!getRes.ok) {
      const t = await getRes.text();
      return cors({ statusCode: 500, body: toJSON({ ok:false, error:`Supabase error: ${t || getRes.status}` }) });
    }
    const rows = await getRes.json();
    const row = rows?.[0];
    if (!row) return cors({ statusCode: 404, body: toJSON({ ok:false, error:"التعليق غير موجود" }) });

    if (action === "reject") {
      // احذف فقط
      const delUrl = new URL(`${SUPABASE_URL}/rest/v1/pending_comments`);
      delUrl.searchParams.set("id", `eq.${id}`);
      const delRes = await fetch(delUrl, {
        method: "DELETE",
        headers: {
          "apikey": SUPABASE_SERVICE_ROLE,
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE}`,
        }
      });
      if (!delRes.ok) {
        const t = await delRes.text();
        return cors({ statusCode: 500, body: toJSON({ ok:false, error:`Supabase delete error: ${t || delRes.status}` }) });
      }
      return cors({ statusCode: 200, body: toJSON({ ok:true, action:"rejected" }) });
    }

    if (action === "approve") {
      // انشر في GitHub كتعليق على الـ Issue
      const ghBody =
        `**الاسم الكامل:** ${row.full_name}\n\n` +
        `${row.comment}\n\n` +
        `_(مقبول من الإدارة)_`;

      const ghUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues/${row.issue_number}/comments`;
      const ghRes = await fetch(ghUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GITHUB_TOKEN}`,
          "Accept": "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ body: ghBody }),
      });
      if (!ghRes.ok) {
        const t = await ghRes.text();
        return cors({ statusCode: 500, body: toJSON({ ok:false, error:`GitHub error: ${t || ghRes.status}` }) });
      }
      const ghData = await ghRes.json();

      // احذف من pending_comments
      const delUrl = new URL(`${SUPABASE_URL}/rest/v1/pending_comments`);
      delUrl.searchParams.set("id", `eq.${id}`);
      const delRes = await fetch(delUrl, {
        method: "DELETE",
        headers: {
          "apikey": SUPABASE_SERVICE_ROLE,
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE}`,
        }
      });
      if (!delRes.ok) {
        const t = await delRes.text();
        return cors({ statusCode: 500, body: toJSON({ ok:false, error:`Supabase delete error: ${t || delRes.status}` }) });
      }

      return cors({ statusCode: 200, body: toJSON({ ok:true, action:"approved", github_comment_id: ghData?.id }) });
    }

    // غير معروفة
    return cors({ statusCode: 422, body: toJSON({ ok:false, error:"إجراء غير معروف" }) });
  } catch (e) {
    return cors({ statusCode: 500, body: toJSON({ ok:false, error: e?.message || String(e) }) });
  }
}
