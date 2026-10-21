import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { getSessionOrNull, type Session } from "@/lib/auth";
import type { ActionResult } from "@/lib/types";

/** Run a server action body as the verified user, mapping errors to results. */
export async function withSession<T>(fn: (session: Session) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const session = await getSessionOrNull();
  if (!session) return { ok: false, error: "Your session has expired. Please sign in again." };
  try {
    return await fn(session);
  } catch (error) {
    console.error(error);
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong" };
  }
}

export function dbError(error: PostgrestError | null, fallback = "Database error"): { ok: false; error: string } {
  if (error?.code === "23505") return { ok: false, error: "That record already exists." };
  if (error?.code === "42501") return { ok: false, error: error.message || "Not permitted." };
  return { ok: false, error: error?.message ?? fallback };
}

export function zodMessage(issues: { path: PropertyKey[]; message: string }[]): string {
  const first = issues[0];
  return first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input";
}
