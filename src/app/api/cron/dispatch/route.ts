import { NextResponse, type NextRequest } from "next/server";
import { dispatchDueCampaigns } from "@/lib/campaigns/engine";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Runs scheduled campaigns that are due, for every user. Called by Vercel
 * Cron (see vercel.json), which sends `Authorization: Bearer $CRON_SECRET`.
 * Live/simulation is decided per campaign by the same gate as manual runs.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured" }, { status: 503 });
  }
  const results = await dispatchDueCampaigns(admin, null, null, 10);
  return NextResponse.json({ ran: results.length, results });
}
