-- Private bucket for uploaded media. Files live at <owner_id>/<kind>/<uuid>-<name>.
-- Size and MIME limits are enforced by Storage itself and again in the app
-- (src/lib/media/rules.ts).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media',
  'media',
  false,
  52428800, -- 50 MB hard ceiling; per-kind limits are stricter in the app
  array[
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/ogg', 'audio/aac', 'audio/mp4', 'audio/x-m4a',
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/3gpp'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "media: owner read" on storage.objects
  for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "media: owner upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "media: owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "media: owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
