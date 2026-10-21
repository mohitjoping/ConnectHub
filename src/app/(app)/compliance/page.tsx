import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { ReadinessChecklist } from "@/components/campaigns/readiness-card";
import { LocalTime } from "@/components/local-time";
import { EmptyState, PageHeader } from "@/components/page";
import { ChannelBadge, StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getProfile, requireUser } from "@/lib/auth";
import { getAllReadiness } from "@/lib/compliance/readiness";
import { COMPLIANCE_TYPES } from "@/lib/compliance/requirements";
import type { ComplianceRecord } from "@/lib/types";
import { ComplianceRecordForm, StatusControl } from "./record-form";

export const metadata: Metadata = { title: "Compliance" };

export default async function CompliancePage() {
  const { supabase, userId } = await requireUser();
  const [{ data }, readiness, profile] = await Promise.all([
    supabase.from("compliance_records").select("*").eq("owner_id", userId).order("created_at", { ascending: false }),
    getAllReadiness(supabase, userId),
    getProfile(),
  ]);
  const records = (data ?? []) as ComplianceRecord[];
  const canVerify = profile?.role === "owner" || profile?.role === "admin";

  return (
    <>
      <PageHeader
        title="Compliance & live readiness"
        description="Live delivery needs three things at once: the server flag (LIVE_VOICE_ENABLED / LIVE_WHATSAPP_ENABLED), a real provider adapter, and every required record below verified and unexpired. The database enforces the last part independently."
      />

      <div className="mb-8 grid gap-4 md:grid-cols-2">
        <ReadinessChecklist readiness={readiness.voice} />
        <ReadinessChecklist readiness={readiness.whatsapp} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          <h2 className="mb-3 text-sm font-medium">Records</h2>
          {records.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="No compliance records yet" description="Add provider approvals, consent policies, DNC checks and Meta verifications as you obtain them." />
          ) : (
            <div className="space-y-3">
              {records.map((r) => (
                <div key={r.id} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <ChannelBadge channel={r.channel} />
                        <span className="text-xs text-muted-foreground">{COMPLIANCE_TYPES[r.record_type].label}</span>
                        <StatusBadge status={r.status} />
                      </div>
                      <p className="font-medium">{r.title}</p>
                      {r.reference ? <p className="text-sm break-all text-muted-foreground">Ref: {r.reference}</p> : null}
                      {typeof r.details?.notes === "string" ? <p className="text-sm text-muted-foreground">{r.details.notes}</p> : null}
                      <p className="text-xs text-muted-foreground">
                        Added <LocalTime iso={r.created_at} mode="date" />
                        {r.verified_at ? (
                          <>
                            {" "}
                            · verified <LocalTime iso={r.verified_at} mode="date" />
                          </>
                        ) : null}
                        {r.expires_at ? (
                          <>
                            {" "}
                            · expires <LocalTime iso={r.expires_at} mode="date" />
                          </>
                        ) : null}
                      </p>
                    </div>
                    <StatusControl id={r.id} status={r.status} canVerify={canVerify} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-4">
          <ComplianceRecordForm />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">What each record means</CardTitle>
              <CardDescription>Requirements differ by channel and country; this list is a starting point, not legal advice.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {Object.entries(COMPLIANCE_TYPES).map(([key, t]) => (
                <div key={key}>
                  <p className="font-medium">{t.label}</p>
                  <p className="text-xs text-muted-foreground">{t.description}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
