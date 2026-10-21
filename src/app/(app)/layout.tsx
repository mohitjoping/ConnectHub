import { ModeStrip } from "@/components/mode";
import { MobileNav, Sidebar } from "@/components/nav";
import { getProfile, requireUser } from "@/lib/auth";
import { getAllReadiness } from "@/lib/compliance/readiness";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, userId, email } = await requireUser();
  const [profile, readiness] = await Promise.all([getProfile(), getAllReadiness(supabase, userId)]);
  const user = { name: profile?.full_name || email?.split("@")[0] || "Account", email };

  return (
    <div className="flex min-h-dvh">
      <Sidebar user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-30">
          <ModeStrip voiceLive={readiness.voice.ready} whatsappLive={readiness.whatsapp.ready} />
          <header className="flex h-12 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur lg:hidden">
            <MobileNav user={user} />
            <span className="font-semibold">ConnectHub</span>
          </header>
        </div>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-6 md:py-8">{children}</main>
      </div>
    </div>
  );
}
