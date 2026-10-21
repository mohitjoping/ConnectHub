import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle, Image as ImageIcon, MessageCircle, Phone, ShieldBan, Upload, Users } from "lucide-react";
import { LocalTime } from "@/components/local-time";
import { ModeBadge } from "@/components/mode";
import { PageHeader, StatCard } from "@/components/page";
import { ChannelBadge, StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getAllReadiness } from "@/lib/compliance/readiness";
import { formatNumber } from "@/lib/format";
import type { Campaign } from "@/lib/types";

export const metadata: Metadata = { title: "Overview" };

export default async function DashboardPage() {
  const { supabase, userId } = await requireUser();
  const count = (table: string, filter?: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => {
    const q = base(table);
    return (filter ? filter(q) : q).then((r) => r.count ?? 0);
  };
  const base = (table: string) => supabase.from(table).select("id", { count: "exact", head: true }).eq("owner_id", userId);

  const [contacts, voiceConsent, waOptIn, suppressed, media, campaignsResult, readiness] = await Promise.all([
    count("contacts"),
    count("contacts", (q) => q.eq("voice_consent", true)),
    count("contacts", (q) => q.eq("whatsapp_opt_in", true)),
    count("suppression_records"),
    count("media_assets"),
    supabase.from("campaigns").select("id, name, channel, status, mode, stats, scheduled_at, completed_at, created_at").eq("owner_id", userId).order("created_at", { ascending: false }).limit(8),
    getAllReadiness(supabase, userId),
  ]);
  const campaigns = (campaignsResult.data ?? []) as Campaign[];

  const steps = [
    { done: contacts > 0, label: "Import or add contacts", href: "/contacts/import", icon: Upload },
    { done: voiceConsent + waOptIn > 0, label: "Record consent for at least one channel", href: "/contacts", icon: Users },
    { done: media > 0, label: "Upload audio, an image or a video", href: "/media", icon: ImageIcon },
    { done: campaigns.some((c) => c.status === "completed"), label: "Run your first simulated campaign", href: "/calls/new", icon: Phone },
  ];

  return (
    <>
      <PageHeader
        title="Overview"
        description="Everything here runs against mock providers unless a channel passes its live-readiness checklist."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/contacts/import">
                <Upload /> Import contacts
              </Link>
            </Button>
            <Button asChild>
              <Link href="/calls/new">New campaign</Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Contacts" value={formatNumber(contacts)} icon={Users} />
        <StatCard label="Voice consent" value={formatNumber(voiceConsent)} icon={Phone} tone="voice" hint="Can receive calls" />
        <StatCard label="WhatsApp opt-in" value={formatNumber(waOptIn)} icon={MessageCircle} tone="whatsapp" hint="Can receive messages" />
        <StatCard label="Suppressed numbers" value={formatNumber(suppressed)} icon={ShieldBan} hint="Never contacted" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Recent campaigns</CardTitle>
              <CardDescription>Both channels, newest first.</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/history">
                All history <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {campaigns.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No campaigns yet.</p>
            ) : (
              <ul className="divide-y">
                {campaigns.map((c) => (
                  <li key={c.id}>
                    <Link href={`/${c.channel === "voice" ? "calls" : "whatsapp"}/${c.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 hover:opacity-80">
                      <ChannelBadge channel={c.channel} />
                      <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                      <ModeBadge mode={c.mode} />
                      <StatusBadge status={c.status} />
                      <span className="w-36 text-right text-xs text-muted-foreground">
                        <LocalTime iso={c.completed_at ?? c.scheduled_at ?? c.created_at} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Getting started</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2.5">
                {steps.map((s) => (
                  <li key={s.label}>
                    <Link href={s.href} className="flex items-center gap-2 text-sm hover:underline">
                      {s.done ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Circle className="size-4 text-muted-foreground" />}
                      <span className={s.done ? "text-muted-foreground line-through" : ""}>{s.label}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Delivery mode</CardTitle>
              <CardDescription>Live stays locked until every check passes.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(["voice", "whatsapp"] as const).map((channel) => {
                const r = readiness[channel];
                const passed = r.checks.filter((c) => c.ok).length;
                return (
                  <Link key={channel} href="/compliance" className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50">
                    <div>
                      <p className="text-sm font-medium">{channel === "voice" ? "Phone Calls" : "WhatsApp"}</p>
                      <p className="text-xs text-muted-foreground">
                        {passed}/{r.checks.length} live checks passed
                      </p>
                    </div>
                    <ModeBadge mode={r.ready ? "live" : "simulation"} />
                  </Link>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
