import type { Metadata } from "next";
import { CampaignFormPage } from "@/components/campaigns/campaign-pages";

export const metadata: Metadata = { title: "Edit WhatsApp campaign" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CampaignFormPage channel="whatsapp" id={id} />;
}
