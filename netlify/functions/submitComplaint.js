// netlify/functions/submitComplaint.js
import { createClient } from "@supabase/supabase-js";

export const config = { path: "/.netlify/functions/submitComplaint" };

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

const {
  REPO_OWNER,
  REPO_NAME,
  GITHUB_TOKEN,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE,
  SUPABASE_BUCKET,
  SUPABASE_PROOFS_TABLE, // اختياري
  // ⚠️ لم نعد نستخدم HCAPTCHA_SECRET هنا لتجنّب التحقق المزدوج
} = process.env;

const PROOFS_TABLE = SUPABASE_PROOFS_TABLE || "complaint_proofs";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return cors({ statusCode: 200, body: "" });
  if (event.httpMethod !== "POST") {
    return cors({ statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) });
  }

  // GitHub مطلوب
  if (!REPO_OWNER || !REPO_NAME || !GITHUB_TOKEN) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: "Missing GitHub env vars" }) });
  }
  // Supabase مطلوب للتخزين الخاص
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !SUPABASE_BUCKET) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: "Missing Supabase env vars" }) });
  }

  try {
    const p0 = JSON.parse(event.body || "{}");
    const p = {
      fullName: (p0.fullName || "").trim(),
      showName: (p0.showName || "").trim(),
      submittedDate: (p0.submittedDate || "").trim(),
      category: (p0.category || "").trim(),
      place: (p0.place || "").trim(),
      summary: (p0.summary || "").trim(),
      proofPath: (p0.proofPath || "").trim(),
      proofUrl: (p0.proofUrl || "").trim(),
      // captchaToken يمكن أن يأتي من الواجهة لكننا لا نتحقق به هنا
    };

    // التحقق من المعطيات
    const errs = [];
    if (!p.fullName || p.fullName.length < 8) errs.push("الاسم الكامل مطلوب.");
    if (!p.submittedDate) errs.push("تاريخ تقديم الشكوى مطلوب.");
    if (!p.category) errs.push("نوع الشكوى مطلوب.");
    if (!p.summary || p.summary.length < 120) errs.push("الملخص قصير جدًا (≥ 120 حرفًا).");

    // قبول proofPath أو استخراج من signed URL (احتياطي)
    let proofPath = p.proofPath;
    if (!proofPath && p.proofUrl) {
      const m =
        p.proofUrl.match(/\/object\/sign\/([^/]+)\/(.+?)\?(?:.*)$/) ||
        p.proofUrl.match(/\/sign\/([^/]+)\/(.+?)\?(?:.*)$/);
      if (m && m[1] && m[2]) {
        if (!SUPABASE_BUCKET || m[1] === SUPABASE_BUCKET) {
          proofPath = decodeURIComponent(m[2]);
        }
      }
    }
    if (!proofPath) errs.push("يجب رفع وثيقة/صورة الشكوى الموقّعة.");

    if (errs.length) {
      return cors({ statusCode: 422, body: JSON.stringify({ error: errs.join(" ") }) });
    }

    const showName = p.showName === "yes";
    const title = `شكوى: [${p.category}] ${showName ? p.fullName : "اسم محفوظ"} — ${p.submittedDate}`;

    const body = [
      `**النوع:** شكوى`,
      `**الاسم الكامل (للإدارة):** ${p.fullName}`,
      `**إظهار الاسم علنًا؟** ${showName ? "نعم" : "لا"}`,
      `**تاريخ التقديم:** ${p.submittedDate}`,
      p.place ? `**المكان/المدينة:** ${p.place}` : "",
      `**ملخص**: ${p.summary}`,
      "",
      `> *تُنشر الشكايات بملخص فقط. المرفقات محفوظة لدى الإدارة ولا تُعرض للعامة.*`,
    ].filter(Boolean).join("\n");

    const labels = ["pending", "has-proof", "type: complaint", `topic: ${p.category}`];
    if (p.place) labels.push(`city: ${p.place}`);

    // 1) إنشاء Issue على GitHub
    const ghRes = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, body, labels }),
    });

    if (!ghRes.ok) {
      const t = await ghRes.text();
      return cors({ statusCode: 500, body: JSON.stringify({ error: `GitHub error: ${t}` }) });
    }

    const issue = await ghRes.json();

    // 2) تخزين المسار سرًا في Supabase
    try {
      const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
      const ipHeader =
        event.headers["x-nf-client-connection-ip"] ||
        event.headers["client-ip"] ||
        (event.headers["x-forwarded-for"] || "").split(",")[0] ||
        null;

      const { error: insertErr } = await sb.from(PROOFS_TABLE).insert({
        issue_number: issue.number,
        proof_path: proofPath,
        uploader_ip: ipHeader || null,
      });
      if (insertErr) console.error("[Supabase insert error]", insertErr);
    } catch (e) {
      console.error("[Supabase insert catch]", e);
    }

    return cors({
      statusCode: 200,
      body: JSON.stringify({ number: issue.number, html_url: issue.html_url }),
    });
  } catch (e) {
    console.error("[submitComplaint ERROR]", e);
    return cors({ statusCode: 500, body: JSON.stringify({ error: e.message || String(e) }) });
  }
}
