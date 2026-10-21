import type { Metadata } from "next";
import Link from "next/link";
import { History } from "lucide-react";
import { LocalTime } from "@/components/local-time";
import { ModeBadge } from "@/components/mode";
import { EmptyState, PageHeader, Pager } from "@/components/page";
import { ChannelBadge, StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { formatNumber, pageParams, param, percent } from "@/lib/format";
import type { Campaign } from "@/lib/types";

export const metadata: Metadata = { title: "Campaign history" };

type SP = Record<string, string | string[] | undefined>;

const FILTERS = [
  { label: "All", channel: "", mode: "" },
  { label: "Phone Calls", channel: "voice", mode: "" },
  { label: "WhatsApp", channel: "whatsapp", mode: "" },
  { label: "Simulation", channel: "", mode: "simulation" },
  { label: "Live", channel: "", mode: "live" },
];

export default async function HistoryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { supabase, userId } = await requireUser();
  const { page, from, to } = pageParams(sp);
  const channel = param(sp, "channel");
  const mode = param(sp, "mode");

  let query = supabase.from("campaigns").select("*", { count: "exact" }).eq("owner_id", userId).order("created_at", { ascending: false }).range(from, to);
  if (channel === "voice" || channel === "whatsapp") query = query.eq("channel", channel);
  if (mode === "simulation" || mode === "live") query = query.eq("mode", mode);
  const { data, count } = await query;
  const campaigns = (data ?? []) as Campaign[];

  return (
    <>
      <PageHeader title="Campaign history" description="Every campaign across both channels, with its delivery mode and outcome. Campaigns that ran can't be deleted." />
      <div className="mb-4 flex flex-wrap gap-1">
        {FILTERS.map((f) => {
          const active = f.channel === channel && f.mode === mode;
          const qs = new URLSearchParams({ ...(f.channel && { channel: f.channel }), ...(f.mode && { mode: f.mode }) }).toString();
          return (
            <Button key={f.label} size="sm" variant={active ? "secondary" : "ghost"} asChild>
              <Link href={qs ? `/history?${qs}` : "/history"}>{f.label}</Link>
            </Button>
          );
        })}
      </div>
      {campaigns.length === 0 ? (
        <EmptyState icon={History} title="No campaigns here yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Campaign</th>
                <th className="px-3 py-2 font-medium">Channel</th>
                <th className="px-3 py-2 font-medium">Mode</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Recipients</th>
                <th className="px-3 py-2 text-right font-medium">Succeeded</th>
                <th className="px-3 py-2 text-right font-medium">Skipped</th>
                <th className="px-3 py-2 font-medium">Ran / created</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {campaigns.map((c) => (
                <tr key={c.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <Link href={`/${c.channel === "voice" ? "calls" : "whatsapp"}/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <ChannelBadge channel={c.channel} />
                  </td>
                  <td className="px-3 py-2">
                    <ModeBadge mode={c.mode} />
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.stats?.total ? formatNumber(Number(c.stats.total)) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {c.status === "completed" ? `${formatNumber(Number(c.stats.succeeded) || 0)} (${percent(Number(c.stats.succeeded) || 0, Number(c.stats.attempted) || 0)})` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.status === "completed" ? formatNumber(Number(c.stats.skipped) || 0) : "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    <LocalTime iso={c.started_at ?? c.created_at} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} hasMore={(count ?? 0) > to + 1} basePath="/history" searchParams={sp} total={count} />
    </>
  );
}
