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

// netlify/functions/getComment.js
var getComment_exports = {};
__export(getComment_exports, {
  config: () => config,
  handler: () => handler
});
module.exports = __toCommonJS(getComment_exports);
var config = { path: "/.netlify/functions/getComments" };
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
var toJSON = (x) => JSON.stringify(x);
function isPending(body = "") {
  const t = body.replace(/\s+/g, " ").trim();
  return /بانتظار المراجعة/i.test(t);
}
async function handler(event) {
  if (event.httpMethod === "OPTIONS") return cors({ statusCode: 200, body: "" });
  if (event.httpMethod !== "GET") return cors({ statusCode: 405, body: toJSON({ ok: false, error: "Method Not Allowed" }) });
  const { REPO_OWNER, REPO_NAME, GITHUB_TOKEN } = process.env;
  if (!REPO_OWNER || !REPO_NAME || !GITHUB_TOKEN) {
    return cors({ statusCode: 500, body: toJSON({ ok: false, error: "Missing server env" }) });
  }
  try {
    const issue = Number(event.queryStringParameters?.issue);
    if (!Number.isFinite(issue) || issue <= 0) {
      return cors({ statusCode: 422, body: toJSON({ ok: false, error: "invalid issue" }) });
    }
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues/${issue}/comments?per_page=100`;
    const res = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json"
      }
    });
    if (!res.ok) {
      const t = await res.text();
      return cors({ statusCode: res.status, body: toJSON({ ok: false, error: `GitHub error: ${t || res.status}` }) });
    }
    const arr = await res.json();
    const accepted = (arr || []).filter((c) => !isPending(c.body || "")).map((c) => ({
      id: c.id,
      author: c.user?.login || "\u2014",
      avatar: c.user?.avatar_url || "",
      created_at: c.created_at,
      body: c.body || "",
      html_url: c.html_url
    }));
    return cors({ statusCode: 200, body: toJSON({ ok: true, count: accepted.length, comments: accepted }) });
  } catch (e) {
    return cors({ statusCode: 500, body: toJSON({ ok: false, error: e?.message || String(e) }) });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  config,
  handler
});
//# sourceMappingURL=getComment.js.map
