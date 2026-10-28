-- Entitlement model, Stage 1 (Revision 6): ADDITIVE schema and policy RPCs only.
-- Source of truth for every object below: Stage 0 report section F (F.1-F.6) as modified by
-- owner decisions D1-D8. No backfill, no profile changes, no triggers on existing tables,
-- no scheduler, no network calls. Rollback: DROP SCHEMA entitlement CASCADE plus the two
-- public wrappers (F.5). Nothing in production depends on these objects until Stage 4.

-- ---------------------------------------------------------------------------------------------
-- Schema and scoped default privileges (F.3). Scoped to schema entitlement for the owning role
-- only; existing schemas and functions are untouched.
-- ---------------------------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS entitlement;
REVOKE ALL ON SCHEMA entitlement FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA entitlement TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA entitlement REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA entitlement REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA entitlement REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Types and sequences (F.2 state shape; F.2/F.4 request-start snapshot watermark)
-- ---------------------------------------------------------------------------------------------
CREATE TYPE entitlement.state AS (
  kind               text,          -- 'paid' | 'trial' | 'free'
  effective_tier     text,          -- 'personal' | 'pro' | 'business' | NULL
  source             text,          -- 'revenuecat' | 'promo' | 'manual' | NULL
  expires_at         timestamptz,   -- the winning grant's actual expiry (NULL = verified unbounded)
  next_transition_at timestamptz,   -- earliest instant at which this state can change
  days_remaining     integer,
  personal_or_above  boolean,
  pro_or_above       boolean,
  business           boolean
);

