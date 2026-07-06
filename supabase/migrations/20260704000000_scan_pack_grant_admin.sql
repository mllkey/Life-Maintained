-- 20260704000000_scan_pack_grant_admin.sql
--
-- Trunk 4 P2a — durable scan-pack grant support.
-- 1) grant_scan_pack_credits (client, REPLACE): derive the grant size from p_source
--    server-side and ignore any caller-supplied count, so a fabricated/buggy
--    scans_granted can't inflate a grant. Caller (authenticated) binding unchanged.
-- 2) grant_scan_pack_credits_admin (NEW): service-role-only grant path for the
--    RevenueCat webhook (which runs as service_role and cannot satisfy auth.uid()).
--    Same source-derived amount + idempotent insert on transaction_id.
-- Both keep exact existing signatures; CREATE OR REPLACE preserves grants, but they are
-- re-asserted below for clarity. Reviewed by two independent instances; no open blockers.

-- 1) CLIENT grant — source-derived scans
CREATE OR REPLACE FUNCTION public.grant_scan_pack_credits(
  p_user_id uuid, p_source text, p_transaction_id text, p_scans_granted integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare v_user_id uuid; v_existing record; v_inserted record; v_scans int;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_user_id is distinct from v_user_id then raise exception 'Forbidden'; end if;

  -- Server-derived grant size. p_scans_granted is retained for signature compatibility
  -- but intentionally unused — the amount is fixed by the pack source.
  v_scans := case p_source when 'pack_10' then 10 when 'pack_25' then 25 else null end;
  if v_scans is null then return jsonb_build_object('error', 'invalid_source'); end if;
  if p_transaction_id is null or length(p_transaction_id) = 0 then
    return jsonb_build_object('error', 'invalid_transaction_id');
  end if;

  insert into public.scan_credits (user_id, source, transaction_id, scans_granted)
  values (p_user_id, p_source, p_transaction_id, v_scans)
  on conflict (transaction_id) do nothing
  returning id, scans_granted into v_inserted;

  if v_inserted.id is not null then
    return jsonb_build_object('ok', true, 'idempotent', false, 'credits_granted', v_inserted.scans_granted);
  end if;

  select id, user_id, scans_granted into v_existing from public.scan_credits where transaction_id = p_transaction_id;
  if v_existing.user_id is distinct from p_user_id then
    return jsonb_build_object('error', 'transaction_user_mismatch');
  end if;
  return jsonb_build_object('ok', true, 'idempotent', true, 'credits_granted', v_existing.scans_granted);
end; $function$;

REVOKE ALL ON FUNCTION public.grant_scan_pack_credits(uuid, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_scan_pack_credits(uuid, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_scan_pack_credits(uuid, text, text, integer) TO service_role;

-- 2) ADMIN grant — service-role only, no auth.uid() binding, source-derived scans
CREATE OR REPLACE FUNCTION public.grant_scan_pack_credits_admin(
  p_user_id uuid, p_source text, p_transaction_id text, p_scans_granted integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare v_existing record; v_inserted record; v_scans int;
begin
  -- Defense in depth: reject any caller carrying a user identity. EXECUTE is also
  -- revoked from anon/authenticated below (that revocation is the primary control).
  if auth.uid() is not null then return jsonb_build_object('error', 'forbidden'); end if;
  if p_user_id is null then return jsonb_build_object('error', 'invalid_user'); end if;

  v_scans := case p_source when 'pack_10' then 10 when 'pack_25' then 25 else null end;
  if v_scans is null then return jsonb_build_object('error', 'invalid_source'); end if;
  if p_transaction_id is null or length(p_transaction_id) = 0 then
    return jsonb_build_object('error', 'invalid_transaction_id');
  end if;

  insert into public.scan_credits (user_id, source, transaction_id, scans_granted)
  values (p_user_id, p_source, p_transaction_id, v_scans)
  on conflict (transaction_id) do nothing
  returning id, scans_granted into v_inserted;

  if v_inserted.id is not null then
    return jsonb_build_object('ok', true, 'idempotent', false, 'credits_granted', v_inserted.scans_granted);
  end if;

  select id, user_id, scans_granted into v_existing from public.scan_credits where transaction_id = p_transaction_id;
  if v_existing.user_id is distinct from p_user_id then
    return jsonb_build_object('error', 'transaction_user_mismatch');
  end if;
  return jsonb_build_object('ok', true, 'idempotent', true, 'credits_granted', v_existing.scans_granted);
end; $function$;

REVOKE ALL ON FUNCTION public.grant_scan_pack_credits_admin(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_scan_pack_credits_admin(uuid, text, text, integer) TO service_role;
