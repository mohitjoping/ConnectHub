"use client";

import { Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { registerMedia } from "@/lib/actions/media";
import { buildStoragePath, MEDIA_BUCKET, MEDIA_RULES, validateMedia } from "@/lib/media/rules";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const ACCEPT = Object.values(MEDIA_RULES)
  .flatMap((r) => [...r.mimeTypes, ...r.extensions])
  .join(",");

/** Read duration/dimensions in the browser so the server can enforce limits. */
function readMetadata(file: File): Promise<{ durationSeconds: number | null; width: number | null; height: number | null }> {
  const url = URL.createObjectURL(file);
  const done = <T,>(value: T) => {
    URL.revokeObjectURL(url);
    return value;
  };
  return new Promise((resolve) => {
    const fallback = { durationSeconds: null, width: null, height: null };
    const timer = setTimeout(() => resolve(done(fallback)), 8000);
    if (file.type.startsWith("image/")) {
      const img = new Image();
      img.onload = () => {
        clearTimeout(timer);
        resolve(done({ durationSeconds: null, width: img.naturalWidth, height: img.naturalHeight }));
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve(done(fallback));
      };
      img.src = url;
      return;
    }
    const el = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      clearTimeout(timer);
      const video = el as HTMLVideoElement;
      resolve(
        done({
          durationSeconds: Number.isFinite(el.duration) ? Math.round(el.duration * 100) / 100 : null,
          width: video.videoWidth || null,
          height: video.videoHeight || null,
        }),
      );
    };
    el.onerror = () => {
      clearTimeout(timer);
      resolve(done(fallback));
    };
    el.src = url;
  });
}

export function MediaUploader({ userId }: { userId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<{ name: string; progress: number }[]>([]);
  const [dragging, setDragging] = useState(false);
  const busy = queue.length > 0;

  const upload = async (files: File[]) => {
    const supabase = createClient();
    setQueue(files.map((f) => ({ name: f.name, progress: 0 })));
    for (const [index, file] of files.entries()) {
      const tick = (progress: number) => setQueue((q) => q.map((item, i) => (i === index ? { ...item, progress } : item)));
      const meta = await readMetadata(file);
      const check = validateMedia({ fileName: file.name, mimeType: file.type, sizeBytes: file.size, durationSeconds: meta.durationSeconds });
      if (!check.ok) {
        toast.error(`${file.name}: ${check.error}`);
        tick(100);
        continue;
      }
      tick(30);
      const path = buildStoragePath(userId, check.kind, file.name, crypto.randomUUID());
      const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, file, { contentType: file.type, upsert: false, cacheControl: "3600" });
      if (error) {
        toast.error(`${file.name}: ${error.message}`);
        tick(100);
        continue;
      }
      tick(80);
      const result = await registerMedia({ storagePath: path, fileName: file.name, mimeType: file.type, sizeBytes: file.size, ...meta });
      if (result.ok) toast.success(`${file.name} uploaded`);
      else toast.error(`${file.name}: ${result.error}`);
      tick(100);
    }
    setQueue([]);
  };

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy) upload([...e.dataTransfer.files]);
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors disabled:opacity-60",
          dragging ? "border-primary bg-muted" : "hover:bg-muted/50",
        )}
      >
        {busy ? <Loader2 className="mb-2 size-5 animate-spin" /> : <Upload className="mb-2 size-5 text-muted-foreground" />}
        <span className="font-medium">Drop files or click to upload</span>
        <span className="mt-1 max-w-xl text-xs text-muted-foreground">
          {Object.values(MEDIA_RULES)
            .map((r) => `${r.label}: ${r.extensions.join(" ")} ≤ ${r.maxBytes / 1024 / 1024} MB`)
            .join(" · ")}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) upload(files);
        }}
      />
      {queue.length ? (
        <ul className="mt-3 space-y-2">
          {queue.map((q) => (
            <li key={q.name} className="flex items-center gap-3 text-sm">
              <span className="w-48 truncate">{q.name}</span>
              <Progress value={q.progress} className="flex-1" />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
