"use client";

import { CalendarClock, Copy, FlaskConical, Loader2, Pencil, Play, Radio, Trash2, Undo2, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  cancelCampaign,
  deleteCampaign,
  duplicateCampaign,
  runCampaignNow,
  runDueCampaigns,
  scheduleCampaign,
  unscheduleCampaign,
} from "@/lib/actions/campaigns";
import type { Campaign } from "@/lib/types";

type Result = { ok: boolean; error?: string; message?: string; data?: { id: string } };

function useAction() {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<Result>, after?: (r: Result) => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error ?? "Failed");
      else {
        toast.success(r.message ?? "Done");
        after?.(r);
        router.refresh();
      }
    });
  return { pending, run, router };
}

export function RunDueButton() {
  const { pending, run } = useAction();
  return (
    <Button variant="outline" disabled={pending} onClick={() => run(runDueCampaigns)}>
      {pending ? <Loader2 className="animate-spin" /> : <CalendarClock />} Run due now
    </Button>
  );
}

/** Default to one hour from now, rounded, in the viewer's local time. */
function defaultLocalTime(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CampaignActions({ campaign, basePath, blocked }: { campaign: Campaign; basePath: string; blocked: boolean }) {
  const { pending, run, router } = useAction();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [when, setWhen] = useState(defaultLocalTime);
  const live = campaign.mode === "live";
  const isDraft = campaign.status === "draft";
  const canRun = isDraft || campaign.status === "scheduled";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canRun ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button disabled={pending || blocked} variant={live ? "destructive" : "default"}>
              {pending ? <Loader2 className="animate-spin" /> : live ? <Radio /> : <Play />}
              {live ? "Send live now" : "Run simulation"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                {live ? <Radio className="size-5 text-live" /> : <FlaskConical className="size-5" />}
                {live ? "Send real calls/messages?" : "Run this campaign in simulation?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {live
                  ? "This contacts real people through your live provider and may incur charges. It cannot be undone."
                  : "The mock provider decides each outcome. Nobody is called or messaged, but every attempt is recorded exactly as a live run would be."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => run(() => runCampaignNow(campaign.id))}>{live ? "Send live" : "Run simulation"}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      {isDraft ? (
        <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" disabled={pending || blocked}>
              <CalendarClock /> Schedule
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Schedule campaign</DialogTitle>
              <DialogDescription>
                Times are in your local timezone. Due campaigns run from the cron job (if configured) or when you press &ldquo;Run due now&rdquo; on the campaign list.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="schedule-at">Send at</Label>
              <Input id="schedule-at" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>
            <DialogFooter>
              <Button
                disabled={pending || !when}
                onClick={() => run(() => scheduleCampaign(campaign.id, new Date(when).toISOString()), () => setScheduleOpen(false))}
              >
                {pending ? <Loader2 className="animate-spin" /> : null} Schedule
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {campaign.status === "scheduled" ? (
        <Button variant="outline" disabled={pending} onClick={() => run(() => unscheduleCampaign(campaign.id))}>
          <Undo2 /> Unschedule
        </Button>
      ) : null}

      {isDraft ? (
        <Button variant="outline" asChild>
          <Link href={`${basePath}/${campaign.id}/edit`}>
            <Pencil /> Edit
          </Link>
        </Button>
      ) : null}

      <Button variant="ghost" disabled={pending} onClick={() => run(() => duplicateCampaign(campaign.id), (r) => r.data && router.push(`${basePath}/${r.data.id}`))}>
        <Copy /> Duplicate
      </Button>

      {canRun ? (
        <Button variant="ghost" disabled={pending} onClick={() => run(() => cancelCampaign(campaign.id))}>
          <XCircle /> Cancel
        </Button>
      ) : null}

      {!campaign.started_at ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" className="text-destructive" disabled={pending}>
              <Trash2 /> Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete &ldquo;{campaign.name}&rdquo;?</AlertDialogTitle>
              <AlertDialogDescription>Only campaigns that never ran can be deleted.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep</AlertDialogCancel>
              <AlertDialogAction onClick={() => run(() => deleteCampaign(campaign.id), () => router.push(basePath))}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}
