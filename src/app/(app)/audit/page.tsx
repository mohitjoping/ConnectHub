import type { Metadata } from "next";
import Link from "next/link";
import { FileClock } from "lucide-react";
import { LocalTime } from "@/components/local-time";
import { EmptyState, PageHeader, Pager } from "@/components/page";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { pageParams, param } from "@/lib/format";
import type { AuditLog } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Audit log" };

type SP = Record<string, string | string[] | undefined>;

const GROUPS = [
  { label: "All", prefix: "" },
  { label: "Campaigns", prefix: "campaign." },
  { label: "Contacts", prefix: "contact" },
  { label: "Media", prefix: "media." },
  { label: "Suppression", prefix: "suppression." },
  { label: "Compliance", prefix: "compliance." },
  { label: "Auth", prefix: "auth." },
];

function tone(action: string) {
  if (action.includes("live")) return "bg-live text-live-foreground";
  if (action.includes("failed") || action.includes("deleted") || action.includes("revoked")) return "bg-red-500/10 text-red-700 dark:text-red-300";
  if (action.includes("simulation")) return "bg-sim text-sim-foreground";
  return "bg-muted text-foreground";
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { supabase, userId } = await requireUser();
  const { page, from, to } = pageParams(sp);
  const prefix = param(sp, "group");

  let query = supabase.from("audit_logs").select("*", { count: "exact" }).eq("owner_id", userId).order("created_at", { ascending: false }).range(from, to);
  if (prefix && GROUPS.some((g) => g.prefix === prefix)) query = query.like("action", `${prefix}%`);
  const { data, count } = await query;
  const logs = (data ?? []) as AuditLog[];

  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of sign-ins, imports, consent changes, campaign runs and compliance decisions. Rows can't be edited or deleted, even by you." />
      <div className="mb-4 flex flex-wrap gap-1">
        {GROUPS.map((g) => (
          <Button key={g.label} size="sm" variant={prefix === g.prefix ? "secondary" : "ghost"} asChild>
            <Link href={g.prefix ? `/audit?group=${encodeURIComponent(g.prefix)}` : "/audit"}>{g.label}</Link>
          </Button>
        ))}
      </div>
      {logs.length === 0 ? (
        <EmptyState icon={FileClock} title="No events yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Entity</th>
                <th className="px-3 py-2 font-medium">Actor</th>
                <th className="px-3 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {logs.map((l) => (
                <tr key={l.id} className="align-top">
                  <td className="px-3 py-2 text-xs whitespace-nowrap text-muted-foreground">
                    <LocalTime iso={l.created_at} />
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn("rounded px-1.5 py-0.5 font-mono text-xs", tone(l.action))}>{l.action}</span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {l.entity_type}
                    {l.entity_id ? <span className="block max-w-40 truncate font-mono text-muted-foreground">{l.entity_id}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{l.actor_id ? (l.actor_id === userId ? "You" : l.actor_id.slice(0, 8)) : "System (scheduler)"}</td>
                  <td className="px-3 py-2">
                    {Object.keys(l.metadata ?? {}).length ? (
                      <code className="block max-w-md text-xs break-all whitespace-pre-wrap text-muted-foreground">{JSON.stringify(l.metadata)}</code>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} hasMore={(count ?? 0) > to + 1} basePath="/audit" searchParams={sp} total={count} />
    </>
  );
}
