"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** Renders a timestamp in the viewer's own timezone (UTC during SSR). */
export function LocalTime({ iso, mode = "datetime" }: { iso: string | null | undefined; mode?: "datetime" | "date" | "relative" }) {
  const isClient = useSyncExternalStore(subscribe, () => true, () => false);
  if (!iso) return <span className="text-muted-foreground">—</span>;
  const date = new Date(iso);
  const timeZone = isClient ? undefined : "UTC";
  let text: string;
  if (mode === "date") {
    text = date.toLocaleDateString("en", { dateStyle: "medium", timeZone });
  } else if (mode === "relative" && isClient) {
    text = relative(date);
  } else {
    text = date.toLocaleString("en", { dateStyle: "medium", timeStyle: "short", timeZone });
  }
  return (
    <time dateTime={iso} title={date.toISOString()}>
      {text}
    </time>
  );
}

function relative(date: Date): string {
  const diff = (date.getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}
