"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-16 text-center">
      <AlertTriangle className="mb-3 size-6 text-destructive" />
      <p className="font-medium">Something went wrong loading this page</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {error.message.includes("relation") || error.message.includes("schema cache")
          ? "The database tables were not found. Run the SQL migrations in supabase/migrations (see README)."
          : "Try again. If it keeps happening, check the server logs."}
      </p>
      {error.digest ? <p className="mt-2 font-mono text-xs text-muted-foreground">ref {error.digest}</p> : null}
      <Button className="mt-4" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
