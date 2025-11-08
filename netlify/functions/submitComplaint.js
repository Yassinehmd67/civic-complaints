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
  SUPABASE_PROOFS_TABLE, // اختياري
  HCAPTCHA_SECRET,        // مفتاح الخادم hCaptcha
  ORIGIN_WHITELIST,       // اختياري: example.com,foo.netlify.app
} = process.env;

const PROOFS_TABLE = SUPABASE_PROOFS_TABLE || "complaint_proofs";

/* ========= تبطيء بسيط لكل IP ========= */
const RL_WINDOW_MS = 10 * 60 * 1000; // 10 دقائق
const RL_LIMIT = 20;                  // 20 إرسالًا للشكوى لكل IP ضمن النافذة
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

  // GitHub مطلوب
  if (!REPO_OWNER || !REPO_NAME || !GITHUB_TOKEN) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: "Missing GitHub env vars" }) });
  }
  // Supabase مطلوب للتخزين الخاص
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !SUPABASE_BUCKET) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: "Missing Supabase env vars" }) });
  }

  // تحقّق Origin
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
    const p0 = JSON.parse(event.body || "{}");
    const p = {
      fullName: (p0.fullName || "").trim(),
      showName: (p0.showName || "").trim(),
      submittedDate: (p0.submittedDate || "").trim(),
      category: (p0.category || "").trim(),
      place: (p0.place || "").trim(),
      summary: (p0.summary || "").trim(),
      proofPath: (p0.proofPath || "").trim(), // مسار داخل البكت (بدون اسم البكت)
      hcaptchaToken: (p0.hcaptchaToken || "").trim(),
    };

    // hCaptcha إلزامي
    const okCaptcha = await verifyHCaptcha(p.hcaptchaToken);
    if (!okCaptcha) {
      return cors({ statusCode: 400, body: JSON.stringify({ error: "فشل التحقق من hCaptcha" }) });
    }

    // التحقق
    const errs = [];
    if (!p.fullName || p.fullName.length < 8) errs.push("الاسم الكامل مطلوب (≥ 8 أحرف).");
    if (!p.submittedDate) errs.push("تاريخ تقديم الشكوى مطلوب.");
    if (!p.category) errs.push("نوع الشكوى مطلوب.");
    if (!p.summary || p.summary.length < 120) errs.push("الملخص قصير جدًا (≥ 120 حرفًا).");
    if (!p.proofPath) errs.push("يجب رفع وثيقة/صورة الشكوى الموقّعة.");
    if (errs.length) {
      return cors({ statusCode: 422, body: JSON.stringify({ error: errs.join(" ") }) });
    }

    // منع تمرير اسم البكت في المسار (يجب أن يكون داخليًا فقط)
    const normalizedPath = String(p.proofPath).replace(/^\/+/, "");
    if (normalizedPath.includes("..") || normalizedPath.startsWith(SUPABASE_BUCKET + "/")) {
      return cors({ statusCode: 400, body: JSON.stringify({ error: "مسار المرفق غير صالح." }) });
    }

    const showName = p.showName === "yes";
    const title = `شكوى: [${p.category}] ${showName ? p.fullName : "اسم محفوظ"} — ${p.submittedDate}`;

    // ⚠️ لا نذكر أي تفاصيل عن المرفق داخل نص الـIssue
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

      const { error: insertErr } = await sb.from(PROOFS_TABLE).insert({
        issue_number: issue.number,
        proof_path: normalizedPath,
        uploader_ip: ipHeader || null,
      });
      if (insertErr) {
        console.error("[Supabase insert error]", insertErr);
        // لا نفشل الطلب للمستخدم، لكن نسجل الخطأ
      }
    } catch (e) {
      console.error("[Supabase insert catch]", e);
      // لا نفشل الطلب؛ الـIssue أنشئ بالفعل
    }

    // 3) رد للمستخدم
    return cors({
      statusCode: 200,
      body: JSON.stringify({ number: issue.number, html_url: issue.html_url }),
    });
  } catch (e) {
    console.error("[submitComplaint ERROR]", e);
    return cors({ statusCode: 500, body: JSON.stringify({ error: e.message || String(e) }) });
  }
}
