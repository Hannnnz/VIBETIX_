-- Storage policies for the public "event-images" bucket.
-- The bucket itself already exists (public, 40 MB, image/jpeg|png|webp).
-- Public read needs no policy because the bucket is public.

-- Only authenticated admins (event organizers) can upload, and only into
-- their own user folder: {user.id}/{uuid}.{ext}
create policy "event_images_insert_admins"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'event-images'
    and public.is_admin()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Only the uploader (first path segment == auth.uid()) can update their file.
create policy "event_images_update_uploader"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'event-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'event-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Only the uploader can delete their file.
create policy "event_images_delete_uploader"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'event-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );