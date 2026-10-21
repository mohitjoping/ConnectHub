"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

const credentials = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

function authMessage(error: { message: string; status?: number }): string {
  if (error.message === "fetch failed" || error.status === 0) {
    return "Can't reach Supabase. Check NEXT_PUBLIC_SUPABASE_URL and that the project is running.";
  }
  return error.message;
}

function safeNext(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

export async function signIn(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = credentials.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { ok: false, error: authMessage(error) };
  await writeAudit(supabase, { ownerId: data.user.id, actorId: data.user.id, action: "auth.sign_in", entityType: "user", entityId: data.user.id });
  redirect(safeNext(form.get("next")));
}

export async function signUp(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = credentials.extend({ fullName: z.string().trim().max(100).optional() }).safeParse({
    email: form.get("email"),
    password: form.get("password"),
    fullName: form.get("fullName") || undefined,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const origin = process.env.NEXT_PUBLIC_SITE_URL || (await headers()).get("origin") || "http://localhost:3000";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
      data: { full_name: parsed.data.fullName ?? null },
    },
  });
  if (error) return { ok: false, error: authMessage(error) };
  if (data.session) {
    await writeAudit(supabase, { ownerId: data.session.user.id, actorId: data.session.user.id, action: "auth.sign_up", entityType: "user", entityId: data.session.user.id });
    redirect("/dashboard");
  }
  return { ok: true, message: "Check your inbox to confirm your email, then sign in." };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
