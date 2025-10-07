var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// netlify/functions/adminSetStatus.js
var adminSetStatus_exports = {};
__export(adminSetStatus_exports, {
  config: () => config,
  handler: () => handler
});
module.exports = __toCommonJS(adminSetStatus_exports);
var import_bcryptjs = __toESM(require("bcryptjs"), 1);
var config = { path: "/.netlify/functions/adminSetStatus" };
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
var STATE_LABELS = /* @__PURE__ */ new Set(["pending", "approved", "rejected", "under-review", "needs-more-info"]);
async function handler(event) {
  if (event.httpMethod === "OPTIONS") return cors({ statusCode: 200, body: "" });
  if (event.httpMethod !== "POST") {
    return cors({ statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) });
  }
  const { REPO_OWNER, REPO_NAME, GITHUB_TOKEN, ADMIN_HASH } = process.env;
  if (!REPO_OWNER || !REPO_NAME || !GITHUB_TOKEN || !ADMIN_HASH) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: "Server env missing" }) });
  }
  try {
    const { number, state, password } = JSON.parse(event.body || "{}");
    if (!number || !state || !password) {
      return cors({ statusCode: 422, body: JSON.stringify({ error: "invalid payload" }) });
    }
    if (!STATE_LABELS.has(String(state))) {
      return cors({ statusCode: 422, body: JSON.stringify({ error: "invalid state" }) });
    }
    const ok = await import_bcryptjs.default.compare(String(password), String(ADMIN_HASH));
    if (!ok) {
      return cors({ statusCode: 401, body: JSON.stringify({ error: "\u0643\u0644\u0645\u0629 \u0627\u0644\u0633\u0631 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u0629" }) });
    }
    const issueUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues/${number}`;
    const getRes = await fetch(issueUrl, {
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json"
      }
    });
    if (!getRes.ok) {
      const t = await getRes.text();
      return cors({ statusCode: 404, body: JSON.stringify({ error: `issue not found: ${t}` }) });
    }
    const issue = await getRes.json();
    const current = (issue.labels || []).map((l) => l.name);
    const kept = current.filter((l) => !STATE_LABELS.has(l));
    const labels = Array.from(/* @__PURE__ */ new Set([...kept, state]));
    const patchRes = await fetch(issueUrl, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ labels })
    });
    if (!patchRes.ok) {
      const t = await patchRes.text();
      return cors({ statusCode: 500, body: JSON.stringify({ error: `update failed: ${t}` }) });
    }
    return cors({ statusCode: 200, body: JSON.stringify({ ok: true }) });
  } catch (e) {
    return cors({ statusCode: 500, body: JSON.stringify({ error: e.message || String(e) }) });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  config,
  handler
});
//# sourceMappingURL=adminSetStatus.js.map
