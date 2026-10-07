-- Owner-scoped write policies for the photo/receipt buckets.
--
-- Authenticated users were getting 403 ("new row violates row-level security
-- policy") uploading to property-photos / profile-photos / receipts because the
-- buckets had SELECT (and public-read) policies but no INSERT/UPDATE/DELETE
-- policies. wallet-documents already has owner policies and is untouched.
-- maintenance_receipts has no client-side write path and is untouched.
--
-- Scope: every client write path stores objects under "<auth.uid()>/..."
--   property-photos  : {uid}/{property_id}.jpg            (upsert => INSERT + UPDATE)
--   profile-photos   : {uid}/{family_member_id}.jpg       (upsert => INSERT + UPDATE)
--   receipts         : {uid}/vehicle/{vehicle_id}/{ts}.jpg (insert only)
-- so each policy is restricted to the first path segment matching auth.uid().
-- Existing SELECT / public-read behaviour is intentionally not modified here.
--
-- Idempotent: each policy is created only if a policy of that name does not
-- already exist on storage.objects.

do $$
declare
  b text;
  pol text;
begin
  foreach b in array array['property-photos', 'profile-photos', 'receipts'] loop

    pol := b || ' owner insert';
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = pol) then
      execute format(
        'create policy %I on storage.objects for insert to authenticated with check (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text)',
        pol, b);
    end if;

    pol := b || ' owner update';
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = pol) then
      execute format(
        'create policy %I on storage.objects for update to authenticated using (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text)',
        pol, b, b);
    end if;

    pol := b || ' owner delete';
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = pol) then
      execute format(
        'create policy %I on storage.objects for delete to authenticated using (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text)',
        pol, b);
    end if;

  end loop;
end $$;
