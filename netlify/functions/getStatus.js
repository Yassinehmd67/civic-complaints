// netlify/functions/getStatus.js
export const config = { path: "/.netlify/functions/getStatus" };

function cors(res){
  return { ...res, headers: { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"Content-Type" } };
}

function labelVal(labels, prefix){
  const l = (labels||[]).find(x => (x.name||"").startsWith(prefix));
  return l ? (l.name.split(":")[1]||"").trim() : "";
}

export async function handler(event){
  if(event.httpMethod === "OPTIONS") return cors({ statusCode:200, body:"" });
  if(event.httpMethod !== "GET")     return cors({ statusCode:405, body:"Method Not Allowed" });

  const { REPO_OWNER, REPO_NAME, GITHUB_TOKEN } = process.env;
  if(!REPO_OWNER || !REPO_NAME || !GITHUB_TOKEN){
    return cors({ statusCode:500, body:"Missing server env" });
  }

  try{
    const num = Number(new URLSearchParams(event.queryStringParameters).get("number"));
    if(!num) return cors({ statusCode:422, body:"invalid number" });

    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues/${num}`;
    const res = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json"
      }
    });
    if(!res.ok){
      const t = await res.text();
      return cors({ statusCode:404, body:`not found: ${t}` });
    }
    const issue = await res.json();

    // استخراج معلومات للعرض
    const labels = issue.labels || [];
    const type = labelVal(labels, "type:");
    const topic = labelVal(labels, "topic:");
    const city  = labelVal(labels, "city:");

    // للشكوى نعرض الملخّص فقط، للتقرير نعرض مقتطفًا
    const body = issue.body || "";
    let display = "";
    if(type === "complaint"){
      const line = (body.split("\n").find(l => l.startsWith("**ملخص**:")) || "");
      display = (line.replace("**ملخص**:","").trim()) || "—";
    }else{
      display = body.replace(/\r?\n/g," ").slice(0,240) + (body.length>240?"…":"");
    }

    const payload = {
      number: issue.number,
      title: issue.title,
      html_url: issue.html_url,
      created_at: issue.created_at,
      labels: labels.map(l=>({ name: l.name })),
      type, topic, city,
      display
    };
    return cors({ statusCode:200, body: JSON.stringify(payload) });
  }catch(e){
    return cors({ statusCode:500, body:String(e.message || e) });
  }
}
