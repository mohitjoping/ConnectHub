import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Setup required" };

export default function SetupPage() {
  if (isSupabaseConfigured) redirect("/dashboard");
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Connect Supabase to start</h1>
      <p className="mt-2 text-muted-foreground">
        ConnectHub needs a Supabase project for authentication, the database and media storage. Add these to{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-sm">.env.local</code> (or your Vercel project settings) and restart the server.
      </p>
      <pre className="mt-6 overflow-x-auto rounded-xl border bg-muted p-4 text-sm">
        {`NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   # or the legacy anon key
NEXT_PUBLIC_SITE_URL=http://localhost:3000`}
      </pre>
      <ol className="mt-6 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
        <li>Create a project at supabase.com → New project.</li>
        <li>Project Settings → API keys: copy the project URL and the publishable (anon) key.</li>
        <li>SQL Editor: run the three files in <code>supabase/migrations/</code> in order.</li>
        <li>Authentication → URL Configuration: add <code>http://localhost:3000/auth/callback</code> to Redirect URLs.</li>
      </ol>
      <p className="mt-6 text-sm text-muted-foreground">Full instructions are in the README.</p>
    </div>
  );
}
