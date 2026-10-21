import Link from "next/link";
import { MessageCircle, Phone, Plus } from "lucide-react";
import { LocalTime } from "@/components/local-time";
import { ModeBadge } from "@/components/mode";
import { EmptyState, PageHeader, StatCard } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { formatNumber, percent } from "@/lib/format";
import type { Channel } from "@/lib/providers/types";
import type { Campaign } from "@/lib/types";
import { RunDueButton } from "./campaign-actions";

export const CHANNEL_META = {
  voice: {
    path: "/calls",
    title: "Phone Calls",
    noun: "call campaign",
    icon: Phone,
    description: "Play a recorded audio message to contacts who agreed to receive calls. Runs on the mock voice provider unless live calling is unlocked.",
  },
  whatsapp: {
    path: "/whatsapp",
    title: "WhatsApp",
    noun: "WhatsApp campaign",
    icon: MessageCircle,
    description: "Send approved WhatsApp template messages, optionally with an image or video header, to contacts who opted in. Official Business Platform only — no WhatsApp Web automation.",
  },
} as const;

export async function CampaignList({ channel }: { channel: Channel }) {
  const meta = CHANNEL_META[channel];
  const { supabase, userId } = await requireUser();
  const { data } = await supabase.from("campaigns").select("*").eq("owner_id", userId).eq("channel", channel).order("created_at", { ascending: false }).limit(100);
  const campaigns = (data ?? []) as Campaign[];

  const completed = campaigns.filter((c) => c.status === "completed");
  const sum = (key: string) => completed.reduce((acc, c) => acc + (Number(c.stats?.[key]) || 0), 0);
  const attempted = sum("attempted");
  const scheduled = campaigns.filter((c) => c.status === "scheduled").length;

  return (
    <>
      <PageHeader
        title={meta.title}
        description={meta.description}
        actions={
          <>
            {scheduled ? <RunDueButton /> : null}
            <Button asChild>
              <Link href={`${meta.path}/new`}>
                <Plus /> New {meta.noun}
              </Link>
            </Button>
          </>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Campaigns" value={formatNumber(campaigns.length)} />
        <StatCard label="Scheduled" value={formatNumber(scheduled)} />
        <StatCard label={channel === "voice" ? "Calls attempted" : "Messages attempted"} value={formatNumber(attempted)} hint="Across completed campaigns" />
        <StatCard label={channel === "voice" ? "Answered / voicemail" : "Delivered / read"} value={percent(sum("succeeded"), attempted)} hint={`${formatNumber(sum("skipped"))} skipped for consent or suppression`} />
      </div>

      {campaigns.length === 0 ? (
        <EmptyState
          icon={meta.icon}
          title={`No ${meta.noun}s yet`}
          description="Create a draft, pick an audience and run it in simulation to see exactly what would happen."
          action={
            <Button asChild>
              <Link href={`${meta.path}/new`}>
                <Plus /> New {meta.noun}
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Mode</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Recipients</th>
                <th className="px-3 py-2 text-right font-medium">Success</th>
                <th className="px-3 py-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {campaigns.map((c) => {
                const total = Number(c.stats?.total) || 0;
                return (
                  <tr key={c.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <Link href={`${meta.path}/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <ModeBadge mode={c.mode} />
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{total ? formatNumber(total) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.status === "completed" ? percent(Number(c.stats?.succeeded) || 0, Number(c.stats?.attempted) || 0) : "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {c.status === "scheduled" ? (
                        <>
                          Scheduled <LocalTime iso={c.scheduled_at} />
                        </>
                      ) : (
                        <LocalTime iso={c.completed_at ?? c.created_at} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
