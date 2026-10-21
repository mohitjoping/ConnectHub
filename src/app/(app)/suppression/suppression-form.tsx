"use client";

import { Loader2, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { addSuppressions, removeSuppression } from "@/lib/actions/compliance";

export function SuppressionForm() {
  const [phones, setPhones] = useState("");
  const [channel, setChannel] = useState<"all" | "voice" | "whatsapp">("all");
  const [reason, setReason] = useState<"opt_out" | "dnc_registry" | "complaint" | "invalid_number" | "manual">("opt_out");
  const [notes, setNotes] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await addSuppressions({ phones, channel, reason, notes, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : "" });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(r.message);
      if (r.data?.invalid.length) toast.warning(`Skipped ${r.data.invalid.length} invalid: ${r.data.invalid.slice(0, 5).join(", ")}`);
      setPhones("");
      setNotes("");
    });
  };

  return (
    <Card className="self-start">
      <CardHeader>
        <CardTitle>Add numbers</CardTitle>
        <CardDescription>One per line, or comma-separated. Paste a whole column from Excel.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <Textarea value={phones} onChange={(e) => setPhones(e.target.value)} rows={6} placeholder={"+919876543210\n+14155552671"} className="font-mono text-xs" required />
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Channel</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as typeof channel)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All channels</SelectItem>
                  <SelectItem value="voice">Phone calls</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Select value={reason} onValueChange={(v) => setReason(v as typeof reason)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="opt_out">Opted out</SelectItem>
                  <SelectItem value="dnc_registry">DNC / DND registry</SelectItem>
                  <SelectItem value="complaint">Complaint</SelectItem>
                  <SelectItem value="invalid_number">Invalid number</SelectItem>
                  <SelectItem value="manual">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-notes">Notes</Label>
            <Input id="s-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Replied STOP on 21 Oct" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-exp">Expires (optional)</Label>
            <Input id="s-exp" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={pending || !phones.trim()}>
            {pending ? <Loader2 className="animate-spin" /> : null} Suppress
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function RemoveSuppressionButton({ id, phone }: { id: string; phone: string }) {
  const [pending, start] = useTransition();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`Remove ${phone}`}>
          {pending ? <Loader2 className="animate-spin" /> : <X />}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Allow {phone} to be contacted again?</AlertDialogTitle>
          <AlertDialogDescription>Only do this if the person has given fresh consent. The removal is recorded in the audit log.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep suppressed</AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              start(async () => {
                const r = await removeSuppression(id);
                if (r.ok) toast.success(r.message);
                else toast.error(r.error);
              })
            }
          >
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
