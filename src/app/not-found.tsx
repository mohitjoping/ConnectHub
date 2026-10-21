import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center px-6 text-center">
      <p className="text-sm text-muted-foreground">404</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">That page or record doesn&apos;t exist, or it belongs to another account.</p>
      <Button className="mt-6" asChild>
        <Link href="/dashboard">Back to overview</Link>
      </Button>
    </div>
  );
}
