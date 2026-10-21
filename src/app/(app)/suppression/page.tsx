import type { Metadata } from "next";
import { ShieldBan } from "lucide-react";
import { LocalTime } from "@/components/local-time";
import { EmptyState, PageHeader, Pager } from "@/components/page";
import { requireUser } from "@/lib/auth";
import { humanize, pageParams, param } from "@/lib/format";
import type { SuppressionRecord } from "@/lib/types";
import { RemoveSuppressionButton, SuppressionForm } from "./suppression-form";

export const metadata: Metadata = { title: "Suppression list" };

type SP = Record<string, string | string[] | undefined>;

export default async function SuppressionPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { supabase, userId } = await requireUser();
  const { page, from, to } = pageParams(sp);
  const q = param(sp, "q").replace(/[^\d+]/g, "");

  let query = supabase.from("suppression_records").select("*", { count: "exact" }).eq("owner_id", userId).order("created_at", { ascending: false }).range(from, to);
  if (q) query = query.ilike("phone_e164", `%${q}%`);
  const { data, count } = await query;
  const records = (data ?? []) as SuppressionRecord[];

  return (
    <>
      <PageHeader
        title="Suppression list"
        description="Numbers here are never called or messaged, whatever their consent flags say. Checked before every send in both simulation and live mode."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          <form className="mb-3">
            <input name="q" defaultValue={q} placeholder="Search number…" className="h-8 w-full max-w-xs rounded-lg border bg-transparent px-2.5 text-sm" aria-label="Search suppressed numbers" />
          </form>
          {records.length === 0 ? (
            <EmptyState icon={ShieldBan} title={q ? "No matching numbers" : "Nothing suppressed yet"} description="Add opt-outs, complaints and do-not-call registry matches here." />
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Number</th>
                    <th className="px-3 py-2 font-medium">Channel</th>
                    <th className="px-3 py-2 font-medium">Reason</th>
                    <th className="hidden px-3 py-2 font-medium md:table-cell">Notes</th>
                    <th className="px-3 py-2 font-medium">Added</th>
                    <th className="px-3 py-2 font-medium">Expires</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {records.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 font-mono text-xs">{r.phone_e164}</td>
                      <td className="px-3 py-2 capitalize">{r.channel === "all" ? "All channels" : r.channel === "voice" ? "Phone calls" : "WhatsApp"}</td>
                      <td className="px-3 py-2">{humanize(r.reason)}</td>
                      <td className="hidden max-w-48 truncate px-3 py-2 text-muted-foreground md:table-cell">{r.notes ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        <LocalTime iso={r.created_at} mode="date" />
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{r.expires_at ? <LocalTime iso={r.expires_at} mode="date" /> : "Never"}</td>
                      <td className="px-3 py-2 text-right">
                        <RemoveSuppressionButton id={r.id} phone={r.phone_e164} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pager page={page} hasMore={(count ?? 0) > to + 1} basePath="/suppression" searchParams={sp} total={count} />
        </div>
        <SuppressionForm />
      </div>
    </>
  );
}
