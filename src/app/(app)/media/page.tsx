import type { Metadata } from "next";
import { Image as ImageIcon } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page";
import { requireUser } from "@/lib/auth";
import { param } from "@/lib/format";
import { MEDIA_BUCKET, MEDIA_RULES, type MediaKind } from "@/lib/media/rules";
import type { MediaAsset } from "@/lib/types";
import { MediaGrid } from "./media-grid";
import { MediaUploader } from "./media-uploader";

export const metadata: Metadata = { title: "Media library" };

export default async function MediaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const kind = param(sp, "kind") as MediaKind | "";
  const { supabase, userId } = await requireUser();

  let query = supabase.from("media_assets").select("*").eq("owner_id", userId).order("created_at", { ascending: false }).limit(200);
  if (kind && kind in MEDIA_RULES) query = query.eq("kind", kind);
  const { data } = await query;
  const assets = (data ?? []) as MediaAsset[];

  // Private bucket: previews use short-lived signed URLs.
  const urls: Record<string, string> = {};
  if (assets.length) {
    const { data: signed } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrls(assets.map((a) => a.storage_path), 60 * 60);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls[s.path] = s.signedUrl;
  }

  return (
    <>
      <PageHeader
        title="Media library"
        description="Audio for phone calls; images and videos for WhatsApp template headers. Files are stored in a private bucket only you can read."
      />
      <MediaUploader userId={userId} />
      <div className="mt-8">
        {assets.length === 0 && !kind ? (
          <EmptyState icon={ImageIcon} title="No media yet" description="Upload an MP3 for a call campaign or an image/video for WhatsApp." />
        ) : (
          <MediaGrid assets={assets} urls={urls} kind={kind} />
        )}
      </div>
    </>
  );
}
