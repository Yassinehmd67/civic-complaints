// netlify/functions/upvoteIssue.js
export const config = { path: "/.netlify/functions/upvoteIssue" };

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
    const { issueNumber } = JSON.parse(event.body || "{}");
    if (!issueNumber) return cors({ statusCode: 422, body: "issueNumber مطلوب." });

    // Endpoint: Reactions API
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues/${issueNumber}/reactions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json; application/vnd.github.squirrel-girl-preview+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: "+1" })
    });

    // إذا كان لدى نفس الحساب Reaction سابق يرجّع 200/201 أو 200 مع خطأ ثانوي — نتجاهله
    if (!res.ok && res.status !== 200 && res.status !== 201) {
      const t = await res.text();
      return cors({ statusCode: 500, body: `GitHub reaction error: ${t}` });
    }
    return cors({ statusCode: 200, body: "OK" });
  } catch (e) {
    return cors({ statusCode: 500, body: String(e.message || e) });
  }
}
