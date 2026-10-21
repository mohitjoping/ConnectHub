"use client";

import { Loader2, MessageCircle, Phone, ShieldBan, Tag, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addTags, deleteContacts, setConsent } from "@/lib/actions/contacts";
import { contactName } from "@/lib/format";
import type { Contact } from "@/lib/types";
import { cn } from "@/lib/utils";

type Pending =
  | { kind: "consent"; channel: "voice" | "whatsapp"; value: boolean }
  | { kind: "tag" }
  | { kind: "delete" }
  | null;

function ConsentDot({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", on ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
      <span className={cn("size-1.5 rounded-full", on ? "bg-emerald-500" : "bg-muted-foreground/40")} />
      {label}
    </span>
  );
}

export function ContactsTable({ contacts, suppressed }: { contacts: Contact[]; suppressed: string[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<Pending>(null);
  const [text, setText] = useState("");
  const [busy, startTransition] = useTransition();
  const suppressedSet = new Set(suppressed);
  const ids = [...selected];
  const allSelected = contacts.length > 0 && contacts.every((c) => selected.has(c.id));

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error);
      else {
        toast.success(r.message ?? "Done");
        setDialog(null);
        setText("");
        setSelected(new Set());
      }
    });

  const confirm = () => {
    if (!dialog) return;
    if (dialog.kind === "delete") run(() => deleteContacts(ids));
    else if (dialog.kind === "tag") run(() => addTags({ ids, tags: text }));
    else run(() => setConsent({ ids, channel: dialog.channel, value: dialog.value, source: text || undefined }));
  };

  return (
    <>
      {selected.size > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <span className="mx-1 h-4 w-px bg-border" />
          <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "consent", channel: "voice", value: true })}>
            <Phone /> Grant voice
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "consent", channel: "whatsapp", value: true })}>
            <MessageCircle /> Grant WhatsApp
          </Button>
          <Button size="sm" variant="ghost" onClick={() => run(() => setConsent({ ids, channel: "voice", value: false }))}>
            Revoke voice
          </Button>
          <Button size="sm" variant="ghost" onClick={() => run(() => setConsent({ ids, channel: "whatsapp", value: false }))}>
            Revoke WhatsApp
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "tag" })}>
            <Tag /> Add tag
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setDialog({ kind: "delete" })}>
            <Trash2 /> Delete
          </Button>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-10 px-3 py-2">
                <Checkbox
                  aria-label="Select all"
                  checked={allSelected}
                  onCheckedChange={(v) => setSelected(v === true ? new Set(contacts.map((c) => c.id)) : new Set())}
                />
              </th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Phone</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">Email</th>
              <th className="px-3 py-2 font-medium">Consent</th>
              <th className="hidden px-3 py-2 font-medium lg:table-cell">Tags</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {contacts.map((c) => (
              <tr key={c.id} className={cn(selected.has(c.id) && "bg-muted/40")}>
                <td className="px-3 py-2">
                  <Checkbox aria-label={`Select ${c.phone_e164}`} checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                </td>
                <td className="px-3 py-2 font-medium">{contactName(c) || <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                  {c.phone_e164}
                  {suppressedSet.has(c.phone_e164) ? (
                    <span className="ml-2 inline-flex items-center gap-0.5 rounded bg-red-500/10 px-1 py-0.5 font-sans text-[0.65rem] text-red-700 dark:text-red-300" title="On the suppression list">
                      <ShieldBan className="size-3" /> suppressed
                    </span>
                  ) : null}
                </td>
                <td className="hidden max-w-56 truncate px-3 py-2 text-muted-foreground md:table-cell">{c.email ?? "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                    <ConsentDot on={c.voice_consent} label="Voice" />
                    <ConsentDot on={c.whatsapp_opt_in} label="WhatsApp" />
                  </div>
                </td>
                <td className="hidden px-3 py-2 lg:table-cell">
                  <div className="flex flex-wrap gap-1">
                    {c.tags.map((t) => (
                      <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                        {t}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.kind === "delete"
                ? `Delete ${selected.size} contact(s)?`
                : dialog?.kind === "tag"
                  ? "Add tags"
                  : `Grant ${dialog?.kind === "consent" && dialog.channel === "voice" ? "voice call consent" : "WhatsApp opt-in"}`}
            </DialogTitle>
            <DialogDescription>
              {dialog?.kind === "delete"
                ? "Their past campaign recipient rows stay for the audit trail. This can't be undone."
                : dialog?.kind === "tag"
                  ? "Comma-separated. Existing tags are kept."
                  : "Only record consent you actually hold. The source is stored on each contact and in the audit log."}
            </DialogDescription>
          </DialogHeader>
          {dialog?.kind !== "delete" ? (
            <div className="space-y-1.5">
              <Label htmlFor="bulk-text">{dialog?.kind === "tag" ? "Tags" : "Consent source"}</Label>
              <Input
                id="bulk-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={dialog?.kind === "tag" ? "follow-up, q4" : "e.g. Signed event form, 20 Oct 2026"}
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button variant={dialog?.kind === "delete" ? "destructive" : "default"} onClick={confirm} disabled={busy || (dialog?.kind !== "delete" && !text.trim())}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {dialog?.kind === "delete" ? "Delete" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
