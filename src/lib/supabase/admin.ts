import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "@/lib/env";

/**
 * Service-role client that BYPASSES row level security. Only used by the
 * scheduled-campaign cron route; never import it from user-facing code.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !key) return null;
  return createClient(supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
