-- Group 3: atomic delete-account.
-- Adds prepare_user_account_deletion + purge_user_storage_objects RPCs and
-- failed_rc_deletions + failed_storage_deletions audit tables.
--
-- Edge function order:
--   1. prepare_user_account_deletion (fetches RC customer ID)
--   2. auth.admin.deleteUser (cascades 32+ user-owned tables atomically)
--   3. purge_user_storage_objects (deletes storage.objects rows by prefix)
--   4. best-effort RC REST DELETE with 8s timeout per target
--
-- Storage purge runs AFTER auth delete to close the race window where a
-- still-valid JWT could create new objects between purge and auth delete.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- failed_rc_deletions: audit table for RC REST DELETE failures (best-effort)
-- =============================================================================
-- Intentionally no FK to auth.users: row must survive auth user deletion so
-- nightly RC cleanup sweep can retry. No unique index — duplicates are
-- acceptable; missing rows are not. Sweep job will dedupe at retry time.

CREATE TABLE IF NOT EXISTS public.failed_rc_deletions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL,
  rc_app_user_id  text        NOT NULL,
  failure_kind    text        NOT NULL,
  status_code     int         NULL,
  response_body   text        NULL,
  attempt_count   int         NOT NULL DEFAULT 1,
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_failed_rc_deletions_unresolved
  ON public.failed_rc_deletions (resolved_at, last_attempt_at)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_failed_rc_deletions_rc_id
  ON public.failed_rc_deletions (rc_app_user_id);

ALTER TABLE public.failed_rc_deletions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.failed_rc_deletions FROM PUBLIC;
REVOKE ALL ON TABLE public.failed_rc_deletions FROM anon;
REVOKE ALL ON TABLE public.failed_rc_deletions FROM authenticated;
GRANT ALL ON TABLE public.failed_rc_deletions TO service_role;

-- =============================================================================
-- failed_storage_deletions: audit table for Storage purge RPC failures
-- =============================================================================
-- Same shape as failed_rc_deletions. No FK to auth.users (row must survive).
-- No unique index. Used by ops sweep to retry orphaned Storage cleanup.

CREATE TABLE IF NOT EXISTS public.failed_storage_deletions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL,
  failure_kind    text        NOT NULL,
  response_body   text        NULL,
  attempt_count   int         NOT NULL DEFAULT 1,
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_failed_storage_deletions_unresolved
  ON public.failed_storage_deletions (resolved_at, last_attempt_at)
  WHERE resolved_at IS NULL;

ALTER TABLE public.failed_storage_deletions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.failed_storage_deletions FROM PUBLIC;
REVOKE ALL ON TABLE public.failed_storage_deletions FROM anon;
REVOKE ALL ON TABLE public.failed_storage_deletions FROM authenticated;
GRANT ALL ON TABLE public.failed_storage_deletions TO service_role;

-- =============================================================================
-- prepare_user_account_deletion RPC
-- =============================================================================
-- Pre-fetches the RC customer ID before profiles cascades away during the
-- auth user delete that follows. Service-role only.

CREATE OR REPLACE FUNCTION public.prepare_user_account_deletion(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_rc_customer_id text;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  select revenuecat_customer_id
    into v_rc_customer_id
    from public.profiles
   where user_id = p_user_id
   limit 1;

  return jsonb_build_object(
    'revenuecat_customer_id', v_rc_customer_id
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.prepare_user_account_deletion(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prepare_user_account_deletion(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.prepare_user_account_deletion(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_user_account_deletion(uuid) TO service_role;

-- =============================================================================
-- purge_user_storage_objects RPC
-- =============================================================================
-- Deletes all storage.objects rows under {userId}/ prefix in the four
-- user-owned buckets. MUST run AFTER auth.admin.deleteUser so a still-valid
-- JWT cannot create new objects between purge and auth delete.

CREATE OR REPLACE FUNCTION public.purge_user_storage_objects(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_wallet_count   int := 0;
  v_receipts_count int := 0;
  v_property_count int := 0;
  v_profile_count  int := 0;
  v_prefix         text;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  v_prefix := p_user_id::text || '/';

  with deleted as (
    delete from storage.objects
     where bucket_id = 'wallet-documents'
       and starts_with(name, v_prefix)
    returning 1
  )
  select count(*) into v_wallet_count from deleted;

  with deleted as (
    delete from storage.objects
     where bucket_id = 'receipts'
       and starts_with(name, v_prefix)
    returning 1
  )
  select count(*) into v_receipts_count from deleted;

  with deleted as (
    delete from storage.objects
     where bucket_id = 'property-photos'
       and starts_with(name, v_prefix)
    returning 1
  )
  select count(*) into v_property_count from deleted;

  with deleted as (
    delete from storage.objects
     where bucket_id = 'profile-photos'
       and starts_with(name, v_prefix)
    returning 1
  )
  select count(*) into v_profile_count from deleted;

  return jsonb_build_object(
    'wallet_documents', v_wallet_count,
    'receipts',         v_receipts_count,
    'property_photos',  v_property_count,
    'profile_photos',   v_profile_count
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.purge_user_storage_objects(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_user_storage_objects(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.purge_user_storage_objects(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_user_storage_objects(uuid) TO service_role;

COMMIT;
