// netlify/functions/submitReport.js
export const config = { path: "/.netlify/functions/submitReport" };

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
  HCAPTCHA_SECRET,   // مفتاح hCaptcha السري (خادم)
  ORIGIN_WHITELIST, // اختياري: example.com,foo.netlify.app
} = process.env;

/* ========= تبطيء بسيط لكل IP ========= */
const RL_WINDOW_MS = 10 * 60 * 1000; // 10 دقائق
const RL_LIMIT = 30;                  // حد تقارير أعلى قليلًا
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
  if (event.httpMethod !== "POST")    return cors({ statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) });

  if (!REPO_OWNER || !REPO_NAME || !GITHUB_TOKEN) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: "Missing server env" }) });
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
    const p0 = JSON.parse(event.body || "{}");

    // تنظيف الحقول
    const p = {
      fullName: (p0.fullName || "").trim(),
      eventDateTime: (p0.eventDateTime || "").trim(),
      place: (p0.place || "").trim(),
      category: (p0.category || "").trim(),
      body: (p0.body || "").trim(),
      evidenceUrl: (p0.evidenceUrl || "").trim(),
      hcaptchaToken: (p0.hcaptchaToken || "").trim(),
    };

    // hCaptcha إلزامي
    const okCaptcha = await verifyHCaptcha(p.hcaptchaToken);
    if (!okCaptcha) {
      return cors({ statusCode: 400, body: JSON.stringify({ error: "فشل التحقق من hCaptcha" }) });
    }

    // التحقق من المدخلات
    const errs = [];
    if (!p.eventDateTime) errs.push("تاريخ/وقت الواقعة مطلوب.");
    if (!p.place)         errs.push("المكان مطلوب.");
    if (!p.category)      errs.push("التصنيف مطلوب.");
    if (!p.body || p.body.length < 120) errs.push("نص التقرير قصير (≥ 120 حرفًا).");
    if (errs.length) return cors({ statusCode: 422, body: JSON.stringify({ error: errs.join(" ") }) });

    // دعم عدة روابط أدلة مفصولة بفواصل
    let evidenceBlock = "";
    if (p.evidenceUrl) {
      const links = p.evidenceUrl.split(",").map(s => s.trim()).filter(Boolean);
      if (links.length === 1) {
        evidenceBlock = `**روابط أدلة:** ${links[0]}`;
      } else if (links.length > 1) {
        evidenceBlock = `**روابط أدلة:**\n${links.map(u => `- ${u}`).join("\n")}`;
      }
    }

    const title = `تقرير: [${p.category}] — ${p.place} — ${p.eventDateTime}`;
    const md = [
      `**النوع:** تقرير`,
      p.fullName ? `**مبلِّغ:** ${p.fullName}` : "",
      `**تاريخ/وقت الواقعة:** ${p.eventDateTime}`,
      `**المكان:** ${p.place}`,
      "",
      p.body,
      "",
      evidenceBlock,
    ].filter(Boolean).join("\n");

    const labels = ["pending", "type: report", `topic: ${p.category}`];
    if (p.place) labels.push(`city: ${p.place}`);

    const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, body: md, labels }),
    });

    if (!res.ok) {
      const t = await res.text();
      return cors({ statusCode: 500, body: JSON.stringify({ error: `GitHub error: ${t}` }) });
    }

    const issue = await res.json();
    return cors({
      statusCode: 200,
      body: JSON.stringify({ number: issue.number, html_url: issue.html_url }),
    });

  } catch (e) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: String(e.message || e) }) });
  }
}
