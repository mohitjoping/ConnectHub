import type { Metadata } from "next";
import { CampaignDetailPage } from "@/components/campaigns/campaign-pages";

export const metadata: Metadata = { title: "Phone Calls campaign" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  return <CampaignDetailPage channel="voice" id={id} searchParams={sp} />;
}
