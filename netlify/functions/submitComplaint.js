// netlify/functions/submitComplaint.js
export const config = { path: "/.netlify/functions/submitComplaint" };

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
    const payload = JSON.parse(event.body || "{}");
    const errs = [];
    if (!payload.fullName || payload.fullName.trim().length < 8) errs.push("الاسم الكامل مطلوب.");
    if (!payload.submittedDate) errs.push("تاريخ تقديم الشكوى مطلوب.");
    if (!payload.category) errs.push("نوع الشكوى مطلوب.");
    if (!payload.summary || payload.summary.trim().length < 120) errs.push("الملخص قصير جدًا (≥ 120 حرفًا).");
    if (!payload.proofUrl) errs.push("يجب رفع وثيقة/صورة الشكوى الموقّعة.");
    if (errs.length) return cors({ statusCode: 422, body: errs.join(" ") });

    const showName = payload.showName === "yes";
    const title = `[${payload.category}] ${showName ? payload.fullName : "اسم محفوظ"} — ${payload.submittedDate}`;
    const body = [
      `**النوع:** شكوى`,
      `**الاسم الكامل (للإدارة):** ${payload.fullName}`,
      `**إظهار الاسم علنًا؟** ${showName ? "نعم" : "لا"}`,
      `**تاريخ التقديم:** ${payload.submittedDate}`,
      payload.place ? `**المكان/المدينة:** ${payload.place}` : "",
      `**ملخص**: ${payload.summary}`,
      "",
      `> **رابط الوثيقة/الصورة الموقّعة (خاص/موقّت):** ${payload.proofUrl}`,
      `> *تُنشر الشكايات بملخص فقط، والوثائق محفوظة لدى الإدارة.*`
    ].filter(Boolean).join("\n");

    // وسوم
    const labels = ["pending", "type: complaint", `topic: ${payload.category}`];
    if (payload.place) labels.push(`city: ${payload.place}`);

    const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, body, labels })
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
