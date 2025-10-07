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

// netlify/functions/moderateComment.js
var moderateComment_exports = {};
__export(moderateComment_exports, {
  config: () => config,
  handler: () => handler
});
module.exports = __toCommonJS(moderateComment_exports);
var import_bcryptjs = __toESM(require("bcryptjs"), 1);
var config = { path: "/.netlify/functions/moderateComment" };
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
async function handler(event) {
  if (event.httpMethod === "OPTIONS") return cors({ statusCode: 200, body: "" });
  if (event.httpMethod !== "POST") return cors({ statusCode: 405, body: toJSON({ ok: false, error: "Method Not Allowed" }) });
  const {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE,
    REPO_OWNER,
    REPO_NAME,
    GITHUB_TOKEN,
    ADMIN_HASH
  } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    return cors({ statusCode: 500, body: toJSON({ ok: false, error: "Missing Supabase env vars" }) });
  }
  if (!REPO_OWNER || !REPO_NAME || !GITHUB_TOKEN) {
    return cors({ statusCode: 500, body: toJSON({ ok: false, error: "Missing GitHub env vars" }) });
  }
  if (!ADMIN_HASH) {
    return cors({ statusCode: 500, body: toJSON({ ok: false, error: "Missing ADMIN_HASH" }) });
  }
  try {
    const { id, action, password } = JSON.parse(event.body || "{}");
    if (!id || !action || !password) {
      return cors({ statusCode: 422, body: toJSON({ ok: false, error: "\u0628\u064A\u0627\u0646\u0627\u062A \u0646\u0627\u0642\u0635\u0629." }) });
    }
    const passOk = await import_bcryptjs.default.compare(password, ADMIN_HASH);
    if (!passOk) return cors({ statusCode: 401, body: toJSON({ ok: false, error: "\u0643\u0644\u0645\u0629 \u0627\u0644\u0633\u0631 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u0629." }) });
    const getUrl = new URL(`${SUPABASE_URL}/rest/v1/pending_comments`);
    getUrl.searchParams.set("id", `eq.${id}`);
    getUrl.searchParams.set("select", "id,issue_number,full_name,comment,created_at");
    const getRes = await fetch(getUrl, {
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE}`,
        "Accept": "application/json"
      }
    });
    if (!getRes.ok) {
      const t = await getRes.text();
      return cors({ statusCode: 500, body: toJSON({ ok: false, error: `Supabase error: ${t || getRes.status}` }) });
    }
    const rows = await getRes.json();
    const row = rows?.[0];
    if (!row) return cors({ statusCode: 404, body: toJSON({ ok: false, error: "\u0627\u0644\u062A\u0639\u0644\u064A\u0642 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F" }) });
    if (action === "reject") {
      const delUrl = new URL(`${SUPABASE_URL}/rest/v1/pending_comments`);
      delUrl.searchParams.set("id", `eq.${id}`);
      const delRes = await fetch(delUrl, {
        method: "DELETE",
        headers: {
          "apikey": SUPABASE_SERVICE_ROLE,
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE}`
        }
      });
      if (!delRes.ok) {
        const t = await delRes.text();
        return cors({ statusCode: 500, body: toJSON({ ok: false, error: `Supabase delete error: ${t || delRes.status}` }) });
      }
      return cors({ statusCode: 200, body: toJSON({ ok: true, action: "rejected" }) });
    }
    if (action === "approve") {
      const ghBody = `**\u0627\u0644\u0627\u0633\u0645 \u0627\u0644\u0643\u0627\u0645\u0644:** ${row.full_name}

${row.comment}

_(\u0645\u0642\u0628\u0648\u0644 \u0645\u0646 \u0627\u0644\u0625\u062F\u0627\u0631\u0629)_`;
      const ghUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues/${row.issue_number}/comments`;
      const ghRes = await fetch(ghUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GITHUB_TOKEN}`,
          "Accept": "application/vnd.github+json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ body: ghBody })
      });
      if (!ghRes.ok) {
        const t = await ghRes.text();
        return cors({ statusCode: 500, body: toJSON({ ok: false, error: `GitHub error: ${t || ghRes.status}` }) });
      }
      const ghData = await ghRes.json();
      const delUrl = new URL(`${SUPABASE_URL}/rest/v1/pending_comments`);
      delUrl.searchParams.set("id", `eq.${id}`);
      const delRes = await fetch(delUrl, {
        method: "DELETE",
        headers: {
          "apikey": SUPABASE_SERVICE_ROLE,
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE}`
        }
      });
      if (!delRes.ok) {
        const t = await delRes.text();
        return cors({ statusCode: 500, body: toJSON({ ok: false, error: `Supabase delete error: ${t || delRes.status}` }) });
      }
      return cors({ statusCode: 200, body: toJSON({ ok: true, action: "approved", github_comment_id: ghData?.id }) });
    }
    return cors({ statusCode: 422, body: toJSON({ ok: false, error: "\u0625\u062C\u0631\u0627\u0621 \u063A\u064A\u0631 \u0645\u0639\u0631\u0648\u0641" }) });
  } catch (e) {
    return cors({ statusCode: 500, body: toJSON({ ok: false, error: e?.message || String(e) }) });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  config,
  handler
});
//# sourceMappingURL=moderateComment.js.map
