-- Private storage bucket for CV files, plus object-level policies scoping
-- every object to its owner's own folder. No public read access exists —
-- files are only ever reachable through a signed URL issued server-side
-- after auth.uid() has been verified. public = false and the mime/size
-- limits below are enforced by Supabase Storage itself, as a second line
-- of defense behind the equivalent checks on public.cvs (never trust the
-- client's declared file name, size, or mime type alone).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cvs',
  'cvs',
  false,
  5242880,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do nothing;

-- Object naming convention (enforced by application code, see
-- src/lib/supabase/*): "{auth.uid()}/{unique-upload-id}-{sanitized-name}".
-- The policies below require the first path segment to equal the caller's
-- own auth.uid(), so a user can never read, write, or delete another
-- user's CV object regardless of what path they try to construct.

create policy "cv_objects_select_own"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'cvs'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "cv_objects_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'cvs'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "cv_objects_update_own"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'cvs'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'cvs'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "cv_objects_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'cvs'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- No policy grants access to the anon role: unauthenticated requests can
-- never list, read, write, or delete anything in this bucket.
