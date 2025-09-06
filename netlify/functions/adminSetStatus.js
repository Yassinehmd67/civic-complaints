// netlify/functions/adminSetStatus.js
import bcrypt from "bcryptjs";

export const config = { path: "/.netlify/functions/adminSetStatus" };

function cors(res){
  return {
    ...res,
    headers: {
      "Access-Control-Allow-Origin":"*",
      "Access-Control-Allow-Headers":"Content-Type",
    }
  };
}

const STATE_LABELS = new Set(["pending","approved","rejected","under-review","needs-more-info"]);

export async function handler(event){
  if(event.httpMethod === "OPTIONS") return cors({ statusCode:200, body:"" });
  if(event.httpMethod !== "POST")    return cors({ statusCode:405, body:"Method Not Allowed" });

  const { REPO_OWNER, REPO_NAME, GITHUB_TOKEN, ADMIN_HASH } = process.env;
  if(!REPO_OWNER || !REPO_NAME || !GITHUB_TOKEN || !ADMIN_HASH){
    return cors({ statusCode:500, body:"Server env missing" });
  }

  try{
    const { number, state, password } = JSON.parse(event.body || "{}");
    if(!number || !state || !password) return cors({ statusCode:422, body:"invalid payload" });
    if(!STATE_LABELS.has(state))       return cors({ statusCode:422, body:"invalid state" });

    // تحقق كلمة السر (Bcrypt)
    const ok = await bcrypt.compare(password, ADMIN_HASH);
    if(!ok) return cors({ statusCode:401, body:"كلمة السر غير صحيحة" });

    // اقرأ الـIssue الحالي
    const issueUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues/${number}`;
    const getRes = await fetch(issueUrl, {
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json"
      }
    });
    if(!getRes.ok){
      const t = await getRes.text();
      return cors({ statusCode:404, body:`issue not found: ${t}` });
    }
    const issue = await getRes.json();
    const current = (issue.labels || []).map(l=>l.name);

    // فلترة الوسوم
    const kept = current.filter(l => !STATE_LABELS.has(l));
    const labels = Array.from(new Set([...kept, state]));

    // تحديث الوسوم
    const patchRes = await fetch(issueUrl, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "Content-Type":"application/json"
      },
      body: JSON.stringify({ labels })
    });

    if(!patchRes.ok){
      const t = await patchRes.text();
      return cors({ statusCode:500, body:`update failed: ${t}` });
    }

    return cors({ statusCode:200, body:"ok" });

  }catch(e){
    return cors({ statusCode:500, body:String(e.message || e) });
  }
}
