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

// netlify/functions/getStatus.js
var getStatus_exports = {};
__export(getStatus_exports, {
  config: () => config,
  handler: () => handler
});
module.exports = __toCommonJS(getStatus_exports);
var config = { path: "/.netlify/functions/getStatus" };
function cors(res) {
  return {
    ...res,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Content-Type": "application/json"
    }
  };
}
function labelVal(labels, prefix) {
  const l = (labels || []).find((x) => (x.name || "").startsWith(prefix));
  return l ? (l.name.split(":")[1] || "").trim() : "";
}
async function handler(event) {
  if (event.httpMethod === "OPTIONS") return cors({ statusCode: 200, body: "" });
  if (event.httpMethod !== "GET") {
    return cors({ statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) });
  }
  const { REPO_OWNER, REPO_NAME, GITHUB_TOKEN } = process.env;
  if (!REPO_OWNER || !REPO_NAME || !GITHUB_TOKEN) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: "Missing server env" }) });
  }
  try {
    const numRaw = event.queryStringParameters?.number;
    const num = Number(numRaw);
    if (!num || !Number.isFinite(num) || num <= 0) {
      return cors({ statusCode: 422, body: JSON.stringify({ error: "invalid number" }) });
    }
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues/${num}`;
    const res = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json, application/vnd.github.squirrel-girl-preview+json"
      }
    });
    if (!res.ok) {
      const t = await res.text();
      return cors({ statusCode: res.status === 404 ? 404 : 500, body: JSON.stringify({ error: t || "not found" }) });
    }
    const issue = await res.json();
    const labels = issue.labels || [];
    const type = labelVal(labels, "type:");
    const topic = labelVal(labels, "topic:");
    const city = labelVal(labels, "city:");
    const body = issue.body || "";
    let display = "";
    if (type === "complaint") {
      const line = body.split("\n").find((l) => l.startsWith("**\u0645\u0644\u062E\u0635**:")) || "";
      display = line.replace("**\u0645\u0644\u062E\u0635**:", "").trim() || "\u2014";
    } else {
      display = body.replace(/\r?\n/g, " ").slice(0, 240) + (body.length > 240 ? "\u2026" : "");
    }
    const comments = issue.comments ?? 0;
    const reactions = typeof issue.reactions?.["+1"] === "number" ? issue.reactions["+1"] : issue.reactions?.total_count ?? 0;
    const payload = {
      number: issue.number,
      title: issue.title,
      html_url: issue.html_url,
      created_at: issue.created_at,
      labels: labels.map((l) => ({ name: l.name })),
      type,
      topic,
      city,
      display,
      comments,
      reactions
    };
    return cors({ statusCode: 200, body: JSON.stringify(payload) });
  } catch (e) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: e.message || String(e) }) });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  config,
  handler
});
//# sourceMappingURL=getStatus.js.map
