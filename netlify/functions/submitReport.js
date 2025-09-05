// netlify/functions/submitReport.js
export const config = { path: "/.netlify/functions/submitReport" };

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
    const p = JSON.parse(event.body || "{}");
    const errs = [];
    if (!p.eventDateTime) errs.push("تاريخ/وقت الواقعة مطلوب.");
    if (!p.place)        errs.push("المكان مطلوب.");
    if (!p.category)     errs.push("التصنيف مطلوب.");
    if (!p.body || p.body.trim().length < 120) errs.push("نص التقرير قصير (≥ 120 حرفًا).");
    if (errs.length) return cors({ statusCode: 422, body: errs.join(" ") });

    const title = `[${p.category}] تقرير — ${p.place} — ${p.eventDateTime}`;
    const md = [
      `**النوع:** تقرير`,
      p.fullName ? `**مبلِّغ:** ${p.fullName}` : "",
      `**تاريخ/وقت الواقعة:** ${p.eventDateTime}`,
      `**المكان:** ${p.place}`,
      "",
      p.body,
      "",
      p.evidenceUrl ? `**روابط أدلة:** ${p.evidenceUrl}` : ""
    ].filter(Boolean).join("\n");

    const labels = ["pending", "type: report", `topic: ${p.category}`, `city: ${p.place}`];

    const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, body: md, labels })
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
