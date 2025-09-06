// netlify/functions/uploadProof.js
import Busboy from "busboy";
import { createClient } from "@supabase/supabase-js";

const RAW_URL = process.env.SUPABASE_URL || "";
const SUPABASE_URL = RAW_URL.trim();              // <— مهم: إزالة أي مسافات
const SUPABASE_SERVICE_ROLE = (process.env.SUPABASE_SERVICE_ROLE || "").trim();
const SUPABASE_BUCKET = (process.env.SUPABASE_BUCKET || "").trim();

const ALLOWED = new Set(["application/pdf", "image/png", "image/jpeg"]);
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }
    // تحقّق من المتغيرات واطبعها في اللوج (بشكل آمن)
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !SUPABASE_BUCKET) {
      console.error("[ENV] URL:", SUPABASE_URL, " BUCKET:", SUPABASE_BUCKET, " KEY?:", !!SUPABASE_SERVICE_ROLE);
      return { statusCode: 500, body: JSON.stringify({ error: "Missing Supabase env vars" }) };
    }

    // تحقّق صحة الرابط وبروتوكوله
    let parsed;
    try {
      parsed = new URL(SUPABASE_URL);
      if (parsed.protocol !== "https:") throw new Error("SUPABASE_URL must start with https://");
    } catch (e) {
      console.error("[ENV] Invalid SUPABASE_URL value:", SUPABASE_URL);
      return { statusCode: 500, body: JSON.stringify({ error: "Invalid SUPABASE_URL" }) };
    }

    // فحص اتصال سريع قبل الرفع (يظهر سبب DNS/شبكة في اللوج إن وُجد)
    try {
      const health = await fetch(`${SUPABASE_URL}/auth/v1/health`, { method: "GET" });
      console.log("[HEALTH] status:", health.status);
    } catch (e) {
      console.error("[HEALTH] fetch failed to", `${SUPABASE_URL}/auth/v1/health`, e);
      return { statusCode: 502, body: JSON.stringify({ error: "Cannot reach Supabase URL (DNS/Network)" }) };
    }

    const contentType = event.headers["content-type"] || event.headers["Content-Type"];
    if (!contentType || !contentType.includes("multipart/form-data")) {
      return { statusCode: 400, body: "Content-Type must be multipart/form-data" };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, { auth: { persistSession: false } });

    const buffer = Buffer.from(event.body || "", "base64");
    const busboy = Busboy({ headers: { "content-type": contentType } });

    let fileBuffer = Buffer.alloc(0);
    let fileMime = "";
    let fileName = "";
    let totalBytes = 0;

    const filePromise = new Promise((resolve, reject) => {
      busboy.on("file", (_field, file, info) => {
        fileName = info?.filename || "upload";
        fileMime = info?.mimeType || "application/octet-stream";

        if (!ALLOWED.has(fileMime)) return reject(new Error("نوع الملف غير مسموح. PDF/PNG/JPG"));

        file.on("data", (data) => {
          totalBytes += data.length;
          if (totalBytes > MAX_BYTES) return reject(new Error("تجاوز الحد الأقصى 10MB"));
          fileBuffer = Buffer.concat([fileBuffer, data]);
        });

        file.on("limit", () => reject(new Error("تجاوز الحد الأقصى")));
        file.on("end", () => resolve());
      });

      busboy.on("error", reject);
      busboy.on("finish", resolve);
    });

    busboy.end(buffer);
    await filePromise;

    if (!fileBuffer.length) {
      return { statusCode: 400, body: JSON.stringify({ error: "لم يتم استلام ملف" }) };
    }

    const ext = fileMime === "application/pdf" ? "pdf" : fileMime === "image/png" ? "png" : "jpg";
    const objectName = `proofs/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const { error: uploadError } = await supabase
      .storage
      .from(SUPABASE_BUCKET)
      .upload(objectName, fileBuffer, {
        contentType: fileMime,
        upsert: false
      });

    if (uploadError) {
      console.error("[UPLOAD ERROR]", uploadError);
      return { statusCode: 500, body: JSON.stringify({ error: uploadError.message }) };
    }

    const { data: signed, error: signedErr } = await supabase
      .storage
      .from(SUPABASE_BUCKET)
      .createSignedUrl(objectName, 60 * 60);

    if (signedErr) console.warn("[SIGNED URL WARN]", signedErr);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: objectName, url: signed?.signedUrl || null })
    };
  } catch (err) {
    console.error("[UNCAUGHT]", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || String(err) }) };
  }
};
