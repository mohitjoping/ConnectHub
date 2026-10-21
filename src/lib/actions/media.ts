"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { isPathOwnedBy, MEDIA_BUCKET, validateMedia } from "@/lib/media/rules";
import type { ActionResult } from "@/lib/types";
import { dbError, withSession, zodMessage } from "./helpers";

const registerInput = z.object({
  storagePath: z.string().min(3).max(300),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().max(100),
  sizeBytes: z.number().int().positive(),
  durationSeconds: z.number().positive().max(36000).nullable(),
  width: z.number().int().positive().max(20000).nullable(),
  height: z.number().int().positive().max(20000).nullable(),
});

/**
 * The browser uploads straight to the private bucket (RLS restricts it to the
 * user's folder); this records the metadata after checking the stored object
 * really exists and matches what the client claimed.
 */
export async function registerMedia(input: z.input<typeof registerInput>): Promise<ActionResult<{ id: string }>> {
  return withSession(async ({ supabase, userId }) => {
    const parsed = registerInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: zodMessage(parsed.error.issues) };
    const v = parsed.data;
    if (!isPathOwnedBy(v.storagePath, userId)) return { ok: false, error: "Invalid storage path" };

    const [folderOwner, kindFolder, objectName] = v.storagePath.split("/");
    const { data: listing, error: listError } = await supabase.storage
      .from(MEDIA_BUCKET)
      .list(`${folderOwner}/${kindFolder}`, { search: objectName, limit: 5 });
    const stored = listing?.find((o) => o.name === objectName);
    if (listError || !stored) return { ok: false, error: "Upload not found in storage" };

    const storedSize = Number(stored.metadata?.size ?? v.sizeBytes);
    const storedMime = String(stored.metadata?.mimetype ?? v.mimeType);
    const check = validateMedia({ fileName: v.fileName, mimeType: storedMime, sizeBytes: storedSize, durationSeconds: v.durationSeconds });
    if (!check.ok || check.kind !== kindFolder) {
      await supabase.storage.from(MEDIA_BUCKET).remove([v.storagePath]);
      return { ok: false, error: check.ok ? "File type does not match its folder" : check.error };
    }

    const { data, error } = await supabase
      .from("media_assets")
      .insert({
        owner_id: userId,
        kind: check.kind,
        file_name: v.fileName,
        storage_path: v.storagePath,
        mime_type: storedMime,
        size_bytes: storedSize,
        duration_seconds: v.durationSeconds,
        width: v.width,
        height: v.height,
      })
      .select("id")
      .single();
    if (error) return dbError(error);

    await writeAudit(supabase, {
      ownerId: userId,
      actorId: userId,
      action: "media.uploaded",
      entityType: "media_asset",
      entityId: data.id,
      metadata: { kind: check.kind, file: v.fileName, bytes: storedSize },
    });
    revalidatePath("/media");
    return { ok: true, data: { id: data.id }, message: "Uploaded" };
  });
}

export async function deleteMedia(id: string): Promise<ActionResult> {
  return withSession(async ({ supabase, userId }) => {
    if (!z.uuid().safeParse(id).success) return { ok: false, error: "Invalid id" };
    const { data: asset } = await supabase.from("media_assets").select("id, storage_path, file_name").eq("id", id).maybeSingle();
    if (!asset) return { ok: false, error: "Media not found" };

    // Sent campaigns keep a reference for their history; drafts just lose it.
    const { data: inUse } = await supabase
      .from("campaigns")
      .select("name")
      .eq("media_asset_id", id)
      .neq("status", "draft")
      .limit(1);
    if (inUse?.length) return { ok: false, error: `Used by campaign "${inUse[0].name}". Media of scheduled or sent campaigns can't be deleted.` };

    const { error } = await supabase.from("media_assets").delete().eq("id", id);
    if (error) return dbError(error);
    await supabase.storage.from(MEDIA_BUCKET).remove([asset.storage_path]);
    await writeAudit(supabase, { ownerId: userId, actorId: userId, action: "media.deleted", entityType: "media_asset", entityId: id, metadata: { file: asset.file_name } });
    revalidatePath("/media");
    return { ok: true, message: "Deleted" };
  });
}
