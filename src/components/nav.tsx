"use client";

import {
  FileClock,
  History,
  Image as ImageIcon,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Phone,
  ShieldBan,
  ShieldCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { signOut } from "@/lib/actions/auth";
import { cn } from "@/lib/utils";

const CHANNELS = [
  { href: "/calls", label: "Phone Calls", icon: Phone, accent: "text-voice" },
  { href: "/whatsapp", label: "WhatsApp", icon: MessageCircle, accent: "text-whatsapp" },
];

const SHARED = [
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/media", label: "Media library", icon: ImageIcon },
  { href: "/history", label: "Campaign history", icon: History },
];

const GOVERNANCE = [
  { href: "/suppression", label: "Suppression list", icon: ShieldBan },
  { href: "/compliance", label: "Compliance", icon: ShieldCheck },
  { href: "/audit", label: "Audit log", icon: FileClock },
];

function NavLink({ href, label, icon: Icon, accent, onNavigate }: { href: string; label: string; icon: typeof Phone; accent?: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
        active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
      )}
    >
      <Icon className={cn("size-4 shrink-0", accent)} />
      {label}
    </Link>
  );
}

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      {title ? <p className="px-2.5 pt-4 pb-1 text-[0.7rem] font-medium tracking-wider text-muted-foreground uppercase">{title}</p> : null}
      {children}
    </div>
  );
}

function NavBody({ onNavigate, user }: { onNavigate?: () => void; user: { name: string; email: string | null } }) {
  return (
    <div className="flex h-full flex-col">
      <Link href="/dashboard" onClick={onNavigate} className="flex items-center gap-2 px-2.5 py-1">
        <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
          <span className="text-xs font-bold">CH</span>
        </span>
        <span className="font-semibold tracking-tight">ConnectHub</span>
      </Link>
      <nav className="mt-4 flex-1 overflow-y-auto">
        <Section>
          <NavLink href="/dashboard" label="Overview" icon={LayoutDashboard} onNavigate={onNavigate} />
        </Section>
        <Section title="Channels">
          {CHANNELS.map((item) => (
            <NavLink key={item.href} {...item} onNavigate={onNavigate} />
          ))}
        </Section>
        <Section title="Shared">
          {SHARED.map((item) => (
            <NavLink key={item.href} {...item} onNavigate={onNavigate} />
          ))}
        </Section>
        <Section title="Governance">
          {GOVERNANCE.map((item) => (
            <NavLink key={item.href} {...item} onNavigate={onNavigate} />
          ))}
        </Section>
      </nav>
      <div className="mt-4 border-t pt-3">
        <div className="px-2.5 pb-2">
          <p className="truncate text-sm font-medium">{user.name}</p>
          {user.email ? <p className="truncate text-xs text-muted-foreground">{user.email}</p> : null}
        </div>
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="sm" className="w-full justify-start text-muted-foreground">
            <LogOut /> Sign out
          </Button>
        </form>
      </div>
    </div>
  );
}

export function Sidebar({ user }: { user: { name: string; email: string | null } }) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r bg-sidebar p-3 lg:block">
      <NavBody user={user} />
    </aside>
  );
}

export function MobileNav({ user }: { user: { name: string; email: string | null } }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 bg-sidebar p-3">
        <SheetHeader className="sr-only">
          <SheetTitle>Navigation</SheetTitle>
        </SheetHeader>
        <NavBody user={user} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
