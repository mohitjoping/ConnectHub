import { CheckCircle2, Lock, XCircle } from "lucide-react";
import { ModeBadge } from "@/components/mode";
import type { LiveReadiness } from "@/lib/compliance/requirements";
import { cn } from "@/lib/utils";

export function ReadinessChecklist({ readiness, compact }: { readiness: LiveReadiness; compact?: boolean }) {
  return (
    <div className={cn("rounded-xl border", compact ? "p-3" : "p-4")}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {readiness.ready ? null : <Lock className="size-4 text-muted-foreground" />}
          <p className="text-sm font-medium">{readiness.channel === "voice" ? "Phone Calls" : "WhatsApp"} live readiness</p>
        </div>
        <ModeBadge mode={readiness.ready ? "live" : "simulation"} />
      </div>
      <ul className="space-y-1.5">
        {readiness.checks.map((c) => (
          <li key={c.key} className="flex items-start gap-2 text-sm">
            {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
            <span>
              <span className={c.ok ? "" : "text-muted-foreground"}>{c.label}</span>
              {!compact || !c.ok ? <span className="block text-xs text-muted-foreground">{c.detail}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
