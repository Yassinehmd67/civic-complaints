// netlify/functions/uploadProof.js
import Busboy from "busboy";
import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE, SUPABASE_BUCKET } = process.env;

// الأنواع المسموحة (أضفنا HEIC/HEIF)
const ALLOWED = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/heic",
  "image/heif",
]);

const MAX_BYTES = 10 * 1024 * 1024; // 10MB

function cors(res) {
  return {
    ...res,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json",
      "Vary": "Origin",
    },
  };
}

export const config = { path: "/.netlify/functions/uploadProof" };

// تقدير الـ MIME إن كان مفقودًا من المتصفح (بناءً على الامتداد)
function guessMime(filename = "", fallback = "") {
  const f = (fallback || "").toLowerCase();
  if (f) return f;
  const name = (filename || "").toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".heic")) return "image/heic";
  if (name.endsWith(".heif")) return "image/heif";
  return "application/octet-stream";
}

// تحديد الامتداد النهائي بناء على الـ MIME
function pickExt(mime) {
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/heic") return "heic";
  if (mime === "image/heif") return "heif";
  return "bin";
}

export async function handler(event) {
  try {
    // CORS / Preflight
    if (event.httpMethod === "OPTIONS") return cors({ statusCode: 200, body: "" });
    if (event.httpMethod !== "POST") {
      return cors({ statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) });
    }

    // تحقق من المتغيرات السرية
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !SUPABASE_BUCKET) {
      console.error("[UPLOAD ERROR] Missing Supabase env vars");
      return cors({ statusCode: 500, body: JSON.stringify({ error: "Missing Supabase env vars" }) });
    }

    // تحقق من نوع المحتوى
    const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";
    if (!contentType.includes("multipart/form-data")) {
      return cors({ statusCode: 400, body: JSON.stringify({ error: "Content-Type must be multipart/form-data" }) });
    }

    // ملاحظة: في الإنتاج يكون body base64، وفي netlify dev يكون نص عادي
    const encoding = event.isBase64Encoded ? "base64" : "utf8";
    const bodyBuffer = Buffer.from(event.body || "", encoding);

    // Busboy مع حدّ حجم الملف (ليُطلق حدث 'limit')
    const busboy = Busboy({
      headers: { "content-type": contentType },
      limits: { fileSize: MAX_BYTES },
    });

    let fileBuffer = Buffer.alloc(0);
    let fileMime = "";
    let fileName = "";
    let totalBytes = 0;

    const filePromise = new Promise((resolve, reject) => {
      let settled = false;
      const finishOnce = (err) => {
        if (settled) return;
        settled = true;
        err ? reject(err) : resolve();
      };

      busboy.on("file", (_field, file, info) => {
        fileName = info.filename || "upload";
        fileMime = guessMime(fileName, info.mimeType);

        // التحقق من النوع
        if (!ALLOWED.has(fileMime)) {
          // استهلك الستريم ثم ارفض لتفادي تعليق Busboy
          file.resume();
          return finishOnce(new Error("نوع الملف غير مسموح. المسموح: PDF/PNG/JPG/HEIC/HEIF"));
        }

        file.on("data", (data) => {
          totalBytes += data.length;
          if (totalBytes > MAX_BYTES) {
            // سيتعامل Busboy مع القطع، لكن نُنهي نحن كذلك
            file.resume();
            return finishOnce(new Error("تجاوز الحد الأقصى 10MB"));
          }
          fileBuffer = Buffer.concat([fileBuffer, data]);
        });

        file.on("limit", () => finishOnce(new Error("تجاوز الحد الأقصى 10MB")));
        file.on("end", () => finishOnce());
      });

      busboy.on("error", (e) => finishOnce(e));
      busboy.on("finish", () => finishOnce());
    });

    busboy.end(bodyBuffer);
    await filePromise;

    if (!fileBuffer.length) {
      return cors({ statusCode: 400, body: JSON.stringify({ error: "لم يتم استلام ملف" }) });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    // تشخيص: تأكّد من الوصول للـ bucket
    const { error: bucketErr } = await supabase.storage.getBucket(SUPABASE_BUCKET);
    if (bucketErr) {
      console.error("[STORAGE BUCKET ERROR]", bucketErr);
      return cors({ statusCode: 500, body: JSON.stringify({ error: "تعذّر الوصول إلى مخزن الملفات (bucket)" }) });
    }

    // اسم الكائن والامتداد
    const ext = pickExt(fileMime);
    const objectName = `proofs/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    // الرفع إلى Supabase Storage
    const { error: uploadError } = await supabase
      .storage
      .from(SUPABASE_BUCKET)
      .upload(objectName, fileBuffer, {
        contentType: fileMime,
        upsert: false,
      });

    if (uploadError) {
      console.error("[UPLOAD ERROR]", uploadError);
      const msg = uploadError?.message || "Upload failed";
      const status = /payload too large|413/i.test(msg) ? 413 : 500;
      return cors({ statusCode: status, body: JSON.stringify({ error: msg }) });
    }

    // إنشاء رابط موقّت (ساعة)
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
    const message = err?.message || String(err);
    // لو النوع/الحجم غير مسموح بهما، أعد 422 بدل 500
    if (/نوع الملف غير مسموح|غير مسموح|10MB/.test(message)) {
      return cors({ statusCode: 422, body: JSON.stringify({ error: message }) });
    }
    return cors({ statusCode: 500, body: JSON.stringify({ error: message }) });
  }
}
