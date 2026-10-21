import type { Metadata } from "next";
import Link from "next/link";
import { Upload, Users } from "lucide-react";
import { LocalTime } from "@/components/local-time";
import { EmptyState, PageHeader, Pager } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { defaultPhoneCountry } from "@/lib/env";
import { pageParams, param } from "@/lib/format";
import type { Contact, ContactImport } from "@/lib/types";
import { AddContactDialog } from "./add-contact-dialog";
import { ContactFilters } from "./contact-filters";
import { ContactsTable } from "./contacts-table";

export const metadata: Metadata = { title: "Contacts" };

type SP = Record<string, string | string[] | undefined>;

export default async function ContactsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { supabase, userId } = await requireUser();
  const { page, from, to } = pageParams(sp);
  const q = param(sp, "q").replace(/[,()*%\\]/g, " ").trim();
  const tag = param(sp, "tag");
  const consent = param(sp, "consent");

  let query = supabase
    .from("contacts")
    .select("*", { count: "exact" })
    .eq("owner_id", userId)
    .order("created_at", { ascending: false })
    .range(from, to);
  if (q) query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%,phone_e164.ilike.%${q.replace(/\s/g, "")}%`);
  if (tag) query = query.contains("tags", [tag]);
  if (consent === "voice") query = query.eq("voice_consent", true);
  if (consent === "whatsapp") query = query.eq("whatsapp_opt_in", true);
  if (consent === "none") query = query.eq("voice_consent", false).eq("whatsapp_opt_in", false);

  const [{ data, count }, tagsResult, suppressionResult, importsResult] = await Promise.all([
    query,
    supabase.rpc("contact_tag_counts"),
    supabase.from("suppression_records").select("phone_e164").eq("owner_id", userId),
    supabase.from("contact_imports").select("*").eq("owner_id", userId).order("created_at", { ascending: false }).limit(5),
  ]);
  const contacts = (data ?? []) as Contact[];
  const tags = ((tagsResult.data ?? []) as { tag: string; contact_count: number }[]).map((t) => ({ tag: t.tag, count: Number(t.contact_count) }));
  const suppressed = [...new Set((suppressionResult.data ?? []).map((r) => r.phone_e164 as string))];
  const imports = (importsResult.data ?? []) as ContactImport[];
  const filtered = Boolean(q || tag || consent);

  return (
    <>
      <PageHeader
        title="Contacts"
        description="Shared by Phone Calls and WhatsApp. Consent is tracked per channel, and nobody is contacted without it."
        actions={
          <>
            <AddContactDialog defaultCountry={defaultPhoneCountry} />
            <Button asChild>
              <Link href="/contacts/import">
                <Upload /> Import
              </Link>
            </Button>
          </>
        }
      />

      <ContactFilters tags={tags} />

      {contacts.length === 0 ? (
        <EmptyState
          icon={Users}
          title={filtered ? "No contacts match these filters" : "No contacts yet"}
          description={filtered ? "Try clearing the search or tag filter." : "Import a CSV or Excel file, paste from a spreadsheet, or add someone by hand."}
          action={
            filtered ? null : (
              <Button asChild>
                <Link href="/contacts/import">
                  <Upload /> Import contacts
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          <ContactsTable contacts={contacts} suppressed={suppressed} />
          <Pager page={page} hasMore={(count ?? 0) > to + 1} basePath="/contacts" searchParams={sp} total={count} />
        </>
      )}

      {imports.length ? (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-medium">Recent imports</h2>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">File</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Rows</th>
                  <th className="px-3 py-2 text-right font-medium">New</th>
                  <th className="px-3 py-2 text-right font-medium">Updated</th>
                  <th className="px-3 py-2 text-right font-medium">Duplicates</th>
                  <th className="px-3 py-2 text-right font-medium">Invalid</th>
                  <th className="px-3 py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {imports.map((i) => (
                  <tr key={i.id}>
                    <td className="max-w-48 truncate px-3 py-2">{i.file_name ?? (i.source === "paste" ? "Pasted data" : "—")}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={i.status} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{i.total_rows}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{i.imported_rows}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{i.updated_rows}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{i.duplicate_rows}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{i.invalid_rows}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      <LocalTime iso={i.created_at} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
