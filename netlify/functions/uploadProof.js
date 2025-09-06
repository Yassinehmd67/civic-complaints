// netlify/functions/uploadProof.js
import Busboy from "busboy";
import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE, SUPABASE_BUCKET } = process.env;

const ALLOWED = new Set(["application/pdf", "image/png", "image/jpeg"]);
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const contentType = event.headers["content-type"] || event.headers["Content-Type"];
    if (!contentType || !contentType.includes("multipart/form-data")) {
      return { statusCode: 400, body: "Content-Type must be multipart/form-data" };
    }

    // طباعة تشخيصية (لن تظهر التوكن)
    console.log("[ENVCHK]", {
      SUPABASE_URL,
      SUPABASE_BUCKET,
      SERVICE_ROLE_PRESENT: Boolean(SUPABASE_SERVICE_ROLE)
    });

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !SUPABASE_BUCKET) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Missing Supabase env vars" })
      };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    // فحص بسيط: listing رمزي للتأكد من الوصول للستوريج
    try {
      const test = await supabase.storage.from(SUPABASE_BUCKET).list("", { limit: 1 });
      if (test.error) {
        console.error("[STORAGE LIST ERROR]", test.error);
      } else {
        console.log("[STORAGE LIST OK]");
      }
    } catch (e) {
      console.error("[STORAGE LIST EXCEPTION]", e);
    }

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
          reject(new Error("نوع الملف غير مسموح (PDF/PNG/JPG)"));
          return;
        }

        file.on("data", (data) => {
          totalBytes += data.length;
          if (totalBytes > MAX_BYTES) {
            reject(new Error("تجاوز الحد الأقصى 10MB"));
            return;
          }
          fileBuffer = Buffer.concat([fileBuffer, data]);
        });

        file.on("end", () => resolve());
        file.on("error", (err) => reject(err));
      });

      busboy.on("finish", resolve);
      busboy.on("error", (err) => reject(err));
    });

    busboy.end(buffer);
    await filePromise;

    if (!fileBuffer.length) {
      return { statusCode: 400, body: JSON.stringify({ error: "لم يتم استلام ملف" }) };
    }

    const ext = fileMime === "application/pdf" ? "pdf" : fileMime === "image/png" ? "png" : "jpg";

    // ملاحظة: إذا كان اسم الـ bucket هو "proofs"، فلا تكرر "proofs/" في الاسم.
    // يمكنك تركه داخل مجلد فرعي (اختياري) مثل "incoming/..."
    const objectName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    let uploadRes;
    try {
      uploadRes = await supabase
        .storage
        .from(SUPABASE_BUCKET)
        .upload(objectName, fileBuffer, {
          contentType: fileMime,
          upsert: false
        });
    } catch (e) {
      console.error("[UPLOAD THROWN EXCEPTION]", e);
      return {
        statusCode: 500,
        body: JSON.stringify({ step: "upload", error: String(e?.message || e) })
      };
    }

    if (uploadRes.error) {
      console.error("[UPLOAD ERROR]", uploadRes.error);
      return { statusCode: 500, body: JSON.stringify({ step: "upload", error: uploadRes.error.message }) };
    }

    let signedUrlRes;
    try {
      signedUrlRes = await supabase
        .storage
        .from(SUPABASE_BUCKET)
        .createSignedUrl(objectName, 60 * 60);
    } catch (e) {
      console.error("[SIGNED URL EXCEPTION]", e);
      return {
        statusCode: 500,
        body: JSON.stringify({ step: "signedUrl", error: String(e?.message || e) })
      };
    }

    if (signedUrlRes.error) {
      console.error("[SIGNED URL ERROR]", signedUrlRes.error);
      return { statusCode: 500, body: JSON.stringify({ step: "signedUrl", error: signedUrlRes.error.message }) };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: objectName,
        url: signedUrlRes.data?.signedUrl || null
      })
    };

  } catch (err) {
    console.error("[CATCH TOP-LEVEL]", err);
    return { statusCode: 500, body: JSON.stringify({ error: String(err?.message || err) }) };
  }
}
