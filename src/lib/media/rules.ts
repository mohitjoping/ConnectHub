// Upload rules per media kind. The storage bucket enforces a 50 MB ceiling and
// a MIME allow-list (supabase/migrations/..._storage.sql); these are stricter
// and match what voice providers and the WhatsApp Cloud API accept.

export type MediaKind = "audio" | "image" | "video";

export interface MediaRule {
  kind: MediaKind;
  label: string;
  mimeTypes: string[];
  extensions: string[];
  maxBytes: number;
  maxDurationSeconds?: number;
  note: string;
}

const MB = 1024 * 1024;

export const MEDIA_RULES: Record<MediaKind, MediaRule> = {
  audio: {
    kind: "audio",
    label: "Audio",
    mimeTypes: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/ogg", "audio/aac", "audio/mp4", "audio/x-m4a"],
    extensions: [".mp3", ".wav", ".ogg", ".aac", ".m4a"],
    maxBytes: 10 * MB,
    maxDurationSeconds: 300,
    note: "Voice campaign messages. MP3 or WAV, up to 10 MB and 5 minutes.",
  },
  image: {
    kind: "image",
    label: "Image",
    mimeTypes: ["image/jpeg", "image/png", "image/webp"],
    extensions: [".jpg", ".jpeg", ".png", ".webp"],
    maxBytes: 5 * MB,
    note: "WhatsApp image headers. JPEG or PNG, up to 5 MB.",
  },
  video: {
    kind: "video",
    label: "Video",
    mimeTypes: ["video/mp4", "video/3gpp"],
    extensions: [".mp4", ".3gp"],
    maxBytes: 16 * MB,
    note: "WhatsApp video headers. MP4 (H.264 + AAC), up to 16 MB.",
  },
};

export const MEDIA_BUCKET = "media";

export function extensionOf(fileName: string): string {
  const match = /\.[^.]+$/.exec(fileName.toLowerCase());
  return match ? match[0] : "";
}

export function kindForMime(mime: string): MediaKind | null {
  for (const rule of Object.values(MEDIA_RULES)) {
    if (rule.mimeTypes.includes(mime)) return rule.kind;
  }
  return null;
}

export interface MediaCheckInput {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number | null;
}

export type MediaCheck = { ok: true; kind: MediaKind } | { ok: false; error: string };

export function validateMedia(input: MediaCheckInput, expectedKind?: MediaKind): MediaCheck {
  const kind = kindForMime(input.mimeType);
  if (!kind) return { ok: false, error: `Unsupported file type "${input.mimeType || "unknown"}"` };
  if (expectedKind && kind !== expectedKind) {
    return { ok: false, error: `Expected ${MEDIA_RULES[expectedKind].label.toLowerCase()}, got ${kind}` };
  }
  const rule = MEDIA_RULES[kind];
  if (!rule.extensions.includes(extensionOf(input.fileName))) {
    return { ok: false, error: `File extension must be one of ${rule.extensions.join(", ")}` };
  }
  if (input.sizeBytes <= 0) return { ok: false, error: "File is empty" };
  if (input.sizeBytes > rule.maxBytes) {
    return { ok: false, error: `${rule.label} must be ${rule.maxBytes / MB} MB or smaller` };
  }
  if (rule.maxDurationSeconds && input.durationSeconds && input.durationSeconds > rule.maxDurationSeconds) {
    return { ok: false, error: `${rule.label} must be ${rule.maxDurationSeconds / 60} minutes or shorter` };
  }
  return { ok: true, kind };
}

/** <owner>/<kind>/<uuid>-<safe-name> — the first segment is enforced by RLS. */
export function buildStoragePath(ownerId: string, kind: MediaKind, fileName: string, id: string): string {
  const ext = extensionOf(fileName);
  const base = fileName
    .slice(0, fileName.length - ext.length)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "file";
  return `${ownerId}/${kind}/${id}-${base}${ext}`;
}

export function isPathOwnedBy(path: string, ownerId: string): boolean {
  const parts = path.split("/");
  return parts.length === 3 && parts[0] === ownerId && parts[1] in MEDIA_RULES && !path.includes("..");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}