CREATE SEQUENCE entitlement.rc_snapshot_seq;
REVOKE ALL ON SEQUENCE entitlement.rc_snapshot_seq FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Tables (F.1 + D6 CHECK)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE entitlement.grants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source          text NOT NULL CHECK (source IN ('revenuecat','promo','manual')),
  tier            text NOT NULL CHECK (tier IN ('personal','pro','business')),
  starts_at       timestamptz NOT NULL,
  expires_at      timestamptz NULL,
  revoked_at      timestamptz NULL,
  external_ref    text NOT NULL,
  rc_snapshot_seq bigint NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- D6: unbounded duration is allowed ONLY for verified RevenueCat grants.
  CONSTRAINT grants_finite_expiry_unless_rc CHECK (source = 'revenuecat' OR expires_at IS NOT NULL),
  CONSTRAINT grants_user_source_ref_key UNIQUE (user_id, source, external_ref)
);
CREATE INDEX grants_user_id_idx ON entitlement.grants (user_id);
CREATE INDEX grants_expires_at_live_idx ON entitlement.grants (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE entitlement.rc_customers (
  user_id                       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  rc_app_user_id                text NOT NULL UNIQUE,
  verified_at                   timestamptz NOT NULL,
  last_snapshot_seq             bigint NOT NULL DEFAULT 0,
  last_snapshot_request_date_ms bigint NULL
);

CREATE TABLE entitlement.manual_grant_notes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL,
  operator_user_id uuid NOT NULL REFERENCES auth.users(id),
  reason           text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE entitlement.events (
  id                 bigserial PRIMARY KEY,
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  user_id            uuid NOT NULL,
  grant_id           uuid NULL,
  action             text NOT NULL CHECK (action IN ('create','update','revoke','reactivate','transfer_out','transfer_in','sweep_transition')),
  actor              text NOT NULL,
  external_event_ref text NULL,
  old_values         jsonb NULL,
  new_values         jsonb NULL,
  reason             text NULL
);
CREATE INDEX events_user_id_idx ON entitlement.events (user_id);

CREATE TABLE entitlement.sweep_runs (
  run_id          bigserial PRIMARY KEY,
  scheduled_for   timestamptz NOT NULL,
  started_at      timestamptz NOT NULL,
  finished_at     timestamptz NULL,
  rows_due        integer NOT NULL DEFAULT 0,
  rows_updated    integer NOT NULL DEFAULT 0,
  max_lag_seconds numeric NULL
);

CREATE TABLE entitlement.rc_entitlement_map (
  entitlement_id text PRIMARY KEY,
  tier           text NOT NULL CHECK (tier IN ('personal','pro','business')),
  verified_at    timestamptz NULL,
  verified_by    uuid NULL
);

-- No client read or write path: RLS on with no policies, and no table privileges for app roles.
-- Writer functions are SECURITY DEFINER and owned by the migration role, so service_role needs
-- no direct table privileges either.
ALTER TABLE entitlement.grants             ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlement.rc_customers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlement.manual_grant_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlement.events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlement.sweep_runs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlement.rc_entitlement_map ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA entitlement FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA entitlement FROM PUBLIC, anon, authenticated;

-- Append-only audit (F.1): no UPDATE/DELETE on events for anyone, enforced by trigger.
CREATE FUNCTION entitlement.events_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'entitlement.events is append-only (% rejected)', TG_OP USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER events_immutable
  BEFORE UPDATE OR DELETE ON entitlement.events
  FOR EACH ROW EXECUTE FUNCTION entitlement.events_immutable();

-- ---------------------------------------------------------------------------------------------
-- Pure policy (F.2 compute). STABLE: never writes.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION entitlement.compute(p_user_id uuid, p_now timestamptz)
RETURNS entitlement.state
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_state        entitlement.state;
  v_grant        record;
  v_next_expiry  timestamptz;
  v_next_start   timestamptz;
  v_tier         text;
  v_trial_exp    timestamptz;
BEGIN
  IF p_user_id IS NULL OR p_now IS NULL THEN
    RAISE EXCEPTION 'entitlement.compute: user id and clock are required' USING ERRCODE = '22023';
  END IF;

  -- Unknown tier/source is a reconciliation error, never a grant (F.2).
  IF EXISTS (
    SELECT 1 FROM entitlement.grants g
    WHERE g.user_id = p_user_id
      AND (g.tier NOT IN ('personal','pro','business') OR g.source NOT IN ('revenuecat','promo','manual'))
  ) THEN
    RAISE EXCEPTION 'entitlement.compute: unknown tier or source for user %', p_user_id USING ERRCODE = 'P0001';
  END IF;

  -- Highest VALID tier wins (business > pro > personal); among equals the longest expiry.
  -- Valid iff starts_at <= p_now AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > p_now).
  SELECT g.tier, g.source, g.expires_at
    INTO v_grant
    FROM entitlement.grants g
   WHERE g.user_id = p_user_id
     AND g.starts_at <= p_now
     AND g.revoked_at IS NULL
     AND (g.expires_at IS NULL OR g.expires_at > p_now)
   ORDER BY CASE g.tier WHEN 'business' THEN 3 WHEN 'pro' THEN 2 WHEN 'personal' THEN 1 END DESC,
            g.expires_at DESC NULLS FIRST
   LIMIT 1;

  -- next_transition_at: earliest expiry among valid grants, or earliest start among not-yet-started grants.
  SELECT MIN(g.expires_at) INTO v_next_expiry
    FROM entitlement.grants g
   WHERE g.user_id = p_user_id AND g.starts_at <= p_now AND g.revoked_at IS NULL
     AND g.expires_at IS NOT NULL AND g.expires_at > p_now;
  SELECT MIN(g.starts_at) INTO v_next_start
    FROM entitlement.grants g
   WHERE g.user_id = p_user_id AND g.starts_at > p_now AND g.revoked_at IS NULL
     AND (g.expires_at IS NULL OR g.expires_at > p_now);

  IF v_grant.tier IS NOT NULL THEN
    v_tier := v_grant.tier;
    v_state.kind               := 'paid';
    v_state.effective_tier     := v_tier;
    v_state.source             := v_grant.source;
    v_state.expires_at         := v_grant.expires_at;
    v_state.next_transition_at := LEAST(v_next_expiry, v_next_start);
    v_state.days_remaining     := CASE WHEN v_grant.expires_at IS NULL THEN NULL
                                       ELSE GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_grant.expires_at - p_now)) / 86400.0))::integer END;
    v_state.personal_or_above  := true;
    v_state.pro_or_above       := v_tier IN ('pro','business');
    v_state.business           := v_tier = 'business';
    RETURN v_state;
  END IF;

  -- No paid grant: trial exactly as the shipped client (lib/subscription.ts hasActivePremium):
  -- profiles.subscription_tier = 'trial' AND trial_expires_at > p_now.
  SELECT p.trial_expires_at INTO v_trial_exp
    FROM public.profiles p
   WHERE p.user_id = p_user_id AND p.subscription_tier = 'trial' AND p.trial_expires_at > p_now;

  IF v_trial_exp IS NOT NULL THEN
    v_state.kind               := 'trial';
    v_state.effective_tier     := NULL;
    v_state.source             := NULL;
    v_state.expires_at         := v_trial_exp;
    v_state.next_transition_at := LEAST(v_trial_exp, v_next_start);
    v_state.days_remaining     := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_trial_exp - p_now)) / 86400.0))::integer;
    v_state.personal_or_above  := true;
    v_state.pro_or_above       := true;
    v_state.business           := false;
    RETURN v_state;
  END IF;

  v_state.kind               := 'free';
  v_state.effective_tier     := NULL;
  v_state.source             := NULL;
  v_state.expires_at         := NULL;
  v_state.next_transition_at := v_next_start;
  v_state.days_remaining     := NULL;
  v_state.personal_or_above  := false;
  v_state.pro_or_above       := false;
  v_state.business           := false;
  RETURN v_state;
