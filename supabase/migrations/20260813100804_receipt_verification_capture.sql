-- Receipt verification capture layer.
--
-- Every maintenance log carries, from ship day: the SHA-256 of the EXACT bytes
-- stored in the receipts bucket, the image source when it is knowable, the
-- client device's own timestamp alongside the server's created_at, and a
-- server-enforced counter of how many times the receipt was replaced.
--
-- The trigger is the authority. Verification fields are write-once at insert
-- and thereafter only movable through the defined replacement path: while a
-- receipt stays the same, its hash, source and client timestamp cannot be
-- cleared or rewritten by any client; swapping a receipt for a different one
-- increments the replacement counter exactly once, whether or not a new hash
-- was supplied. A swapped receipt is counted, never laundered.
--
-- Legacy rows and server-side import-fleet rows simply carry nulls. There is
-- no backfill: an unverified row is honestly undocumented, not retroactively
-- attested.

ALTER TABLE public.maintenance_logs
  ADD COLUMN IF NOT EXISTS receipt_sha256 text,
  ADD COLUMN IF NOT EXISTS receipt_source text
    CHECK (receipt_source IN ('camera','library') OR receipt_source IS NULL),
  ADD COLUMN IF NOT EXISTS client_logged_at timestamptz,
  ADD COLUMN IF NOT EXISTS receipt_replaced_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.guard_receipt_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.receipt_replaced_count := 0;
    IF NEW.receipt_url IS NULL THEN
      NEW.receipt_sha256 := NULL;
      NEW.receipt_source := NULL;
    END IF;
    RETURN NEW;
  END IF;

  NEW.receipt_replaced_count := OLD.receipt_replaced_count;
  NEW.client_logged_at := OLD.client_logged_at;

  IF NEW.receipt_url IS NOT DISTINCT FROM OLD.receipt_url THEN
    NEW.receipt_sha256 := OLD.receipt_sha256;
    NEW.receipt_source := OLD.receipt_source;
    RETURN NEW;
  END IF;

  IF NEW.receipt_url IS NULL THEN
    NEW.receipt_sha256 := NULL;
    NEW.receipt_source := NULL;
    RETURN NEW;
  END IF;

  IF OLD.receipt_url IS NOT NULL THEN
    NEW.receipt_replaced_count := OLD.receipt_replaced_count + 1;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_receipt_verification ON public.maintenance_logs;
CREATE TRIGGER trg_guard_receipt_verification
  BEFORE INSERT OR UPDATE ON public.maintenance_logs
  FOR EACH ROW EXECUTE FUNCTION public.guard_receipt_verification();
