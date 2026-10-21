import type { Metadata } from "next";
import { CampaignList } from "@/components/campaigns/campaign-list";

export const metadata: Metadata = { title: "WhatsApp" };

export default function Page() {
  return <CampaignList channel="whatsapp" />;
}
