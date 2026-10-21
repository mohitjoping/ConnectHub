"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ALL = "__all";

export function ContactFilters({ tags }: { tags: { tag: string; count: number }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [, startTransition] = useTransition();

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  };

  // Debounce the search box.
  useEffect(() => {
    if (q === (params.get("q") ?? "")) return;
    const t = setTimeout(() => update("q", q.trim()), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const hasFilters = params.get("q") || params.get("tag") || params.get("consent");

  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone or email" className="pl-8" aria-label="Search contacts" />
      </div>
      <Select value={params.get("tag") || ALL} onValueChange={(v) => update("tag", v === ALL ? "" : v)}>
        <SelectTrigger className="w-full sm:w-44" aria-label="Filter by tag">
          <SelectValue placeholder="All tags" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All tags</SelectItem>
          {tags.map((t) => (
            <SelectItem key={t.tag} value={t.tag}>
              {t.tag} ({t.count})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={params.get("consent") || ALL} onValueChange={(v) => update("consent", v === ALL ? "" : v)}>
        <SelectTrigger className="w-full sm:w-48" aria-label="Filter by consent">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Any consent</SelectItem>
          <SelectItem value="voice">Voice consent</SelectItem>
          <SelectItem value="whatsapp">WhatsApp opt-in</SelectItem>
          <SelectItem value="none">No consent</SelectItem>
        </SelectContent>
      </Select>
      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQ("");
            startTransition(() => router.replace(pathname));
          }}
        >
          <X /> Clear
        </Button>
      ) : null}
    </div>
  );
}
