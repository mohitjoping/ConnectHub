import { cn } from "@/lib/utils";
import { humanize } from "@/lib/format";

const TONES = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  danger: "bg-red-500/10 text-red-700 dark:text-red-300",
} as const;

const STATUS_TONE: Record<string, keyof typeof TONES> = {
  draft: "neutral",
  scheduled: "info",
  running: "info",
  completed: "success",
  cancelled: "neutral",
  failed: "danger",
  pending: "neutral",
  processing: "info",
  partial: "warning",
  verified: "success",
  rejected: "danger",
  expired: "warning",
  answered: "success",
  voicemail: "success",
  delivered: "success",
  read: "success",
  sent: "info",
  no_answer: "warning",
  busy: "warning",
  skipped_suppressed: "neutral",
  skipped_no_consent: "neutral",
  skipped_invalid: "neutral",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", TONES[STATUS_TONE[status] ?? "neutral"], className)}>
      {humanize(status.replace(/^skipped_/, "skipped: "))}
    </span>
  );
}

export function ChannelBadge({ channel }: { channel: "voice" | "whatsapp" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium",
        channel === "voice" ? "bg-voice/10 text-voice" : "bg-whatsapp/10 text-whatsapp",
      )}
    >
      {channel === "voice" ? "Phone call" : "WhatsApp"}
    </span>
  );
}
