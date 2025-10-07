// netlify/functions/getComments.js
export const config = { path: "/.netlify/functions/getComments" };

function cors(res){
  return {
    ...res,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Content-Type": "application/json",
    },
  };
}

const toJSON = (x) => JSON.stringify(x);

function isPending(body=""){
  // أي تعليق مُرسل عبر submitComment كانت نهايته غالبًا "بانتظار المراجعة"
  const t = body.replace(/\s+/g," ").trim();
  return /بانتظار المراجعة/i.test(t);
}

export async function handler(event){
  if (event.httpMethod === "OPTIONS") return cors({ statusCode: 200, body: "" });
  if (event.httpMethod !== "GET") return cors({ statusCode: 405, body: toJSON({ ok:false, error:"Method Not Allowed" }) });

  const { REPO_OWNER, REPO_NAME, GITHUB_TOKEN } = process.env;
  if(!REPO_OWNER || !REPO_NAME || !GITHUB_TOKEN){
    return cors({ statusCode: 500, body: toJSON({ ok:false, error:"Missing server env" }) });
  }

  try{
    const issue = Number(event.queryStringParameters?.issue);
    if(!Number.isFinite(issue) || issue <= 0){
      return cors({ statusCode: 422, body: toJSON({ ok:false, error:"invalid issue" }) });
    }

    // جلب التعليقات من GitHub
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues/${issue}/comments?per_page=100`;
    const res = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
      }
    });
    if(!res.ok){
      const t = await res.text();
      return cors({ statusCode: res.status, body: toJSON({ ok:false, error:`GitHub error: ${t || res.status}` }) });
    }
    const arr = await res.json();

    // فلترة: استبعد “بانتظار المراجعة”
    const accepted = (arr || []).filter(c => !isPending(c.body || "")).map(c => ({
      id: c.id,
      author: c.user?.login || "—",
      avatar: c.user?.avatar_url || "",
      created_at: c.created_at,
      body: c.body || "",
      html_url: c.html_url
    }));

    return cors({ statusCode: 200, body: toJSON({ ok:true, count: accepted.length, comments: accepted }) });
  }catch(e){
    return cors({ statusCode: 500, body: toJSON({ ok:false, error: e?.message || String(e) }) });
  }
}
