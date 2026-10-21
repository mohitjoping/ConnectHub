import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1">
        {eyebrow ? <div className="flex flex-wrap items-center gap-2">{eyebrow}</div> : null}
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {description ? <p className="max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center", className)}>
      <div className="mb-3 rounded-full bg-muted p-3">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <p className="font-medium">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  tone?: "voice" | "whatsapp";
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        {Icon ? <Icon className={cn("size-4 text-muted-foreground", tone === "voice" && "text-voice", tone === "whatsapp" && "text-whatsapp")} /> : null}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Prev/next pagination that preserves the other search params. */
export function Pager({
  page,
  hasMore,
  basePath,
  searchParams,
  total,
}: {
  page: number;
  hasMore: boolean;
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
  total?: number | null;
}) {
  const href = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (k !== "page" && typeof v === "string" && v) params.set(k, v);
    }
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  if (page === 1 && !hasMore) return total != null ? <p className="mt-3 text-xs text-muted-foreground">{total} total</p> : null;
  return (
    <div className="mt-4 flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">
        Page {page}
        {total != null ? ` · ${total} total` : ""}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" asChild disabled={page <= 1}>
          {page > 1 ? (
            <Link href={href(page - 1)}>
              <ChevronLeft /> Previous
            </Link>
          ) : (
            <span aria-disabled className="pointer-events-none opacity-50">
              <ChevronLeft /> Previous
            </span>
          )}
        </Button>
        <Button variant="outline" size="sm" asChild>
          {hasMore ? (
            <Link href={href(page + 1)}>
              Next <ChevronRight />
            </Link>
          ) : (
            <span aria-disabled className="pointer-events-none opacity-50">
              Next <ChevronRight />
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}
