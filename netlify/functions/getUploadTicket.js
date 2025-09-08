// netlify/functions/getUploadTicket.js
import { createClient } from "@supabase/supabase-js";

export const config = { path: "/.netlify/functions/getUploadTicket" };

function cors(res) {
  return {
    ...res,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json",
    },
  };
}

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE, SUPABASE_BUCKET } = process.env;

// الأنواع المسموح بها وحجم 10MB (للاتساق مع الخلفيات الأخرى)
const ALLOWED = new Set(["application/pdf", "image/png", "image/jpeg"]);
const MAX_BYTES = 10 * 1024 * 1024; // 10MB (معلومة فقط هنا)

export async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") {
      return cors({ statusCode: 200, body: "" });
    }
    if (event.httpMethod !== "POST") {
      return cors({
        statusCode: 405,
        body: JSON.stringify({ error: "Method Not Allowed" }),
      });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !SUPABASE_BUCKET) {
      return cors({
        statusCode: 500,
        body: JSON.stringify({ error: "Missing Supabase env vars" }),
      });
    }

    // مدخلات اختيارية من الواجهة: mime واسم مقترح (لا نستخدم الاسم كما هو حفاظاً على الأمان)
    const { mime = "application/pdf" } = JSON.parse(event.body || "{}");

    // تحقّق النوع
    if (!ALLOWED.has(mime)) {
      return cors({
        statusCode: 415,
        body: JSON.stringify({
          error: "نوع الملف غير مسموح. المسموح: PDF/PNG/JPG",
        }),
      });
    }

    const ext =
      mime === "application/pdf"
        ? "pdf"
        : mime === "image/png"
        ? "png"
        : "jpg";

    // مسار آمن داخل البكت
    const objectPath = `proofs/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.${ext}`;

    // إنشاء عميل Supabase باستخدام مفتاح الدور الخدمي (server-side فقط)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    // ⚠️ بعض الإصدارات لا تدعم تمرير مدة صلاحية هنا — سنحاول 30 دقيقة، وإن تجاهلتها المكتبة فستستخدم الافتراضي.
    // إن كان إصدارك لا يقبل وسيطاً ثانياً، سيُهمل بدون مشاكل.
    const THIRTY_MINUTES = 60 * 30;
    const { data, error } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .createSignedUploadUrl(objectPath, THIRTY_MINUTES);

    if (error) {
      console.error("[SIGNED UPLOAD URL ERROR]", error);
      return cors({
        statusCode: 500,
        body: JSON.stringify({ error: error.message }),
      });
    }

    // حضّر رابط PUT الجاهز للرفع من المتصفح + التوكن
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/upload/sign/${objectPath}`;

    // معلومات إرشادية للواجهة
    const resp = {
      path: objectPath,            // خزّنه مع الشكوى (لا حاجة لحفظ رابط مؤقّت)
      token: data?.token,          // ضعه في هيدر Authorization عند الرفع
      uploadUrl,                   // هذا هو endpoint الذي سترفع عليه مباشرة
      contentType: mime,           // استخدمه كهيدر Content-Type في طلب PUT
      maxBytes: MAX_BYTES,         // للواجهة فقط (تذكير بالحجم)
      // وقت الانتهاء تقديري: الآن + 30 دقيقة (قد يختلف فعلياً حسب إصدار المكتبة)
      expiresAt: Date.now() + THIRTY_MINUTES * 1000,
    };

    return cors({ statusCode: 200, body: JSON.stringify(resp) });
  } catch (err) {
    console.error("[getUploadTicket ERROR]", err);
    return cors({
      statusCode: 500,
      body: JSON.stringify({ error: err.message || String(err) }),
    });
  }
}
