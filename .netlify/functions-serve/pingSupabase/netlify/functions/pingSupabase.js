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

// netlify/functions/pingSupabase.js
var pingSupabase_exports = {};
__export(pingSupabase_exports, {
  config: () => config,
  handler: () => handler
});
module.exports = __toCommonJS(pingSupabase_exports);
var import_supabase_js = require("@supabase/supabase-js");
var config = { path: "/.netlify/functions/pingSupabase" };
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
async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return cors({ statusCode: 200, body: "" });
  }
  if (event.httpMethod !== "GET") {
    return cors({ statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) });
  }
  try {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE, SUPABASE_BUCKET } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !SUPABASE_BUCKET) {
      return cors({
        statusCode: 500,
        body: JSON.stringify({ ok: false, where: "env", error: "Missing Supabase env vars" })
      });
    }
    const supabase = (0, import_supabase_js.createClient)(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
    const { data, error } = await supabase.storage.getBucket(SUPABASE_BUCKET);
    if (error) {
      return cors({
        statusCode: 500,
        body: JSON.stringify({ ok: false, where: "storage", error: error.message })
      });
    }
    return cors({
      statusCode: 200,
      body: JSON.stringify({ ok: true, bucket: data?.name || SUPABASE_BUCKET })
    });
  } catch (e) {
    return cors({
      statusCode: 500,
      body: JSON.stringify({ ok: false, where: "catch", error: e.message || String(e) })
    });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  config,
  handler
});
//# sourceMappingURL=pingSupabase.js.map
