// netlify/functions/upvoteIssue.js
export const config = { path: "/.netlify/functions/upvoteIssue" };

function cors(res) {
  return {
    ...res,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Content-Type": "application/json",
    },
  };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return cors({ statusCode: 200, body: "" });
  if (event.httpMethod !== "POST") {
    return cors({ statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) });
  }

  const { REPO_OWNER, REPO_NAME, GITHUB_TOKEN } = process.env;
  if (!REPO_OWNER || !REPO_NAME || !GITHUB_TOKEN) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: "Missing server env" }) });
  }

  try {
    const { issueNumber } = JSON.parse(event.body || "{}");
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

    // GitHub يرجع:
    // 201 = Reaction مضافة، 200 = Reaction موجودة مسبقًا (لا بأس)، 409 = تعارض (مكررة) → نعتبرها OK
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
