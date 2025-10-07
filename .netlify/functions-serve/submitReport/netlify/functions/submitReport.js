var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// netlify/functions/submitReport.js
var submitReport_exports = {};
__export(submitReport_exports, {
  config: () => config,
  handler: () => handler
});
module.exports = __toCommonJS(submitReport_exports);
var config = { path: "/.netlify/functions/submitReport" };
function cors(res) {
  return {
    ...res,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Content-Type": "application/json"
    }
  };
}
async function handler(event) {
  if (event.httpMethod === "OPTIONS") return cors({ statusCode: 200, body: "" });
  if (event.httpMethod !== "POST") return cors({ statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) });
  const { REPO_OWNER, REPO_NAME, GITHUB_TOKEN } = process.env;
  if (!REPO_OWNER || !REPO_NAME || !GITHUB_TOKEN) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: "Missing server env" }) });
  }
  try {
    const p0 = JSON.parse(event.body || "{}");
    const p = {
      fullName: (p0.fullName || "").trim(),
      eventDateTime: (p0.eventDateTime || "").trim(),
      place: (p0.place || "").trim(),
      category: (p0.category || "").trim(),
      body: (p0.body || "").trim(),
      evidenceUrl: (p0.evidenceUrl || "").trim()
    };
    const errs = [];
    if (!p.eventDateTime) errs.push("\u062A\u0627\u0631\u064A\u062E/\u0648\u0642\u062A \u0627\u0644\u0648\u0627\u0642\u0639\u0629 \u0645\u0637\u0644\u0648\u0628.");
    if (!p.place) errs.push("\u0627\u0644\u0645\u0643\u0627\u0646 \u0645\u0637\u0644\u0648\u0628.");
    if (!p.category) errs.push("\u0627\u0644\u062A\u0635\u0646\u064A\u0641 \u0645\u0637\u0644\u0648\u0628.");
    if (!p.body || p.body.length < 120) errs.push("\u0646\u0635 \u0627\u0644\u062A\u0642\u0631\u064A\u0631 \u0642\u0635\u064A\u0631 (\u2265 120 \u062D\u0631\u0641\u064B\u0627).");
    if (errs.length) return cors({ statusCode: 422, body: JSON.stringify({ error: errs.join(" ") }) });
    let evidenceBlock = "";
    if (p.evidenceUrl) {
      const links = p.evidenceUrl.split(",").map((s) => s.trim()).filter(Boolean);
      if (links.length === 1) {
        evidenceBlock = `**\u0631\u0648\u0627\u0628\u0637 \u0623\u062F\u0644\u0629:** ${links[0]}`;
      } else if (links.length > 1) {
        evidenceBlock = `**\u0631\u0648\u0627\u0628\u0637 \u0623\u062F\u0644\u0629:**
${links.map((u) => `- ${u}`).join("\n")}`;
      }
    }
    const title = `\u062A\u0642\u0631\u064A\u0631: [${p.category}] \u2014 ${p.place} \u2014 ${p.eventDateTime}`;
    const md = [
      `**\u0627\u0644\u0646\u0648\u0639:** \u062A\u0642\u0631\u064A\u0631`,
      p.fullName ? `**\u0645\u0628\u0644\u0651\u0650\u063A:** ${p.fullName}` : "",
      `**\u062A\u0627\u0631\u064A\u062E/\u0648\u0642\u062A \u0627\u0644\u0648\u0627\u0642\u0639\u0629:** ${p.eventDateTime}`,
      `**\u0627\u0644\u0645\u0643\u0627\u0646:** ${p.place}`,
      "",
      p.body,
      "",
      evidenceBlock
    ].filter(Boolean).join("\n");
    const labels = ["pending", "type: report", `topic: ${p.category}`];
    if (p.place) labels.push(`city: ${p.place}`);
    const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ title, body: md, labels })
    });
    if (!res.ok) {
      const t = await res.text();
      return cors({ statusCode: 500, body: JSON.stringify({ error: `GitHub error: ${t}` }) });
    }
    const issue = await res.json();
    return cors({
      statusCode: 200,
      body: JSON.stringify({ number: issue.number, html_url: issue.html_url })
    });
  } catch (e) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: String(e.message || e) }) });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  config,
  handler
});
//# sourceMappingURL=submitReport.js.map
