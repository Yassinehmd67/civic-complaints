// netlify/functions/submitReport.js
// إنشاء Issue لتقرير رصد + تحقق hCaptcha
export const config = { path: "/.netlify/functions/submitReport" };

/* ---------- CORS ---------- */
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

/* ---------- Utils ---------- */
function ipFromHeaders(h = {}) {
  const raw =
    h["x-forwarded-for"] ||
    h["X-Forwarded-For"] ||
    h["x-nf-client-connection-ip"] ||
    h["client-ip"] ||
    h["Client-IP"] ||
    "";
  return String(raw).split(",")[0].trim() || undefined;
}

/* ---------- Env ---------- */
const {
  REPO_OWNER,
  REPO_NAME,
  GITHUB_TOKEN,
  HCAPTCHA_SECRET, // مفعل في Netlify env
} = process.env;

/* ---------- Handler ---------- */
export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return cors({ statusCode: 200, body: "" });
  }
  if (event.httpMethod !== "POST") {
    return cors({
      statusCode: 405,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    });
  }

  // GitHub + hCaptcha
  if (!REPO_OWNER || !REPO_NAME || !GITHUB_TOKEN) {
    return cors({
      statusCode: 500,
      body: JSON.stringify({
        error: "Missing GitHub env vars",
        missing: {
          REPO_OWNER: !!REPO_OWNER,
          REPO_NAME: !!REPO_NAME,
          GITHUB_TOKEN: !!GITHUB_TOKEN,
        },
      }),
    });
  }
  if (!HCAPTCHA_SECRET) {
    return cors({
      statusCode: 500,
      body: JSON.stringify({ error: "Missing hCaptcha secret (HCAPTCHA_SECRET)" }),
    });
  }

  // Parse body
  let p0;
  try {
    p0 = JSON.parse(event.body || "{}");
  } catch {
    return cors({ statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) });
  }

  const p = {
    fullName: (p0.fullName || "").trim(),
    eventDateTime: (p0.eventDateTime || "").trim(),
    place: (p0.place || "").trim(),
    category: (p0.category || "").trim(),
    body: (p0.body || "").trim(),
    evidenceUrl: (p0.evidenceUrl || "").trim(),
    captchaToken: (p0.captchaToken || "").trim(),
  };

  // hCaptcha verify (required)
  if (!p.captchaToken) {
    return cors({ statusCode: 400, body: JSON.stringify({ error: "captchaToken is required" }) });
  }
  try {
    const remoteIp = ipFromHeaders(event.headers || {});
    const hv = await fetch("https://hcaptcha.com/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: HCAPTCHA_SECRET,
        response: p.captchaToken,
        ...(remoteIp ? { remoteip: remoteIp } : {}),
      }),
    });
    const v = await hv.json().catch(() => ({}));
    if (!v.success) {
      return cors({
        statusCode: 400,
        body: JSON.stringify({
          error: "فشل التحقق من hCaptcha",
          diagnostics: {
            "error-codes": v["error-codes"] || null,
            hostname: v.hostname || null,
            challenge_ts: v.challenge_ts || null,
            credit: v.credit || null,
          },
        }),
      });
    }
  } catch (e) {
    return cors({
      statusCode: 502,
      body: JSON.stringify({
        error: "hCaptcha verify request failed",
        detail: e.message || String(e),
      }),
    });
  }

  // Validate fields
  const errs = [];
  if (!p.eventDateTime) errs.push("تاريخ/وقت الواقعة مطلوب.");
  if (!p.place) errs.push("مكان الواقعة مطلوب.");
  if (!p.category) errs.push("التصنيف مطلوب.");
  if (!p.body || p.body.length < 120) errs.push("نص التقرير قصير جدًا (≥ 120 حرفًا).");
  if (errs.length) {
    return cors({ statusCode: 422, body: JSON.stringify({ error: errs.join(" ") }) });
  }

  // Compose issue
  const title = `تقرير: [${p.category}] ${p.place} — ${p.eventDateTime}`;
  const issueBody = [
    `**النوع:** تقرير`,
    p.fullName ? `**الاسم (اختياري للعرض العلني):** ${p.fullName}` : "",
    `**الوقت:** ${p.eventDateTime}`,
    `**المكان:** ${p.place}`,
    p.evidenceUrl ? `**روابط أدلة:** ${p.evidenceUrl}` : "",
    "",
    p.body,
  ]
    .filter(Boolean)
    .join("\n");

  const labels = ["pending", "type: report", `topic: ${p.category}`];
  if (p.place) labels.push(`city: ${p.place}`);

  // Create GitHub issue
  try {
    const ghRes = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, body: issueBody, labels }),
      }
    );

    if (!ghRes.ok) {
      const t = await ghRes.text();
      return cors({
        statusCode: 500,
        body: JSON.stringify({ error: "GitHub error", detail: t }),
      });
    }

    const issue = await ghRes.json();
    return cors({
      statusCode: 200,
      body: JSON.stringify({ number: issue.number, html_url: issue.html_url }),
    });
  } catch (e) {
    return cors({
      statusCode: 500,
      body: JSON.stringify({
        error: "Submit report failed",
        detail: e.message || String(e),
      }),
    });
  }
}
