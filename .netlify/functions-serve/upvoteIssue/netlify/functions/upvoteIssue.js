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

// netlify/functions/upvoteIssue.js
var upvoteIssue_exports = {};
__export(upvoteIssue_exports, {
  config: () => config,
  handler: () => handler
});
module.exports = __toCommonJS(upvoteIssue_exports);
var config = { path: "/.netlify/functions/upvoteIssue" };
function cors(res) {
  return {
    ...res,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Content-Type": "application/json"
    }
  };
}
async function handler(event) {
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
      return cors({ statusCode: 422, body: JSON.stringify({ error: "issueNumber \u0645\u0637\u0644\u0648\u0628." }) });
    }
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues/${issueNumber}/reactions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json, application/vnd.github.squirrel-girl-preview+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content: "+1" })
    });
    if ([200, 201, 409].includes(res.status)) {
      return cors({ statusCode: 200, body: JSON.stringify({ ok: true }) });
    }
    const text = await res.text();
    return cors({
      statusCode: res.status,
      body: JSON.stringify({ error: `GitHub reaction error: ${text}` })
    });
  } catch (e) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: e.message || String(e) }) });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  config,
  handler
});
//# sourceMappingURL=upvoteIssue.js.map
