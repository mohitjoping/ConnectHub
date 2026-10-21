import type { Metadata } from "next";
import { CampaignFormPage } from "@/components/campaigns/campaign-pages";

export const metadata: Metadata = { title: "New Phone Calls campaign" };

export default function Page() {
  return <CampaignFormPage channel="voice" />;
}
