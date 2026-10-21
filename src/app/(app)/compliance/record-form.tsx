"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createComplianceRecord, setComplianceStatus } from "@/lib/actions/compliance";
import { COMPLIANCE_TYPES, REQUIRED_COMPLIANCE, type ComplianceRecordType, type ComplianceStatus } from "@/lib/compliance/requirements";

export function ComplianceRecordForm() {
  const [channel, setChannel] = useState<"voice" | "whatsapp">("voice");
  const [recordType, setRecordType] = useState<ComplianceRecordType>("provider_approval");
  const [title, setTitle] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [pending, start] = useTransition();
  const types = REQUIRED_COMPLIANCE[channel];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await createComplianceRecord({ channel, recordType, title, reference, notes, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : "" });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(r.message);
      setTitle("");
      setReference("");
      setNotes("");
      setExpiresAt("");
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add a record</CardTitle>
        <CardDescription>Records start as pending. An owner or admin verifies them once the evidence is checked.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Channel</Label>
              <Select
                value={channel}
                onValueChange={(v) => {
                  const next = v as "voice" | "whatsapp";
                  setChannel(next);
                  if (!REQUIRED_COMPLIANCE[next].includes(recordType)) setRecordType(REQUIRED_COMPLIANCE[next][0]);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="voice">Phone calls</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={recordType} onValueChange={(v) => setRecordType(v as ComplianceRecordType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {types.map((t) => (
                    <SelectItem key={t} value={t}>
                      {COMPLIANCE_TYPES[t].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{COMPLIANCE_TYPES[recordType].description}</p>
          <div className="space-y-1.5">
            <Label htmlFor="cr-title">Title *</Label>
            <Input id="cr-title" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Twilio A2P voice approval" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr-ref">Reference / evidence link</Label>
            <Input id="cr-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ticket ID, document URL…" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr-notes">Notes</Label>
            <Textarea id="cr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr-exp">Expires</Label>
            <Input id="cr-exp" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={pending || !title.trim()}>
            {pending ? <Loader2 className="animate-spin" /> : null} Add record
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function StatusControl({ id, status, canVerify }: { id: string; status: ComplianceStatus; canVerify: boolean }) {
  const [pending, start] = useTransition();
  const options: ComplianceStatus[] = canVerify ? ["pending", "verified", "rejected", "expired"] : ["pending", "rejected", "expired"];
  return (
    <div className="flex items-center gap-2">
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      <Select
        value={status}
        onValueChange={(v) =>
          start(async () => {
            const r = await setComplianceStatus(id, v as ComplianceStatus);
            if (r.ok) toast.success(r.message);
            else toast.error(r.error);
          })
        }
      >
        <SelectTrigger size="sm" className="w-32" aria-label="Record status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o} className="capitalize">
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
