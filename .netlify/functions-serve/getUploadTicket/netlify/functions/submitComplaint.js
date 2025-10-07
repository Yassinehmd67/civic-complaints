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
} = process.env;

export async function handler(event) {
  if (event.httpMethod === "OPTIONS")
    return cors({ statusCode: 200, body: "" });
  if (event.httpMethod !== "POST")
    return cors({
      statusCode: 405,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    });

  if (!REPO_OWNER || !REPO_NAME || !GITHUB_TOKEN) {
    return cors({
      statusCode: 500,
      body: JSON.stringify({ error: "Missing GitHub env vars" }),
    });
  }

  try {
    const p0 = JSON.parse(event.body || "{}");

    // تنظيف الحقول
    const p = {
      fullName: (p0.fullName || "").trim(),
      showName: (p0.showName || "").trim(),
      submittedDate: (p0.submittedDate || "").trim(),
      category: (p0.category || "").trim(),
      place: (p0.place || "").trim(),
      summary: (p0.summary || "").trim(),
      proofPath: (p0.proofPath || "").trim(),
      proofUrl: (p0.proofUrl || "").trim(),
    };

    // التحقق من المدخلات الأساسية
    const errs = [];
    if (!p.fullName || p.fullName.length < 8)
      errs.push("الاسم الكامل مطلوب.");
    if (!p.submittedDate) errs.push("تاريخ تقديم الشكوى مطلوب.");
    if (!p.category) errs.push("نوع الشكوى مطلوب.");
    if (!p.summary || p.summary.length < 120)
      errs.push("الملخص قصير جدًا (≥ 120 حرفًا).");

    // قبول إما proofPath أو proofUrl
    let proofPath = p.proofPath;
    if (!proofPath && p.proofUrl) {
      // استخرج object path من signed URL: .../object/sign/<bucket>/<OBJECT_PATH>?token=...
      const m =
        p.proofUrl.match(
          /\/object\/sign\/([^/]+)\/(.+?)\?(?:.*)$/
        ) ||
        p.proofUrl.match(
          /\/sign\/([^/]+)\/(.+?)\?(?:.*)$/ // نمط بديل
        );
      if (m && m[1] && m[2]) {
        // تحقّق من اسم الـ bucket في الرابط
        if (!SUPABASE_BUCKET || m[1] === SUPABASE_BUCKET) {
          proofPath = decodeURIComponent(m[2]);
        }
      }
    }
    if (!proofPath) errs.push("يجب رفع وثيقة/صورة الشكوى الموقّعة.");

    if (errs.length)
      return cors({
        statusCode: 422,
        body: JSON.stringify({ error: errs.join(" ") }),
      });

    const showName = p.showName === "yes";
    const title = `شكوى: [${p.category}] ${
      showName ? p.fullName : "اسم محفوظ"
    } — ${p.submittedDate}`;

    // (اختياري) إذا توفّرت بيئة Supabase على الخادم، أنشئ رابطًا داخليًا موقّتًا للإدارة
    let adminSignedUrl = "";
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE && SUPABASE_BUCKET && proofPath) {
      try {
        const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
        const { data, error } = await sb
          .storage
          .from(SUPABASE_BUCKET)
          .createSignedUrl(proofPath, 60 * 60); // 1 ساعة
        if (!error) adminSignedUrl = data?.signedUrl || "";
      } catch {
        // تجاهل أي خطأ هنا (تشخيص فقط)
      }
    }

    const proofLines = [
      `> **مسار الوثيقة (خاص لدى الإدارة):** ${proofPath}`,
      adminSignedUrl
        ? `> **رابط داخلي موقّت (ساعة):** ${adminSignedUrl}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const body = [
      `**النوع:** شكوى`,
      `**الاسم الكامل (للإدارة):** ${p.fullName}`,
      `**إظهار الاسم علنًا؟** ${showName ? "نعم" : "لا"}`,
      `**تاريخ التقديم:** ${p.submittedDate}`,
      p.place ? `**المكان/المدينة:** ${p.place}` : "",
      `**ملخص**: ${p.summary}`,
      "",
      proofLines,
      `> *تُنشر الشكايات بملخص فقط، والوثائق محفوظة لدى الإدارة.*`,
    ]
      .filter(Boolean)
      .join("\n");

    const labels = ["pending", "type: complaint", `topic: ${p.category}`];
    if (p.place) labels.push(`city: ${p.place}`);

    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, body, labels }),
      }
    );

    if (!res.ok) {
      const t = await res.text();
      return cors({
        statusCode: 500,
        body: JSON.stringify({ error: `GitHub error: ${t}` }),
      });
    }

    const issue = await res.json();
    return cors({
      statusCode: 200,
      body: JSON.stringify({
        number: issue.number,
        html_url: issue.html_url,
      }),
    });
  } catch (e) {
    console.error("[submitComplaint ERROR]", e);
    return cors({
      statusCode: 500,
      body: JSON.stringify({ error: e.message || String(e) }),
    });
  }
}
