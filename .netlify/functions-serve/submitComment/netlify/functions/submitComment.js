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
var toJSON = (o) => JSON.stringify(o);
function clean(s = "") {
  return String(s).replace(/\s+/g, " ").trim();
}
async function handler(event) {
  if (event.httpMethod === "OPTIONS") return cors({ statusCode: 200, body: "" });
  if (event.httpMethod !== "POST") {
    return cors({ statusCode: 405, body: toJSON({ ok: false, error: "Method Not Allowed" }) });
  }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    return cors({ statusCode: 500, body: toJSON({ ok: false, error: "Missing Supabase env vars" }) });
  }
  try {
    const payload = JSON.parse(event.body || "{}");
    let { issueNumber, fullName, comment } = payload;
    issueNumber = Number(issueNumber);
    fullName = clean(fullName);
    comment = clean(comment);
    const errs = [];
    if (!Number.isFinite(issueNumber) || issueNumber <= 0) errs.push("\u0631\u0642\u0645 \u0627\u0644\u0645\u0644\u0641 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D.");
    if (!fullName || fullName.length < 8 || fullName.length > 80) errs.push("\u0627\u0644\u0627\u0633\u0645 \u0627\u0644\u0643\u0627\u0645\u0644 \u0645\u0637\u0644\u0648\u0628 (8\u201380 \u062D\u0631\u0641\u064B\u0627).");
    if (!comment || comment.length < 40) errs.push("\u0627\u0644\u062A\u0639\u0644\u064A\u0642 \u0642\u0635\u064A\u0631 \u062C\u062F\u064B\u0627. \u0627\u0644\u062D\u062F \u0627\u0644\u0623\u062F\u0646\u0649 40 \u062D\u0631\u0641\u064B\u0627.");
    if (comment.length > 2e3) errs.push("\u0627\u0644\u062A\u0639\u0644\u064A\u0642 \u0637\u0648\u064A\u0644 \u062C\u062F\u064B\u0627. \u0627\u0644\u062D\u062F \u0627\u0644\u0623\u0642\u0635\u0649 2000 \u062D\u0631\u0641.");
    if (errs.length) {
      return cors({ statusCode: 422, body: toJSON({ ok: false, error: errs.join(" ") }) });
    }
    const insertRow = {
      issue_number: issueNumber,
      full_name: fullName,
      comment
    };
    const url = `${SUPABASE_URL}/rest/v1/pending_comments`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify(insertRow)
    });
    if (!res.ok) {
      const text = await res.text();
      return cors({
        statusCode: 500,
        body: toJSON({ ok: false, error: `Supabase error: ${text || res.status}` })
      });
    }
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    return cors({
      statusCode: 200,
      body: toJSON({
        ok: true,
        id: row?.id || null,
        message: "\u062A\u0645 \u0627\u0633\u062A\u0644\u0627\u0645 \u0627\u0644\u062A\u0639\u0644\u064A\u0642 \u0648\u064A\u062D\u062A\u0627\u062C \u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u0645\u062F\u064A\u0631 \u0642\u0628\u0644 \u0627\u0644\u0646\u0634\u0631."
      })
    });
  } catch (e) {
    return cors({
      statusCode: 500,
      body: toJSON({ ok: false, error: e?.message || String(e) })
    });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  config,
  handler
});
//# sourceMappingURL=submitComment.js.map
