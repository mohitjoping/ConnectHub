"use client";

import { FileAudio, Loader2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { LocalTime } from "@/components/local-time";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { deleteMedia } from "@/lib/actions/media";
import { formatDuration } from "@/lib/format";
import { formatBytes, type MediaKind } from "@/lib/media/rules";
import type { MediaAsset } from "@/lib/types";
import { cn } from "@/lib/utils";

const TABS: { key: MediaKind | ""; label: string }[] = [
  { key: "", label: "All" },
  { key: "audio", label: "Audio" },
  { key: "image", label: "Images" },
  { key: "video", label: "Videos" },
];

function Preview({ asset, url }: { asset: MediaAsset; url?: string }) {
  if (!url) return <div className="grid h-40 place-items-center bg-muted text-xs text-muted-foreground">Preview unavailable</div>;
  if (asset.kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element -- signed URL from private storage
    return <img src={url} alt={asset.file_name} className="h-40 w-full bg-muted object-contain" loading="lazy" />;
  }
  if (asset.kind === "video") return <video src={url} controls preload="metadata" className="h-40 w-full bg-black object-contain" />;
  return (
    <div className="flex h-40 flex-col justify-center gap-3 bg-muted/60 px-3">
      <FileAudio className="mx-auto size-8 text-voice" />
      <audio src={url} controls preload="none" className="w-full" />
    </div>
  );
}

function DeleteButton({ asset }: { asset: MediaAsset }) {
  const [pending, start] = useTransition();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${asset.file_name}`}>
          {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {asset.file_name}?</AlertDialogTitle>
          <AlertDialogDescription>The file is removed from storage. Draft campaigns using it will need a new file.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              start(async () => {
                const r = await deleteMedia(asset.id);
                if (r.ok) toast.success(r.message);
                else toast.error(r.error);
              })
            }
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function MediaGrid({ assets, urls, kind }: { assets: MediaAsset[]; urls: Record<string, string>; kind: MediaKind | "" }) {
  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {TABS.map((t) => (
          <Button key={t.key} size="sm" variant={kind === t.key ? "secondary" : "ghost"} asChild>
            <Link href={t.key ? `/media?kind=${t.key}` : "/media"}>{t.label}</Link>
          </Button>
        ))}
      </div>
      {assets.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No {kind} files yet.</p> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {assets.map((asset) => (
          <div key={asset.id} className="overflow-hidden rounded-xl border bg-card">
            <Preview asset={asset} url={urls[asset.storage_path]} />
            <div className="flex items-start justify-between gap-2 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium" title={asset.file_name}>
                  {asset.file_name}
                </p>
                <p className="text-xs text-muted-foreground">
                  <span className={cn("capitalize", asset.kind === "audio" ? "text-voice" : "text-whatsapp")}>{asset.kind}</span> · {formatBytes(asset.size_bytes)}
                  {asset.duration_seconds ? ` · ${formatDuration(asset.duration_seconds)}` : ""}
                  {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  <LocalTime iso={asset.created_at} mode="date" />
                </p>
              </div>
              <DeleteButton asset={asset} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