END;
$$;

-- Service-role wrapper (F.2): used by server gates and quota RPCs from Stage 4 on.
CREATE FUNCTION public.entitlement_for(p_user_id uuid)
RETURNS entitlement.state
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT entitlement.compute(p_user_id, now());
$$;

-- Caller-bound read (F.2): the ONLY client-reachable entry point. Bound to auth.uid() only.
CREATE FUNCTION public.my_entitlement()
RETURNS entitlement.state
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'my_entitlement: authentication required' USING ERRCODE = '42501';
  END IF;
  RETURN entitlement.compute(v_uid, now());
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Snapshot watermark (F.4): taken by the writer BEFORE it fetches from RevenueCat.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION entitlement.next_snapshot_seq()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT nextval('entitlement.rc_snapshot_seq');
$$;

-- ---------------------------------------------------------------------------------------------
-- Internal: append one audit event (same transaction as the mutation it describes).
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION entitlement.log_event(
  p_user_id uuid, p_grant_id uuid, p_action text, p_actor text,
  p_external_event_ref text, p_old jsonb, p_new jsonb, p_reason text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO entitlement.events (user_id, grant_id, action, actor, external_event_ref, old_values, new_values, reason)
  VALUES (p_user_id, p_grant_id, p_action, p_actor, p_external_event_ref, p_old, p_new, p_reason);
$$;

-- ---------------------------------------------------------------------------------------------
-- RC snapshot projection (F.2 apply_rc_snapshot). Serialized per user, monotonic watermark,
-- stale snapshots rejected without mutation, unknown entitlement ids raise BEFORE any change,
-- promo/manual rows untouched. p_actor defaults preserve the F call form.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION entitlement.apply_rc_snapshot(
  p_user_id uuid,
  p_rc_app_user_id text,
  p_request_date_ms bigint,
  p_seq bigint,
  p_entitlements jsonb,
  p_actor text DEFAULT 'sync-subscription-from-rc')
RETURNS entitlement.state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now       timestamptz := now();
  v_cust      entitlement.rc_customers%ROWTYPE;
  v_key       text;
  v_entry     jsonb;
  v_tier      text;
  v_exp       timestamptz;
  v_start     timestamptz;
  v_active    text[] := ARRAY[]::text[];
  v_old       entitlement.grants%ROWTYPE;
  v_new       entitlement.grants%ROWTYPE;
  v_ref       text := p_request_date_ms::text;
BEGIN
  IF p_user_id IS NULL OR p_rc_app_user_id IS NULL OR p_seq IS NULL OR p_entitlements IS NULL
     OR jsonb_typeof(p_entitlements) <> 'object' THEN
    RAISE EXCEPTION 'apply_rc_snapshot: malformed snapshot' USING ERRCODE = '22023';
  END IF;

  -- Per-user serialization: lock the verified-customer row (created on first verified link).
  INSERT INTO entitlement.rc_customers (user_id, rc_app_user_id, verified_at)
  VALUES (p_user_id, p_rc_app_user_id, v_now)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_cust FROM entitlement.rc_customers c WHERE c.user_id = p_user_id FOR UPDATE;

  IF v_cust.rc_app_user_id <> p_rc_app_user_id THEN
    RAISE EXCEPTION 'apply_rc_snapshot: RC identity mismatch for user % (verified link differs)', p_user_id USING ERRCODE = 'P0001';
  END IF;

  -- Older or duplicate snapshot: record and return current state, mutate nothing.
  IF p_seq <= v_cust.last_snapshot_seq THEN
    PERFORM entitlement.log_event(p_user_id, NULL, 'update', p_actor, v_ref, NULL,
      jsonb_build_object('rejected_seq', p_seq, 'last_snapshot_seq', v_cust.last_snapshot_seq), 'stale_snapshot_rejected');
    RETURN entitlement.compute(p_user_id, v_now);
  END IF;

  -- Validate the whole snapshot before touching any grant: unknown id -> RAISE, nothing revoked.
  FOR v_key IN SELECT jsonb_object_keys(p_entitlements) LOOP
    IF NOT EXISTS (SELECT 1 FROM entitlement.rc_entitlement_map m WHERE m.entitlement_id = v_key) THEN
      RAISE EXCEPTION 'apply_rc_snapshot: unknown RC entitlement id % (reconciliation refused, nothing revoked)', v_key USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- Project each CURRENTLY VALID entitlement (expires_date NULL = unbounded, else > now).
  FOR v_key, v_entry IN SELECT * FROM jsonb_each(p_entitlements) LOOP
    IF jsonb_typeof(v_entry) <> 'object' THEN
      RAISE EXCEPTION 'apply_rc_snapshot: malformed entitlement entry %', v_key USING ERRCODE = '22023';
    END IF;
    v_exp := NULLIF(v_entry->>'expires_date', '')::timestamptz;
    IF v_exp IS NULL OR v_exp > v_now THEN
      SELECT m.tier INTO v_tier FROM entitlement.rc_entitlement_map m WHERE m.entitlement_id = v_key;
      v_start := COALESCE(NULLIF(v_entry->>'purchase_date', '')::timestamptz, v_now);
      v_active := v_active || v_key;

      SELECT * INTO v_old FROM entitlement.grants g
       WHERE g.user_id = p_user_id AND g.source = 'revenuecat' AND g.external_ref = v_key;

      IF v_old.id IS NULL THEN
        INSERT INTO entitlement.grants (user_id, source, tier, starts_at, expires_at, external_ref, rc_snapshot_seq)
        VALUES (p_user_id, 'revenuecat', v_tier, LEAST(v_start, v_now), v_exp, v_key, p_seq)
        RETURNING * INTO v_new;
        PERFORM entitlement.log_event(p_user_id, v_new.id, 'create', p_actor, v_ref, NULL, to_jsonb(v_new), 'rc_snapshot');
      ELSIF v_old.revoked_at IS NOT NULL OR v_old.tier IS DISTINCT FROM v_tier OR v_old.expires_at IS DISTINCT FROM v_exp THEN
        UPDATE entitlement.grants g
           SET tier = v_tier, expires_at = v_exp, revoked_at = NULL, rc_snapshot_seq = p_seq, updated_at = v_now
         WHERE g.id = v_old.id
        RETURNING * INTO v_new;
        PERFORM entitlement.log_event(p_user_id, v_new.id,
          CASE WHEN v_old.revoked_at IS NOT NULL THEN 'reactivate' ELSE 'update' END,
          p_actor, v_ref, to_jsonb(v_old), to_jsonb(v_new), 'rc_snapshot');
      END IF;
    END IF;
  END LOOP;

  -- Revoke this user's RC grants that are absent or expired in the snapshot. Promo/manual untouched.
  FOR v_old IN
    SELECT * FROM entitlement.grants g
     WHERE g.user_id = p_user_id AND g.source = 'revenuecat' AND g.revoked_at IS NULL
       AND NOT (g.external_ref = ANY (v_active))
  LOOP
    UPDATE entitlement.grants g
       SET revoked_at = v_now, rc_snapshot_seq = p_seq, updated_at = v_now
     WHERE g.id = v_old.id
    RETURNING * INTO v_new;
    PERFORM entitlement.log_event(p_user_id, v_new.id, 'revoke', p_actor, v_ref, to_jsonb(v_old), to_jsonb(v_new), 'rc_snapshot');
  END LOOP;

  UPDATE entitlement.rc_customers c
     SET last_snapshot_seq = p_seq, last_snapshot_request_date_ms = p_request_date_ms
   WHERE c.user_id = p_user_id;

  RETURN entitlement.compute(p_user_id, v_now);
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Promo grant (F.2 issue_promo_grant): one grant per verified redemption; idempotent.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION entitlement.issue_promo_grant(
  p_redemption_id uuid,
  p_actor text DEFAULT 'apply-promo-code')
RETURNS entitlement.state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now  timestamptz := now();
  v_red  record;
  v_new  entitlement.grants%ROWTYPE;
BEGIN
  SELECT r.id, r.user_id, r.redeemed_at, c.tier, c.duration_days
    INTO v_red
    FROM public.promo_redemptions r
    JOIN public.promo_codes c ON c.id = r.promo_code_id
   WHERE r.id = p_redemption_id;

  IF v_red.id IS NULL THEN
    RAISE EXCEPTION 'issue_promo_grant: redemption % not found', p_redemption_id USING ERRCODE = 'P0002';
  END IF;
  IF v_red.tier NOT IN ('personal','pro','business') OR v_red.duration_days IS NULL OR v_red.duration_days <= 0 THEN
    RAISE EXCEPTION 'issue_promo_grant: redemption % has unknown tier or duration', p_redemption_id USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO entitlement.grants (user_id, source, tier, starts_at, expires_at, external_ref)
  VALUES (v_red.user_id, 'promo', v_red.tier, v_red.redeemed_at,
          v_red.redeemed_at + make_interval(days => v_red.duration_days), v_red.id::text)
  ON CONFLICT (user_id, source, external_ref) DO NOTHING
  RETURNING * INTO v_new;

  IF v_new.id IS NOT NULL THEN
    PERFORM entitlement.log_event(v_red.user_id, v_new.id, 'create', p_actor, v_red.id::text, NULL, to_jsonb(v_new), 'promo_redemption');
  END IF;

  RETURN entitlement.compute(v_red.user_id, v_now);
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Manual grant (F.2 issue_manual_grant + D6): requires a provenance note and an EXPLICIT,
-- NON-NULL expiry. Actor is derived from the note's operator identity.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION entitlement.issue_manual_grant(
  p_note_id uuid,
  p_tier text,
  p_expires_at timestamptz)
