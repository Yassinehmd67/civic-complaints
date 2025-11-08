// netlify/functions/upvoteIssue.js
export const config = { path: "/.netlify/functions/upvoteIssue" };

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

const { REPO_OWNER, REPO_NAME, GITHUB_TOKEN, HCAPTCHA_SECRET, ORIGIN_WHITELIST } = process.env;

/* ========= تبطيء بسيط لكل IP ========= */
const RL_WINDOW_MS = 5 * 60 * 1000; // 5 دقائق
const RL_LIMIT = 120;               // 120 تصويتًا/IP/5 دقائق
const rlMap = new Map();            // ip -> [timestamps]
function rateHit(ip) {
  const now = Date.now();
  const arr = (rlMap.get(ip) || []).filter((t) => now - t < RL_WINDOW_MS);
  arr.push(now);
  rlMap.set(ip, arr);
  return arr.length;
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

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return cors({ statusCode: 200, body: "" });
  if (event.httpMethod !== "POST") {
    return cors({ statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) });
  }

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
    "unknown";
  if (rateHit(ipHeader) > RL_LIMIT) {
    return cors({
      statusCode: 429,
      body: JSON.stringify({ error: "طلبات كثيرة من نفس العنوان. حاول لاحقًا." }),
    });
  }

  try {
    const { issueNumber, hcaptchaToken } = JSON.parse(event.body || "{}");

    // hCaptcha إلزامي
    const okCaptcha = await verifyHCaptcha(hcaptchaToken);
    if (!okCaptcha) {
      return cors({ statusCode: 400, body: JSON.stringify({ error: "فشل التحقق من hCaptcha" }) });
    }

    if (!issueNumber) {
      return cors({ statusCode: 422, body: JSON.stringify({ error: "issueNumber مطلوب." }) });
    }

    // GitHub Reactions API
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues/${issueNumber}/reactions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json, application/vnd.github.squirrel-girl-preview+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: "+1" }),
    });

    // ملاحظة مهمة:
    // بما أن التفاعل يتم عبر حساب التوكن نفسه، لن يُسجّل إلا تفاعل واحد على الأكثر،
    // وسترجع GitHub 409 عند محاولة مكررة. نعتبر الحالات 200/201/409 نجاحًا.
    if ([200, 201, 409].includes(res.status)) {
      return cors({ statusCode: 200, body: JSON.stringify({ ok: true }) });
    }

    const text = await res.text();
    return cors({
      statusCode: res.status,
      body: JSON.stringify({ error: `GitHub reaction error: ${text}` }),
    });
  } catch (e) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: e.message || String(e) }) });
  }
}
