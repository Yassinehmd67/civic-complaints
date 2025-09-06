// netlify/functions/pingSupabase.js
import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE } = process.env;

export async function handler() {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Missing Supabase env vars" }),
      };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    // تجربة استدعاء واجهة "health"
    const { data, error } = await supabase.auth.getSession();

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        envUrl: SUPABASE_URL,
        authError: error?.message || null,
        session: data || null,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
}