RETURNS entitlement.state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now  timestamptz := now();
  v_note entitlement.manual_grant_notes%ROWTYPE;
  v_new  entitlement.grants%ROWTYPE;
BEGIN
  IF p_expires_at IS NULL THEN
    RAISE EXCEPTION 'issue_manual_grant: an explicit expiry is required' USING ERRCODE = '22023';
  END IF;
  IF p_tier IS NULL OR p_tier NOT IN ('personal','pro','business') THEN
    RAISE EXCEPTION 'issue_manual_grant: unknown tier %', p_tier USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_note FROM entitlement.manual_grant_notes n WHERE n.id = p_note_id;
  IF v_note.id IS NULL THEN
    RAISE EXCEPTION 'issue_manual_grant: note % not found (operator provenance required)', p_note_id USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO entitlement.grants (user_id, source, tier, starts_at, expires_at, external_ref)
  VALUES (v_note.user_id, 'manual', p_tier, v_now, p_expires_at, v_note.id::text)
  ON CONFLICT (user_id, source, external_ref) DO NOTHING
  RETURNING * INTO v_new;

  IF v_new.id IS NOT NULL THEN
    PERFORM entitlement.log_event(v_note.user_id, v_new.id, 'create', 'operator:' || v_note.operator_user_id::text,
      v_note.id::text, NULL, to_jsonb(v_new), v_note.reason);
  END IF;

  RETURN entitlement.compute(v_note.user_id, v_now);
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Revoke (F.2 revoke_grant): idempotent; audited.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION entitlement.revoke_grant(p_grant_id uuid, p_actor text, p_reason text)
RETURNS entitlement.state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := now();
  v_old entitlement.grants%ROWTYPE;
  v_new entitlement.grants%ROWTYPE;
