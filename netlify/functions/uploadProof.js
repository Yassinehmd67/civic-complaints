// netlify/functions/uploadProof.js
import Busboy from "busboy";
import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE, SUPABASE_BUCKET } = process.env;
const ALLOWED = new Set(["application/pdf", "image/png", "image/jpeg"]);
const MAX_BYTES = 10 * 1024 * 1024;

function cors(res) {
  return {
    ...res,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json",
    },
  };
}

export const config = { path: "/.netlify/functions/uploadProof" };

export async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") return cors({ statusCode: 200, body: "" });
    if (event.httpMethod !== "POST") return cors({ statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) });

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !SUPABASE_BUCKET) {
      console.error("[UPLOAD ERROR] Missing Supabase env vars");
      return cors({ statusCode: 500, body: JSON.stringify({ error: "Missing Supabase env vars" }) });
    }

    const contentType = event.headers["content-type"] || event.headers["Content-Type"];
    if (!contentType || !contentType.includes("multipart/form-data")) {
      return cors({ statusCode: 400, body: JSON.stringify({ error: "Content-Type must be multipart/form-data" }) });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    // Netlify يسلم الجسم base64 في multipart
    const buffer = Buffer.from(event.body || "", "base64");
    const busboy = Busboy({ headers: { "content-type": contentType } });

    let fileBuffer = Buffer.alloc(0);
    let fileMime = "";
    let fileName = "";
    let totalBytes = 0;

    const filePromise = new Promise((resolve, reject) => {
      busboy.on("file", (_field, file, info) => {
        fileName = info.filename || "upload";
        fileMime = info.mimeType || "application/octet-stream";

        if (!ALLOWED.has(fileMime)) {
          return reject(new Error("نوع الملف غير مسموح. المسموح: PDF/PNG/JPG"));
        }

        file.on("data", (data) => {
          totalBytes += data.length;
          if (totalBytes > MAX_BYTES) {
            return reject(new Error("تجاوز الحد الأقصى 10MB"));
          }
          fileBuffer = Buffer.concat([fileBuffer, data]);
        });

        file.on("end", () => resolve());
        file.on("limit", () => reject(new Error("تجاوز الحد الأقصى")));
      });

      busboy.on("error", reject);
      busboy.on("finish", () => resolve());
    });

    busboy.end(buffer);
    await filePromise;

    if (!fileBuffer.length) {
      return cors({ statusCode: 400, body: JSON.stringify({ error: "لم يتم استلام ملف" }) });
    }

    const ext = fileMime === "application/pdf" ? "pdf" : fileMime === "image/png" ? "png" : "jpg";
    const objectName = `proofs/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    // جرّب قراءة معلومات الـ bucket للتأكد من الاتصال قبل الرفع (تشخيص)
    const { error: listErr } = await supabase.storage.getBucket(SUPABASE_BUCKET);
    if (listErr) {
      console.error("[STORAGE BUCKET ERROR]", listErr);
      return cors({ statusCode: 500, body: JSON.stringify({ error: "تعذّر الوصول إلى مخزن الملفات (bucket)" }) });
    }

    const { error: uploadError } = await supabase
      .storage
      .from(SUPABASE_BUCKET)
      .upload(objectName, fileBuffer, {
        contentType: fileMime,
        upsert: false
      });

    if (uploadError) {
      console.error("[UPLOAD ERROR]", uploadError);
      return cors({ statusCode: 500, body: JSON.stringify({ error: uploadError.message }) });
    }

    const { data: signed, error: signedErr } = await supabase
      .storage
      .from(SUPABASE_BUCKET)
      .createSignedUrl(objectName, 60 * 60);

    if (signedErr) {
      console.error("[SIGNED URL ERROR]", signedErr);
    }

    return cors({
      statusCode: 200,
      body: JSON.stringify({
        path: objectName,
        url: signed?.signedUrl || null,
      }),
    });
  } catch (err) {
    console.error("[CATCH ERROR uploadProof]", err);
    return cors({ statusCode: 500, body: JSON.stringify({ error: err.message || String(err) }) });
  }
}
