import type { Metadata } from "next";
import { FlaskConical } from "lucide-react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <span className="text-xs font-bold">CH</span>
            </span>
            <span className="text-lg font-semibold tracking-tight">ConnectHub</span>
          </div>
          <LoginForm next={next} initialError={error} />
        </div>
      </div>
      <div className="hidden flex-col justify-between bg-muted p-10 lg:flex">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-sim px-3 py-1 text-xs font-semibold text-sim-foreground uppercase">
          <FlaskConical className="size-3.5" /> Simulation by default
        </span>
        <div className="space-y-4">
          <h2 className="text-3xl font-semibold tracking-tight text-balance">Phone call and WhatsApp campaigns, built consent-first.</h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>Import contacts from CSV, Excel or a paste — validated and de-duplicated.</li>
            <li>Run campaigns against mock providers until compliance is verified.</li>
            <li>Every send, skip and setting change lands in the audit log.</li>
          </ul>
        </div>
        <p className="text-xs text-muted-foreground">Live delivery stays locked until a server flag, a real provider and verified compliance records all line up.</p>
      </div>
    </div>
  );
}