BEGIN
  IF p_actor IS NULL OR p_actor = '' THEN
    RAISE EXCEPTION 'revoke_grant: actor is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_old FROM entitlement.grants g WHERE g.id = p_grant_id FOR UPDATE;
  IF v_old.id IS NULL THEN
    RAISE EXCEPTION 'revoke_grant: grant % not found', p_grant_id USING ERRCODE = 'P0002';
  END IF;
  IF v_old.revoked_at IS NULL THEN
    UPDATE entitlement.grants g SET revoked_at = v_now, updated_at = v_now WHERE g.id = v_old.id RETURNING * INTO v_new;
    PERFORM entitlement.log_event(v_old.user_id, v_old.id, 'revoke', p_actor, NULL, to_jsonb(v_old), to_jsonb(v_new), p_reason);
  END IF;
  RETURN entitlement.compute(v_old.user_id, v_now);
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Transfer (F.2 transfer_rc): both verified RC identities must already map to users; locks both
-- customer rows in user_id order; loser's RC grants revoked, winner's snapshot applied, promo and
-- manual rows preserved on both sides; all-or-nothing in one transaction.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION entitlement.transfer_rc(
  p_from_user uuid,
  p_to_user uuid,
  p_event_ref text,
  p_from_snapshot jsonb,
  p_to_snapshot jsonb,
  p_seq_from bigint,
  p_seq_to bigint,
  p_actor text DEFAULT 'revenuecat-webhook')
