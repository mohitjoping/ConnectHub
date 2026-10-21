import { ExternalLink, Image as ImageIcon, PlayCircle, Reply } from "lucide-react";
import { renderTemplate } from "@/lib/campaigns/logic";
import type { WhatsAppTemplate } from "@/lib/providers/types";

/** Approximation of how a template message renders in the WhatsApp app. */
export function WhatsAppPreview({
  template,
  params,
  mediaUrl,
  mediaKind,
}: {
  template: WhatsAppTemplate | null;
  params: string[];
  mediaUrl?: string | null;
  mediaKind?: "image" | "video" | null;
}) {
  return (
    <div className="mx-auto w-full max-w-[300px] rounded-[2rem] border-8 border-zinc-900 bg-[#efeae2] shadow-xl dark:border-zinc-700 dark:bg-[#0b141a]">
      <div className="rounded-t-[1.4rem] bg-[#075e54] px-4 py-3 text-sm font-medium text-white">Your Business</div>
      <div className="min-h-72 p-3">
        {template ? (
          <div className="max-w-[92%] overflow-hidden rounded-lg rounded-tl-none bg-white text-[13px] text-zinc-900 shadow-sm dark:bg-[#202c33] dark:text-zinc-100">
            {template.headerType === "IMAGE" || template.headerType === "VIDEO" ? (
              mediaUrl ? (
                mediaKind === "video" ? (
                  <div className="relative">
                    <video src={mediaUrl} className="aspect-video w-full bg-black object-cover" muted preload="metadata" />
                    <PlayCircle className="absolute inset-0 m-auto size-10 text-white/90" />
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
                  <img src={mediaUrl} alt="" className="aspect-video w-full object-cover" />
                )
              ) : (
                <div className="grid aspect-video place-items-center bg-zinc-200 text-xs text-zinc-500 dark:bg-zinc-800">
                  <span className="flex items-center gap-1">
                    <ImageIcon className="size-4" /> {template.headerType.toLowerCase()} header required
                  </span>
                </div>
              )
            ) : null}
            <div className="space-y-1 px-2.5 pt-2 pb-1">
              {template.headerType === "TEXT" && template.headerText ? <p className="font-semibold">{template.headerText}</p> : null}
              <p className="whitespace-pre-wrap">{renderTemplate(template.body, params)}</p>
              {template.footer ? <p className="text-[11px] text-zinc-500">{template.footer}</p> : null}
              <p className="text-right text-[10px] text-zinc-400">12:00</p>
            </div>
            {template.buttons?.length ? (
              <div className="divide-y border-t text-center text-[13px] text-[#00a5f4] dark:border-zinc-700">
                {template.buttons.map((b) => (
                  <p key={b.text} className="flex items-center justify-center gap-1 py-1.5">
                    {b.type === "URL" ? <ExternalLink className="size-3.5" /> : <Reply className="size-3.5" />}
                    {b.text}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="pt-20 text-center text-xs text-zinc-500">Pick a template to preview it</p>
        )}
      </div>
    </div>
  );
}
