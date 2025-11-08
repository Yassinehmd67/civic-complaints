// netlify/functions/getStatus.js
export const config = { path: "/.netlify/functions/getStatus" };

function cors(res) {
  return {
    ...res,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Content-Type": "application/json",
      // كاش متصفّح بسيط (30 ثانية)
      "Cache-Control": "public, max-age=30",
    },
  };
}

function labelVal(labels, prefix) {
  const l = (labels || []).find((x) => (x.name || "").startsWith(prefix));
  return l ? (l.name.split(":")[1] || "").trim() : "";
}

/* ========= تبطيء بسيط لكل IP ========= */
const RL_WINDOW_MS = 5 * 60 * 1000; // 5 دقائق
const RL_LIMIT = 120;               // 120 طلبًا لكل 5 دقائق
const rlMap = new Map();            // ip -> [timestamps]
function rateHit(ip) {
  const now = Date.now();
  const arr = (rlMap.get(ip) || []).filter((t) => now - t < RL_WINDOW_MS);
  arr.push(now);
  rlMap.set(ip, arr);
  return arr.length;
}

/* ========= تحقّق Origin (اختياري) ========= */
const { ORIGIN_WHITELIST } = process.env;
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

/* ========= كاش داخلي + ETag مع GitHub ========= */
const memCache = new Map(); // key -> { etag, data, ts }
const CACHE_TTL_MS = 2 * 60 * 1000; // دقيقتان

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return cors({ statusCode: 200, body: "" });
  if (event.httpMethod !== "GET") {
    return cors({ statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) });
  }

  // فحص Origin اختياري
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

  const { REPO_OWNER, REPO_NAME, GITHUB_TOKEN } = process.env;
  if (!REPO_OWNER || !REPO_NAME || !GITHUB_TOKEN) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: "Missing server env" }) });
  }

  try {
    const numRaw = event.queryStringParameters?.number;
    const num = Number(numRaw);
    if (!num || !Number.isFinite(num) || num <= 0) {
      return cors({ statusCode: 422, body: JSON.stringify({ error: "invalid number" }) });
    }

    const nocache = event.queryStringParameters?.nocache === "1";
    const key = String(num);
    const now = Date.now();
    const cached = memCache.get(key);

    // إذا لدينا كاش حديث ولم يطلب العميل تجاوزه
    if (!nocache && cached && now - cached.ts < CACHE_TTL_MS && cached.data) {
      return cors({ statusCode: 200, body: JSON.stringify(cached.data) });
    }

    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues/${num}`;
    const headers = {
      "Authorization": `Bearer ${GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json, application/vnd.github.squirrel-girl-preview+json",
    };
    if (!nocache && cached?.etag) headers["If-None-Match"] = cached.etag;

    const res = await fetch(url, { headers });

    // 304 = لم يتغير على GitHub → أعِد الكاش إن توفر
    if (res.status === 304 && cached?.data) {
      cached.ts = now; // جدّد الطابع الزمني
      memCache.set(key, cached);
      return cors({ statusCode: 200, body: JSON.stringify(cached.data) });
    }

    if (!res.ok) {
      const t = await res.text();
      return cors({
        statusCode: res.status === 404 ? 404 : 500,
        body: JSON.stringify({ error: t || "not found" }),
      });
    }

    const issue = await res.json();

    // استخراج معلومات للعرض
    const labels = issue.labels || [];
    const type = labelVal(labels, "type:");
    const topic = labelVal(labels, "topic:");
    const city  = labelVal(labels, "city:");

    // للشكوى نعرض الملخص فقط؛ للتقرير مقتطف
    const body = issue.body || "";
    let display = "";
    if (type === "complaint") {
      const line = (body.split("\n").find((l) => l.startsWith("**ملخص**:")) || "");
      display = (line.replace("**ملخص**:", "").trim()) || "—";
    } else {
      const flat = body.replace(/\r?\n/g, " ");
      display = flat.slice(0, 240) + (flat.length > 240 ? "…" : "");
    }

    // معلومات إضافية اختيارية
    const comments = issue.comments ?? 0;
    const reactions = typeof issue.reactions?.["+1"] === "number"
      ? issue.reactions["+1"]
      : (issue.reactions?.total_count ?? 0);

    const payload = {
      number: issue.number,
      title: issue.title,
      html_url: issue.html_url,
      created_at: issue.created_at,
      labels: labels.map((l) => ({ name: l.name })),
      type, topic, city,
      display,
      comments,
      reactions,
    };

    // خزّن في الكاش مع ETag
    const etag = res.headers.get("ETag") || null;
    memCache.set(key, { etag, data: payload, ts: now });

    return cors({ statusCode: 200, body: JSON.stringify(payload) });
  } catch (e) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: e.message || String(e) }) });
  }
}
