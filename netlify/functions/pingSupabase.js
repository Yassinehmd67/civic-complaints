// netlify/functions/pingSupabase.js
export async function handler(event) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pong: true,
      now: new Date().toISOString(),
      envUrl: process.env.SUPABASE_URL || null
    })
  };
}
