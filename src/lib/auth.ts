import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export interface Session {
  supabase: SupabaseClient;
  userId: string;
  email: string | null;
}

/** Verified current user (JWT checked by getClaims), or a redirect to /login. */
export const requireUser = cache(async (): Promise<Session> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (error || !sub) redirect("/login");
  return { supabase, userId: sub, email: (data.claims.email as string | undefined) ?? null };
});

/** For server actions: same check, but returns null instead of redirecting. */
export async function getSessionOrNull(): Promise<Session | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  return sub ? { supabase, userId: sub, email: (data.claims.email as string | undefined) ?? null } : null;
}

export const getProfile = cache(async (): Promise<Profile | null> => {
  const { supabase, userId } = await requireUser();
  const { data } = await supabase.from("profiles").select("id, email, full_name, role").eq("id", userId).maybeSingle();
  return (data as Profile | null) ?? null;
});
