// netlify/functions/submitComment.js
export const config = { path: "/.netlify/functions/submitComment" };

function cors(res) {
  return { ...res, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" } };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return cors({ statusCode: 200, body: "" });
  if (event.httpMethod !== "POST")  return cors({ statusCode: 405, body: "Method Not Allowed" });

  const { REPO_OWNER, REPO_NAME, GITHUB_TOKEN } = process.env;
  if (!REPO_OWNER || !REPO_NAME || !GITHUB_TOKEN) {
    return cors({ statusCode: 500, body: "Missing server env" });
  }

  try {
    const { issueNumber, fullName, comment } = JSON.parse(event.body || "{}");
    const errs = [];
    if (!issueNumber) errs.push("رقم العنصر مفقود.");
    if (!fullName || fullName.trim().length < 8) errs.push("الاسم الكامل مطلوب.");
    if (!comment || comment.trim().length < 40) errs.push("التعليق قصير (≥ 40 حرفًا).");
    if (errs.length) return cors({ statusCode: 422, body: errs.join(" ") });

    const body = `**الاسم الكامل:** ${fullName}\n\n${comment}\n\n_(بانتظار المراجعة)_`;

    const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues/${issueNumber}/comments`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body })
    });

    if (!res.ok) {
      const t = await res.text();
      return cors({ statusCode: 500, body: `GitHub error: ${t}` });
    }
    return cors({ statusCode: 200, body: "OK" });
  } catch (e) {
    return cors({ statusCode: 500, body: String(e.message || e) });
  }
}
