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

// netlify/functions/listPendingComments.js
var listPendingComments_exports = {};
__export(listPendingComments_exports, {
  config: () => config,
  handler: () => handler
});
module.exports = __toCommonJS(listPendingComments_exports);
var config = { path: "/.netlify/functions/listPendingComments" };
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
var toJSON = (o) => JSON.stringify(o);
async function handler(event) {
  if (event.httpMethod === "OPTIONS") return cors({ statusCode: 200, body: "" });
  if (event.httpMethod !== "GET") return cors({ statusCode: 405, body: toJSON({ ok: false, error: "Method Not Allowed" }) });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    return cors({ statusCode: 500, body: toJSON({ ok: false, error: "Missing Supabase env vars" }) });
  }
  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/pending_comments`);
    url.searchParams.set("select", "id,issue_number,full_name,comment,created_at");
    url.searchParams.set("order", "created_at.desc");
    url.searchParams.set("limit", "200");
    const res = await fetch(url, {
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE}`,
        "Accept": "application/json"
      }
    });
    if (!res.ok) {
      const t = await res.text();
      return cors({ statusCode: 500, body: toJSON({ ok: false, error: `Supabase error: ${t || res.status}` }) });
    }
    const rows = await res.json();
    return cors({ statusCode: 200, body: toJSON({ ok: true, items: rows }) });
  } catch (e) {
    return cors({ statusCode: 500, body: toJSON({ ok: false, error: e?.message || String(e) }) });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  config,
  handler
});
//# sourceMappingURL=listPendingComments.js.map
