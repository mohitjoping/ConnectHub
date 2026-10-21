"use client";

import { Loader2, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createContact } from "@/lib/actions/contacts";

const empty = { firstName: "", lastName: "", phone: "", email: "", countryCode: "", tags: "", voiceConsent: false, whatsappOptIn: false, consentSource: "" };

export function AddContactDialog({ defaultCountry }: { defaultCountry: string }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const consented = form.voiceConsent || form.whatsappOptIn;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await createContact(form);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setForm(empty);
      setOpen(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus /> Add contact
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add contact</DialogTitle>
            <DialogDescription>Local numbers are read as {defaultCountry} unless you set a country.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="c-first">First name</Label>
              <Input id="c-first" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-last">Last name</Label>
              <Input id="c-last" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-phone">Phone *</Label>
              <Input id="c-phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+91 98765 43210" required inputMode="tel" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-country">Country (ISO)</Label>
              <Input id="c-country" value={form.countryCode} onChange={(e) => set("countryCode", e.target.value)} placeholder={defaultCountry} maxLength={2} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="c-email">Email</Label>
              <Input id="c-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="c-tags">Tags</Label>
              <Input id="c-tags" value={form.tags} onChange={(e) => set("tags", e.target.value)} placeholder="vip, mumbai" />
            </div>
          </div>
          <fieldset className="space-y-2 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">Consent</legend>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.voiceConsent} onCheckedChange={(v) => set("voiceConsent", v === true)} /> Agreed to receive phone calls
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.whatsappOptIn} onCheckedChange={(v) => set("whatsappOptIn", v === true)} /> Opted in to WhatsApp messages
            </label>
            {consented ? (
              <div className="space-y-1.5 pt-1">
                <Label htmlFor="c-source">Where was consent given? *</Label>
                <Input id="c-source" value={form.consentSource} onChange={(e) => set("consentSource", e.target.value)} placeholder="e.g. Website signup form, 22 Oct 2026" required />
              </div>
            ) : null}
          </fieldset>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null} Save contact
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
