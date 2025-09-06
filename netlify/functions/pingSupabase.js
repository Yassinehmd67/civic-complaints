export const handler = async () => {
  const { SUPABASE_URL } = process.env;

  const raw = SUPABASE_URL || "";
  const trimmed = raw.trim();
  const info = { raw, trimmed, same: raw === trimmed };

  try {
    // لو المستخدم أدخل URL بدون بروتوكول
    const url = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
    const health = `${url.replace(/\/+$/,'')}/auth/v1/health`;

    const r = await fetch(health, { method: "GET" });
    const text = await r.text();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: r.ok,
        status: r.status,
        healthUrl: health,
        text,
        envInfo: info,
      })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        error: String(e),
        envInfo: info
      })
    };
  }
};
