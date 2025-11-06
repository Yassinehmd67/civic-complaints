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

// netlify/functions/submitComment.js
var submitComment_exports = {};
__export(submitComment_exports, {
  config: () => config,
  handler: () => handler
});
module.exports = __toCommonJS(submitComment_exports);
var config = { path: "/.netlify/functions/submitComment" };
function cors(res) {
  return { ...res, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" } };
}
async function handler(event) {
  if (event.httpMethod === "OPTIONS") return cors({ statusCode: 200, body: "" });
  if (event.httpMethod !== "POST") return cors({ statusCode: 405, body: "Method Not Allowed" });
  const { REPO_OWNER, REPO_NAME, GITHUB_TOKEN } = process.env;
  if (!REPO_OWNER || !REPO_NAME || !GITHUB_TOKEN) {
    return cors({ statusCode: 500, body: "Missing server env" });
  }
  try {
    const { issueNumber, fullName, comment } = JSON.parse(event.body || "{}");
    const errs = [];
    if (!issueNumber) errs.push("\u0631\u0642\u0645 \u0627\u0644\u0639\u0646\u0635\u0631 \u0645\u0641\u0642\u0648\u062F.");
    if (!fullName || fullName.trim().length < 8) errs.push("\u0627\u0644\u0627\u0633\u0645 \u0627\u0644\u0643\u0627\u0645\u0644 \u0645\u0637\u0644\u0648\u0628.");
    if (!comment || comment.trim().length < 40) errs.push("\u0627\u0644\u062A\u0639\u0644\u064A\u0642 \u0642\u0635\u064A\u0631 (\u2265 40 \u062D\u0631\u0641\u064B\u0627).");
    if (errs.length) return cors({ statusCode: 422, body: errs.join(" ") });
    const body = `**\u0627\u0644\u0627\u0633\u0645 \u0627\u0644\u0643\u0627\u0645\u0644:** ${fullName}

${comment}

_(\u0628\u0627\u0646\u062A\u0638\u0627\u0631 \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629)_`;
    const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues/${issueNumber}/comments`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json"
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  config,
  handler
});
//# sourceMappingURL=submitComment.js.map
