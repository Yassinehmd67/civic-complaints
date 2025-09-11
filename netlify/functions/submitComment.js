// netlify/functions/submitComment.js
export const config = { path: "/.netlify/functions/submitComment" };

/* ---------- Helpers ---------- */
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

/** تنظيف المسافات العربية/اللاتينية */
function clean(s = "") {
  return String(s).replace(/\s+/g, " ").trim();
}

/* ---------- Handler ---------- */
export async function handler(event) {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") return cors({ statusCode: 200, body: "" });
  if (event.httpMethod !== "POST") {
    return cors({ statusCode: 405, body: toJSON({ ok: false, error: "Method Not Allowed" }) });
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    return cors({ statusCode: 500, body: toJSON({ ok: false, error: "Missing Supabase env vars" }) });
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    let { issueNumber, fullName, comment } = payload;

    // Normalize
    issueNumber = Number(issueNumber);
    fullName = clean(fullName);
    comment = clean(comment);

    // Validation
    const errs = [];
    if (!Number.isFinite(issueNumber) || issueNumber <= 0) errs.push("رقم الملف غير صالح.");
    if (!fullName || fullName.length < 8 || fullName.length > 80) errs.push("الاسم الكامل مطلوب (8–80 حرفًا).");
    if (!comment || comment.length < 40) errs.push("التعليق قصير جدًا. الحد الأدنى 40 حرفًا.");
    if (comment.length > 2000) errs.push("التعليق طويل جدًا. الحد الأقصى 2000 حرف.");

    if (errs.length) {
      return cors({ statusCode: 422, body: toJSON({ ok: false, error: errs.join(" ") }) });
    }

    // Insert into Supabase (pending review)
    const insertRow = {
      issue_number: issueNumber,
      full_name: fullName,
      comment: comment,
    };

    const url = `${SUPABASE_URL}/rest/v1/pending_comments`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify(insertRow),
    });

    if (!res.ok) {
      const text = await res.text();
      return cors({
        statusCode: 500,
        body: toJSON({ ok: false, error: `Supabase error: ${text || res.status}` }),
      });
    }

    const rows = await res.json(); // representation with the new row
    const row = Array.isArray(rows) ? rows[0] : rows;

    return cors({
      statusCode: 200,
      body: toJSON({
        ok: true,
        id: row?.id || null,
        message: "تم استلام التعليق ويحتاج لمراجعة المدير قبل النشر."
      }),
    });
  } catch (e) {
    return cors({
      statusCode: 500,
      body: toJSON({ ok: false, error: e?.message || String(e) }),
    });
  }
}
