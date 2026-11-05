-- Entitlement model, Stage 2A (Revision 7, R7.2): ADDITIVE public-schema forwarding wrappers so the
-- trusted edge functions can reach the Stage 1 writer RPCs through PostgREST as service_role.
-- Schema entitlement itself stays unexposed. Each wrapper is a narrowly typed shim with the SAME
-- parameter names, types, defaults and return type as the private implementation (Stage 1,
-- 20261028120000_entitlement_grants.sql); it adds no business logic. SECURITY INVOKER on purpose:
-- the caller must already hold USAGE on schema entitlement and EXECUTE on the private function
-- (today: service_role only), so a wrapper can never widen access. search_path is pinned and every
-- reference is schema-qualified. EXECUTE is revoked from PUBLIC, anon and authenticated (the
-- public-schema default ACL would otherwise grant them) and granted only to service_role.
-- No default-ACL change, no change to any existing object, no data.

CREATE FUNCTION public.next_snapshot_seq()
RETURNS bigint
LANGUAGE sql
SET search_path = ''
AS $$
  SELECT entitlement.next_snapshot_seq();
$$;

CREATE FUNCTION public.apply_rc_snapshot(
  p_user_id uuid,
  p_rc_app_user_id text,
  p_request_date_ms bigint,
  p_seq bigint,
  p_entitlements jsonb,
  p_actor text DEFAULT 'sync-subscription-from-rc')
RETURNS entitlement.state
LANGUAGE sql
SET search_path = ''
AS $$
  SELECT entitlement.apply_rc_snapshot(p_user_id, p_rc_app_user_id, p_request_date_ms, p_seq, p_entitlements, p_actor);
$$;

CREATE FUNCTION public.issue_promo_grant(
  p_redemption_id uuid,
  p_actor text DEFAULT 'apply-promo-code')
RETURNS entitlement.state
LANGUAGE sql
SET search_path = ''
AS $$
  SELECT entitlement.issue_promo_grant(p_redemption_id, p_actor);
$$;

CREATE FUNCTION public.issue_manual_grant(
  p_note_id uuid,
  p_tier text,
  p_expires_at timestamptz)
RETURNS entitlement.state
LANGUAGE sql
SET search_path = ''
AS $$
  SELECT entitlement.issue_manual_grant(p_note_id, p_tier, p_expires_at);
$$;

CREATE FUNCTION public.revoke_grant(
  p_grant_id uuid,
  p_actor text,
  p_reason text)
RETURNS entitlement.state
LANGUAGE sql
SET search_path = ''
AS $$
  SELECT entitlement.revoke_grant(p_grant_id, p_actor, p_reason);
$$;

CREATE FUNCTION public.transfer_rc(
  p_from_user uuid,
  p_to_user uuid,
  p_event_ref text,
  p_from_snapshot jsonb,
  p_to_snapshot jsonb,
  p_seq_from bigint,
  p_seq_to bigint,
  p_actor text DEFAULT 'revenuecat-webhook')
RETURNS entitlement.state
LANGUAGE sql
SET search_path = ''
AS $$
  SELECT entitlement.transfer_rc(p_from_user, p_to_user, p_event_ref, p_from_snapshot, p_to_snapshot, p_seq_from, p_seq_to, p_actor);
$$;

-- Privileges: exact signatures; service_role only.
REVOKE ALL ON FUNCTION public.next_snapshot_seq() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_snapshot_seq() TO service_role;
REVOKE ALL ON FUNCTION public.apply_rc_snapshot(uuid, text, bigint, bigint, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_rc_snapshot(uuid, text, bigint, bigint, jsonb, text) TO service_role;
REVOKE ALL ON FUNCTION public.issue_promo_grant(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_promo_grant(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.issue_manual_grant(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_manual_grant(uuid, text, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.revoke_grant(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_grant(uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.transfer_rc(uuid, uuid, text, jsonb, jsonb, bigint, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_rc(uuid, uuid, text, jsonb, jsonb, bigint, bigint, text) TO service_role;
