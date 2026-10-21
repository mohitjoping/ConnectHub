import { FlaskConical, Radio, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { DeliveryMode } from "@/lib/providers/types";

/** The one badge used everywhere a campaign, attempt or channel shows its mode. */
export function ModeBadge({ mode, className, size = "default" }: { mode: DeliveryMode; className?: string; size?: "default" | "lg" }) {
  const live = mode === "live";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-semibold tracking-wide uppercase",
        size === "lg" ? "px-3 py-1 text-xs" : "px-2 py-0.5 text-[0.65rem]",
        live ? "bg-live text-live-foreground" : "bg-sim text-sim-foreground ring-1 ring-sim-foreground/20 ring-inset",
        className,
      )}
    >
      {live ? <Radio className="size-3" /> : <FlaskConical className="size-3" />}
      {live ? "Live" : "Simulation"}
    </span>
  );
}

/** Site-wide strip: which channels could go live right now. */
export function ModeStrip({ voiceLive, whatsappLive }: { voiceLive: boolean; whatsappLive: boolean }) {
  const anyLive = voiceLive || whatsappLive;
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5 text-xs md:px-6",
        anyLive ? "bg-live text-live-foreground" : "bg-sim text-sim-foreground",
      )}
    >
      <span className="flex items-center gap-1.5 font-medium">
        {anyLive ? <Radio className="size-3.5" /> : <FlaskConical className="size-3.5" />}
        {anyLive ? "Live delivery is unlocked for at least one channel — real calls/messages can be sent." : "Simulation mode — no real calls or WhatsApp messages are sent."}
      </span>
      <span className="flex items-center gap-3 opacity-90">
        <span>Phone Calls: <strong>{voiceLive ? "LIVE-READY" : "SIMULATION"}</strong></span>
        <span>WhatsApp: <strong>{whatsappLive ? "LIVE-READY" : "SIMULATION"}</strong></span>
        <Link href="/compliance" className="inline-flex items-center gap-1 underline underline-offset-2">
          <ShieldCheck className="size-3.5" />
          Live readiness
        </Link>
      </span>
    </div>
  );
}
