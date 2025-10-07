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

// netlify/functions/submitComplaint.js
var submitComplaint_exports = {};
__export(submitComplaint_exports, {
  config: () => config,
  handler: () => handler
});
module.exports = __toCommonJS(submitComplaint_exports);
var import_supabase_js = require("@supabase/supabase-js");
var config = { path: "/.netlify/functions/submitComplaint" };
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
var {
  REPO_OWNER,
  REPO_NAME,
  GITHUB_TOKEN,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE,
  SUPABASE_BUCKET
} = process.env;
async function handler(event) {
  if (event.httpMethod === "OPTIONS")
    return cors({ statusCode: 200, body: "" });
  if (event.httpMethod !== "POST")
    return cors({
      statusCode: 405,
      body: JSON.stringify({ error: "Method Not Allowed" })
    });
  if (!REPO_OWNER || !REPO_NAME || !GITHUB_TOKEN) {
    return cors({
      statusCode: 500,
      body: JSON.stringify({ error: "Missing GitHub env vars" })
    });
  }
  try {
    const p0 = JSON.parse(event.body || "{}");
    const p = {
      fullName: (p0.fullName || "").trim(),
      showName: (p0.showName || "").trim(),
      submittedDate: (p0.submittedDate || "").trim(),
      category: (p0.category || "").trim(),
      place: (p0.place || "").trim(),
      summary: (p0.summary || "").trim(),
      proofPath: (p0.proofPath || "").trim(),
      proofUrl: (p0.proofUrl || "").trim()
    };
    const errs = [];
    if (!p.fullName || p.fullName.length < 8)
      errs.push("\u0627\u0644\u0627\u0633\u0645 \u0627\u0644\u0643\u0627\u0645\u0644 \u0645\u0637\u0644\u0648\u0628.");
    if (!p.submittedDate) errs.push("\u062A\u0627\u0631\u064A\u062E \u062A\u0642\u062F\u064A\u0645 \u0627\u0644\u0634\u0643\u0648\u0649 \u0645\u0637\u0644\u0648\u0628.");
    if (!p.category) errs.push("\u0646\u0648\u0639 \u0627\u0644\u0634\u0643\u0648\u0649 \u0645\u0637\u0644\u0648\u0628.");
    if (!p.summary || p.summary.length < 120)
      errs.push("\u0627\u0644\u0645\u0644\u062E\u0635 \u0642\u0635\u064A\u0631 \u062C\u062F\u064B\u0627 (\u2265 120 \u062D\u0631\u0641\u064B\u0627).");
    let proofPath = p.proofPath;
    if (!proofPath && p.proofUrl) {
      const m = p.proofUrl.match(
        /\/object\/sign\/([^/]+)\/(.+?)\?(?:.*)$/
      ) || p.proofUrl.match(
        /\/sign\/([^/]+)\/(.+?)\?(?:.*)$/
        // نمط بديل
      );
      if (m && m[1] && m[2]) {
        if (!SUPABASE_BUCKET || m[1] === SUPABASE_BUCKET) {
          proofPath = decodeURIComponent(m[2]);
        }
      }
    }
    if (!proofPath) errs.push("\u064A\u062C\u0628 \u0631\u0641\u0639 \u0648\u062B\u064A\u0642\u0629/\u0635\u0648\u0631\u0629 \u0627\u0644\u0634\u0643\u0648\u0649 \u0627\u0644\u0645\u0648\u0642\u0651\u0639\u0629.");
    if (errs.length)
      return cors({
        statusCode: 422,
        body: JSON.stringify({ error: errs.join(" ") })
      });
    const showName = p.showName === "yes";
    const title = `\u0634\u0643\u0648\u0649: [${p.category}] ${showName ? p.fullName : "\u0627\u0633\u0645 \u0645\u062D\u0641\u0648\u0638"} \u2014 ${p.submittedDate}`;
    let adminSignedUrl = "";
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE && SUPABASE_BUCKET && proofPath) {
      try {
        const sb = (0, import_supabase_js.createClient)(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
        const { data, error } = await sb.storage.from(SUPABASE_BUCKET).createSignedUrl(proofPath, 60 * 60);
        if (!error) adminSignedUrl = data?.signedUrl || "";
      } catch {
      }
    }
    const proofLines = [
      `> **\u0645\u0633\u0627\u0631 \u0627\u0644\u0648\u062B\u064A\u0642\u0629 (\u062E\u0627\u0635 \u0644\u062F\u0649 \u0627\u0644\u0625\u062F\u0627\u0631\u0629):** ${proofPath}`,
      adminSignedUrl ? `> **\u0631\u0627\u0628\u0637 \u062F\u0627\u062E\u0644\u064A \u0645\u0648\u0642\u0651\u062A (\u0633\u0627\u0639\u0629):** ${adminSignedUrl}` : ""
    ].filter(Boolean).join("\n");
    const body = [
      `**\u0627\u0644\u0646\u0648\u0639:** \u0634\u0643\u0648\u0649`,
      `**\u0627\u0644\u0627\u0633\u0645 \u0627\u0644\u0643\u0627\u0645\u0644 (\u0644\u0644\u0625\u062F\u0627\u0631\u0629):** ${p.fullName}`,
      `**\u0625\u0638\u0647\u0627\u0631 \u0627\u0644\u0627\u0633\u0645 \u0639\u0644\u0646\u064B\u0627\u061F** ${showName ? "\u0646\u0639\u0645" : "\u0644\u0627"}`,
      `**\u062A\u0627\u0631\u064A\u062E \u0627\u0644\u062A\u0642\u062F\u064A\u0645:** ${p.submittedDate}`,
      p.place ? `**\u0627\u0644\u0645\u0643\u0627\u0646/\u0627\u0644\u0645\u062F\u064A\u0646\u0629:** ${p.place}` : "",
      `**\u0645\u0644\u062E\u0635**: ${p.summary}`,
      "",
      proofLines,
      `> *\u062A\u064F\u0646\u0634\u0631 \u0627\u0644\u0634\u0643\u0627\u064A\u0627\u062A \u0628\u0645\u0644\u062E\u0635 \u0641\u0642\u0637\u060C \u0648\u0627\u0644\u0648\u062B\u0627\u0626\u0642 \u0645\u062D\u0641\u0648\u0638\u0629 \u0644\u062F\u0649 \u0627\u0644\u0625\u062F\u0627\u0631\u0629.*`
    ].filter(Boolean).join("\n");
    const labels = ["pending", "type: complaint", `topic: ${p.category}`];
    if (p.place) labels.push(`city: ${p.place}`);
    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ title, body, labels })
      }
    );
    if (!res.ok) {
      const t = await res.text();
      return cors({
        statusCode: 500,
        body: JSON.stringify({ error: `GitHub error: ${t}` })
      });
    }
    const issue = await res.json();
    return cors({
      statusCode: 200,
      body: JSON.stringify({
        number: issue.number,
        html_url: issue.html_url
      })
    });
  } catch (e) {
    console.error("[submitComplaint ERROR]", e);
    return cors({
      statusCode: 500,
      body: JSON.stringify({ error: e.message || String(e) })
    });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  config,
  handler
});
//# sourceMappingURL=submitComplaint.js.map
