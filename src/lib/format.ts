export function formatNumber(n: number | null | undefined): string {
  return new Intl.NumberFormat("en").format(n ?? 0);
}

export function percent(part: number, total: number): string {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "—";
  const s = Math.round(seconds);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export function contactName(c: { first_name: string | null; last_name: string | null }): string {
  return [c.first_name, c.last_name].filter(Boolean).join(" ");
}

export function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export const PAGE_SIZE = 50;

export function pageParams(searchParams: Record<string, string | string[] | undefined>) {
  const raw = Number(Array.isArray(searchParams.page) ? searchParams.page[0] : searchParams.page);
  const page = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1;
  return { page, from: (page - 1) * PAGE_SIZE, to: page * PAGE_SIZE - 1 };
}

export function param(searchParams: Record<string, string | string[] | undefined>, key: string): string {
  const v = searchParams[key];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}