RETURNS entitlement.state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now    timestamptz := now();
  v_from   entitlement.rc_customers%ROWTYPE;
  v_to     entitlement.rc_customers%ROWTYPE;
  v_first  uuid;
  v_second uuid;
  v_state  entitlement.state;
BEGIN
  IF p_from_user IS NULL OR p_to_user IS NULL OR p_from_user = p_to_user THEN
    RAISE EXCEPTION 'transfer_rc: two distinct users are required' USING ERRCODE = '22023';
  END IF;
  -- Lock in user_id order to avoid deadlocks between concurrent transfers.
  v_first  := LEAST(p_from_user, p_to_user);
  v_second := GREATEST(p_from_user, p_to_user);
  PERFORM 1 FROM entitlement.rc_customers c WHERE c.user_id = v_first  FOR UPDATE;
  PERFORM 1 FROM entitlement.rc_customers c WHERE c.user_id = v_second FOR UPDATE;
  SELECT * INTO v_from FROM entitlement.rc_customers c WHERE c.user_id = p_from_user;
  SELECT * INTO v_to   FROM entitlement.rc_customers c WHERE c.user_id = p_to_user;
  IF v_from.user_id IS NULL OR v_to.user_id IS NULL THEN
    RAISE EXCEPTION 'transfer_rc: both users must have a verified RC identity (missing mapping is a retry, not a guess)' USING ERRCODE = 'P0001';
  END IF;

  -- Loser: its current RC state (normally empty) replaces its RC grants; promo/manual untouched.
  PERFORM entitlement.apply_rc_snapshot(p_from_user, v_from.rc_app_user_id, NULL, p_seq_from, p_from_snapshot, p_actor);
  PERFORM entitlement.log_event(p_from_user, NULL, 'transfer_out', p_actor, p_event_ref, NULL,
    jsonb_build_object('to_user', p_to_user), 'rc_transfer');

  -- Winner: its current RC state is projected; promo/manual untouched.
  v_state := entitlement.apply_rc_snapshot(p_to_user, v_to.rc_app_user_id, NULL, p_seq_to, p_to_snapshot, p_actor);
  PERFORM entitlement.log_event(p_to_user, NULL, 'transfer_in', p_actor, p_event_ref, NULL,
    jsonb_build_object('from_user', p_from_user), 'rc_transfer');

  RETURN v_state;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Sweep (F.2 sweep, D7): DORMANT in Stage 1. It depends on the Stage 4 legacy-cache column
