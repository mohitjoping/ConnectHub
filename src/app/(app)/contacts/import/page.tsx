import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { defaultPhoneCountry } from "@/lib/env";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Import contacts" };

export default async function ImportPage() {
  await requireUser();
  return (
    <>
      <PageHeader
        title="Import contacts"
        description="Upload CSV or Excel, or paste straight from a spreadsheet. Columns are detected automatically; you confirm the mapping and review every problem before anything is saved."
        actions={
          <Button variant="ghost" asChild>
            <Link href="/contacts">
              <ArrowLeft /> Back to contacts
            </Link>
          </Button>
        }
      />
      <ImportWizard defaultCountry={defaultPhoneCountry} />
    </>
  );
}
