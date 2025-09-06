// netlify/functions/uploadProof.js
import Busboy from "busboy";
import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE, SUPABASE_BUCKET } = process.env;

// أنواع الملفات المسموحة وحجم 10MB
const ALLOWED = new Set(["application/pdf", "image/png", "image/jpeg"]);
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !SUPABASE_BUCKET) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Missing Supabase env vars" }),
      };
    }

    // Netlify يسلّم الجسم base64 عند multipart
    const contentType = event.headers["content-type"] || event.headers["Content-Type"];
    if (!contentType || !contentType.includes("multipart/form-data")) {
      return { statusCode: 400, body: "Content-Type must be multipart/form-data" };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

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
          reject(new Error("نوع الملف غير مسموح. المسموح: PDF/PNG/JPG"));
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

    // الامتداد حسب الـ mime
    const ext = fileMime === "application/pdf" ? "pdf" : fileMime === "image/png" ? "png" : "jpg";
    const objectName = `proofs/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    // رفع الملف إلى Supabase Storage (bucket يجب أن يكون موجودًا ومسمى في SUPABASE_BUCKET)
    const { error: uploadError } = await supabase
      .storage
      .from(SUPABASE_BUCKET)
      .upload(objectName, fileBuffer, {
        contentType: fileMime,
        upsert: false
      });

    if (uploadError) {
      return { statusCode: 500, body: JSON.stringify({ error: uploadError.message }) };
    }

    // لا نعرض رابطًا عامًا دائمًا. نُعيد مسارًا داخليًا + رابطًا موقّتًا (ساعة) إن أردت.
    const { data: signed } = await supabase
      .storage
      .from(SUPABASE_BUCKET)
      .createSignedUrl(objectName, 60 * 60); // 1 ساعة

    return {
      statusCode: 200,
      body: JSON.stringify({
        path: objectName,
        url: signed?.signedUrl || null, // يستخدم للعرض المؤقت إن احتجت
      }),
      headers: { "Content-Type": "application/json" }
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
