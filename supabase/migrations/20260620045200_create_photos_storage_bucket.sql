-- Dev Social — Storage bucket for submitted photos.
--
-- The bucket is public-read (photos are served by public URL). Uploads happen
-- server-side with the service_role key, which bypasses Storage RLS, so no
-- insert or select policy is required — a public bucket already serves reads.
-- (This mirrors the live project, which has the public bucket and no extra
-- storage.objects policies.)

insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do update set public = excluded.public;
