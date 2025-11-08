// netlify/functions/listApproved.js
export const config = { path: "/.netlify/functions/listApproved" };

function cors(res) {
  return {
    ...res,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60",
    },
  };
}

const { REPO_OWNER, REPO_NAME, GITHUB_TOKEN, ORIGIN_WHITELIST } = process.env;

/* ========= تبطيء بسيط لكل IP ========= */
const RL_WINDOW_MS = 5 * 60 * 1000; // 5 دقائق
const RL_LIMIT = 180;               // 180 طلبًا لكل 5 دقائق
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

// كاش في الذاكرة (حي طالما لم يحدث cold start)
const memCache = new Map(); // key -> { etag, data, ts }

function buildKey(q) {
  // مفاتيح الكاش تتضمن كل بارامترات الفلترة
  return JSON.stringify({
    owner: REPO_OWNER, repo: REPO_NAME,
    type: q.type || "", topic: q.topic || "", city: q.city || "",
  });
}

function mapIssue(i) {
  return {
    number: i.number,
    title: i.title,
    html_url: i.html_url,
    created_at: i.created_at,
    labels: (i.labels || []).map(l => ({ name: l.name })),
    body: i.body || "",
    comments: i.comments ?? 0,
    reactions: typeof i.reactions?.["+1"] === "number" ? i.reactions["+1"] : (i.reactions?.total_count ?? 0),
  };
}

async function fetchAllApproved(q, etag) {
  const headers = {
    "Accept": "application/vnd.github+json, application/vnd.github.squirrel-girl-preview+json",
    "Authorization": `Bearer ${GITHUB_TOKEN}`,
  };
  if (etag) headers["If-None-Match"] = etag;

  let page = 1;
  const per_page = 100;
  const items = [];
  let newEtag = etag;

  while (true) {
    const url = new URL(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues`);
    url.searchParams.set("state", "open");
    url.searchParams.set("labels", "approved");
    url.searchParams.set("per_page", String(per_page));
    url.searchParams.set("page", String(page));

    const res = await fetch(url.toString(), { headers });
    if (res.status === 304) {
      // لم تتغير — سنستخدم الكاش لاحقًا خارج هذه الدالة
      return { notModified: true, etag: etag, items: null };
    }
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`GitHub error (${res.status}): ${t}`);
    }

    // حدّث الـETag من أول صفحة (عادةً)
    if (page === 1) {
      const resEtag = res.headers.get("ETag");
      if (resEtag) newEtag = resEtag;
    }

    const batch = (await res.json()).filter(i => !i.pull_request);
    items.push(...batch);
    if (batch.length < per_page) break;
    page += 1;
  }
  return { notModified: false, etag: newEtag, items };
}

function matchesFilters(issue, q) {
  const labels = issue.labels || [];
  const get = (pfx) => {
    const L = labels.find(l => (l.name || "").startsWith(pfx));
    return L ? (L.name.split(":")[1] || "").trim() : "";
  };
  const type = get("type:");
  const topic = get("topic:");
  const city  = get("city:");

  if (q.type && type !== q.type) return false;
  if (q.topic && topic !== q.topic) return false;
  if (q.city  && city  !== q.city ) return false;
  return true;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return cors({ statusCode: 200, body: "" });
  if (event.httpMethod !== "GET") return cors({ statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) });

  // فحص Origin (اختياري)
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

  if (!REPO_OWNER || !REPO_NAME || !GITHUB_TOKEN) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: "Missing server env" }) });
  }

  try {
    const q = {
      type: event.queryStringParameters?.type || "",      // "complaint" | "report"
      topic: event.queryStringParameters?.topic || "",    // يطابق label "topic: ... "
      city:  event.queryStringParameters?.city  || "",    // يطابق label "city: ... "
    };
    const nocache = event.queryStringParameters?.nocache === "1";
    const key = buildKey(q);
    const cached = memCache.get(key);
    const etag = !nocache ? (cached?.etag) : undefined;

    const { notModified, etag: newEtag, items } = await fetchAllApproved(q, etag);

    if (!nocache && notModified && cached?.data) {
      return cors({ statusCode: 200, body: JSON.stringify(cached.data) });
    }

    const filtered = (items || []).filter(i => matchesFilters(i, q));
    const mapped = filtered.map(mapIssue);

    const payload = { ok: true, count: mapped.length, items: mapped, updatedAt: Date.now() };
    memCache.set(key, { etag: newEtag, data: payload, ts: Date.now() });

    return cors({ statusCode: 200, body: JSON.stringify(payload) });
  } catch (e) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: e.message || String(e) }) });
  }
}
