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

// netlify/functions/getUploadTicket.js
var getUploadTicket_exports = {};
__export(getUploadTicket_exports, {
  config: () => config,
  handler: () => handler
});
module.exports = __toCommonJS(getUploadTicket_exports);
var import_supabase_js = require("@supabase/supabase-js");
var config = { path: "/.netlify/functions/getUploadTicket" };
function cors(res) {
  return {
    ...res,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json"
    }
  };
}
var { SUPABASE_URL, SUPABASE_SERVICE_ROLE, SUPABASE_BUCKET } = process.env;
var ALLOWED = /* @__PURE__ */ new Set(["application/pdf", "image/png", "image/jpeg"]);
var MAX_BYTES = 10 * 1024 * 1024;
async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") {
      return cors({ statusCode: 200, body: "" });
    }
    if (event.httpMethod !== "POST") {
      return cors({
        statusCode: 405,
        body: JSON.stringify({ error: "Method Not Allowed" })
      });
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !SUPABASE_BUCKET) {
      return cors({
        statusCode: 500,
        body: JSON.stringify({ error: "Missing Supabase env vars" })
      });
    }
    const { mime = "application/pdf" } = JSON.parse(event.body || "{}");
    if (!ALLOWED.has(mime)) {
      return cors({
        statusCode: 415,
        body: JSON.stringify({
          error: "\u0646\u0648\u0639 \u0627\u0644\u0645\u0644\u0641 \u063A\u064A\u0631 \u0645\u0633\u0645\u0648\u062D. \u0627\u0644\u0645\u0633\u0645\u0648\u062D: PDF/PNG/JPG"
        })
      });
    }
    const ext = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
    const objectPath = `proofs/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const supabase = (0, import_supabase_js.createClient)(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
    const THIRTY_MINUTES = 60 * 30;
    const { data, error } = await supabase.storage.from(SUPABASE_BUCKET).createSignedUploadUrl(objectPath, THIRTY_MINUTES);
    if (error) {
      console.error("[SIGNED UPLOAD URL ERROR]", error);
      return cors({
        statusCode: 500,
        body: JSON.stringify({ error: error.message })
      });
    }
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/upload/sign/${objectPath}`;
    const resp = {
      path: objectPath,
      // خزّنه مع الشكوى (لا حاجة لحفظ رابط مؤقّت)
      token: data?.token,
      // ضعه في هيدر Authorization عند الرفع
      uploadUrl,
      // هذا هو endpoint الذي سترفع عليه مباشرة
      contentType: mime,
      // استخدمه كهيدر Content-Type في طلب PUT
      maxBytes: MAX_BYTES,
      // للواجهة فقط (تذكير بالحجم)
      // وقت الانتهاء تقديري: الآن + 30 دقيقة (قد يختلف فعلياً حسب إصدار المكتبة)
      expiresAt: Date.now() + THIRTY_MINUTES * 1e3
    };
    return cors({ statusCode: 200, body: JSON.stringify(resp) });
  } catch (err) {
    console.error("[getUploadTicket ERROR]", err);
    return cors({
      statusCode: 500,
      body: JSON.stringify({ error: err.message || String(err) })
    });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  config,
  handler
});
//# sourceMappingURL=getUploadTicket.js.map