-- public.profiles.entitlement_next_transition_at (F.1/F.5) and on a later authorized scheduler.
-- Creating it now only fixes its signature and instrumentation shape; it is not scheduled and
-- must not be executed against real data in this stage.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION entitlement.sweep(p_now timestamptz DEFAULT now())
RETURNS entitlement.sweep_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_run     entitlement.sweep_runs%ROWTYPE;
  v_row     record;
  v_state   entitlement.state;
  v_due     integer := 0;
  v_updated integer := 0;
  v_max_lag numeric := NULL;
  v_lag     numeric;
  v_tier    text;
BEGIN
  INSERT INTO entitlement.sweep_runs (scheduled_for, started_at)
  VALUES (p_now, clock_timestamp()) RETURNING * INTO v_run;

  FOR v_row IN
    SELECT p.user_id, p.subscription_tier, p.subscription_expires_at, p.entitlement_next_transition_at
      FROM public.profiles p
     WHERE p.entitlement_next_transition_at IS NOT NULL AND p.entitlement_next_transition_at <= p_now
     FOR UPDATE SKIP LOCKED
  LOOP
    v_due := v_due + 1;
    v_state := entitlement.compute(v_row.user_id, p_now);
    v_tier := CASE v_state.kind WHEN 'paid' THEN v_state.effective_tier WHEN 'trial' THEN 'trial' ELSE 'free' END;
    v_lag := EXTRACT(EPOCH FROM (clock_timestamp() - v_row.entitlement_next_transition_at));
    v_max_lag := GREATEST(COALESCE(v_max_lag, 0), v_lag);

    UPDATE public.profiles p
       SET subscription_tier = v_tier,
           subscription_expires_at = CASE WHEN v_state.kind = 'paid' THEN v_state.expires_at ELSE NULL END,
           entitlement_next_transition_at = v_state.next_transition_at
     WHERE p.user_id = v_row.user_id;
    v_updated := v_updated + 1;

    PERFORM entitlement.log_event(v_row.user_id, NULL, 'sweep_transition', 'sweep', v_run.run_id::text,
      jsonb_build_object('subscription_tier', v_row.subscription_tier, 'subscription_expires_at', v_row.subscription_expires_at),
      jsonb_build_object('subscription_tier', v_tier, 'subscription_expires_at', v_state.expires_at, 'next_transition_at', v_state.next_transition_at),
      'time_transition');
  END LOOP;

  UPDATE entitlement.sweep_runs r
     SET finished_at = clock_timestamp(), rows_due = v_due, rows_updated = v_updated, max_lag_seconds = v_max_lag
   WHERE r.run_id = v_run.run_id
  RETURNING * INTO v_run;
  RETURN v_run;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Function privileges (F.3). Explicit per object; the public-schema wrappers need explicit
-- REVOKEs because public-schema default ACLs grant EXECUTE to anon/authenticated.
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION entitlement.events_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION entitlement.compute(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION entitlement.compute(uuid, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION entitlement.next_snapshot_seq() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION entitlement.next_snapshot_seq() TO service_role;
REVOKE ALL ON FUNCTION entitlement.log_event(uuid, uuid, text, text, text, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION entitlement.apply_rc_snapshot(uuid, text, bigint, bigint, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION entitlement.apply_rc_snapshot(uuid, text, bigint, bigint, jsonb, text) TO service_role;
REVOKE ALL ON FUNCTION entitlement.issue_promo_grant(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION entitlement.issue_promo_grant(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION entitlement.issue_manual_grant(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION entitlement.issue_manual_grant(uuid, text, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION entitlement.revoke_grant(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION entitlement.revoke_grant(uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION entitlement.transfer_rc(uuid, uuid, text, jsonb, jsonb, bigint, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION entitlement.transfer_rc(uuid, uuid, text, jsonb, jsonb, bigint, bigint, text) TO service_role;
REVOKE ALL ON FUNCTION entitlement.sweep(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION entitlement.sweep(timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.entitlement_for(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.entitlement_for(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.my_entitlement() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.my_entitlement() TO authenticated;
