import type { Metadata } from "next";
import { CampaignFormPage } from "@/components/campaigns/campaign-pages";

export const metadata: Metadata = { title: "New WhatsApp campaign" };

export default function Page() {
  return <CampaignFormPage channel="whatsapp" />;
}
