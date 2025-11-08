// netlify/functions/adminSetStatus.js
import bcrypt from "bcryptjs";

export const config = { path: "/.netlify/functions/adminSetStatus" };

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

/* ============== Rate limit + hCaptcha helpers ============== */
const RATE = { windowMs: 60 * 1000, max: 10 };
const memHits = new Map();
function getIp(headers){ return headers["x-nf-client-connection-ip"] || headers["client-ip"] || (headers["x-forwarded-for"]||"").split(",")[0] || "0.0.0.0"; }
function rateLimited(route, headers){ const ip=getIp(headers); const key=`${route}:${ip}`; const now=Date.now(); const rec=memHits.get(key)||{count:0,ts:now}; if(now-rec.ts>RATE.windowMs){rec.count=0;rec.ts=now} rec.count++; memHits.set(key,rec); return rec.count>RATE.max; }
async function verifyHCaptcha(token){ const secret=process.env.HCAPTCHA_SECRET; if(!secret) return {ok:true}; if(!token) return {ok:false,error:"hCaptcha مطلوب"}; try{ const r=await fetch("https://hcaptcha.com/siteverify",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({secret,response:token})}); const d=await r.json(); return {ok:!!d.success,error:d["error-codes"]?.join(", ")||"فشل hCaptcha"} }catch{ return {ok:false,error:"تعذّر التحقق من hCaptcha"} } }
/* ========================================================== */

const STATE_LABELS = new Set(["pending", "approved", "rejected", "under-review", "needs-more-info"]);

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return cors({ statusCode: 200, body: "" });
  if (event.httpMethod !== "POST") {
    return cors({ statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) });
  }

  if (rateLimited("adminSetStatus", event.headers)) {
    return cors({ statusCode: 429, body: JSON.stringify({ error: "الرجاء المحاولة لاحقًا." }) });
  }

  const { REPO_OWNER, REPO_NAME, GITHUB_TOKEN, ADMIN_HASH } = process.env;
  if (!REPO_OWNER || !REPO_NAME || !GITHUB_TOKEN || !ADMIN_HASH) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: "Server env missing" }) });
  }

  try {
    const { number, state, password, hcaptchaToken } = JSON.parse(event.body || "{}");

    const chk = await verifyHCaptcha(hcaptchaToken);
    if (!chk.ok) {
      return cors({ statusCode: 400, body: JSON.stringify({ error: chk.error }) });
    }

    if (!number || !state || !password) {
      return cors({ statusCode: 422, body: JSON.stringify({ error: "invalid payload" }) });
    }
    if (!STATE_LABELS.has(String(state))) {
      return cors({ statusCode: 422, body: JSON.stringify({ error: "invalid state" }) });
    }

    const ok = await bcrypt.compare(String(password), String(ADMIN_HASH));
    if (!ok) {
      return cors({ statusCode: 401, body: JSON.stringify({ error: "كلمة السر غير صحيحة" }) });
    }

    const issueUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues/${number}`;
    const getRes = await fetch(issueUrl, {
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
      },
    });
    if (!getRes.ok) {
      const t = await getRes.text();
      return cors({ statusCode: 404, body: JSON.stringify({ error: `issue not found: ${t}` }) });
    }
    const issue = await getRes.json();
    const current = (issue.labels || []).map((l) => l.name);

    const kept = current.filter((l) => !STATE_LABELS.has(l));
    const labels = Array.from(new Set([...kept, state]));

    const patchRes = await fetch(issueUrl, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ labels }),
    });

    if (!patchRes.ok) {
      const t = await patchRes.text();
      return cors({ statusCode: 500, body: JSON.stringify({ error: `update failed: ${t}` }) });
    }

    return cors({ statusCode: 200, body: JSON.stringify({ ok: true }) });
  } catch (e) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: e.message || String(e) }) });
  }
}