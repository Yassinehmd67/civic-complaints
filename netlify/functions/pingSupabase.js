export const handler = async () => {
  try {
    const { SUPABASE_URL, SUPABASE_BUCKET } = process.env;
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        ok: true,
        url: SUPABASE_URL,
        bucket: SUPABASE_BUCKET,
      })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok:false, error: String(e) }) };
  }
};
