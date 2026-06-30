-- delete_vehicle_cascade: atomic, caller-bound vehicle deletion.
-- Mirrors the atomic_delete_account pattern (SECURITY DEFINER, search_path pinned,
-- caller-bound to auth.uid(), single transaction). DB child rows are deleted here
-- in one transaction. Storage file objects are purged client-side AFTER this RPC
-- returns success (this function never touches storage.objects).

BEGIN;

CREATE OR REPLACE FUNCTION public.delete_vehicle_cascade(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_user_id        uuid := auth.uid();
  v_owner_id       uuid;
  v_tasks_deleted  int := 0;
  v_logs_deleted   int := 0;
  v_hist_deleted   int := 0;
  v_wallet_deleted int := 0;
  v_veh_deleted    int := 0;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;
  if p_vehicle_id is null then
    raise exception 'p_vehicle_id is required';
  end if;

  select user_id into v_owner_id
    from public.vehicles
   where id = p_vehicle_id
   limit 1;

  if v_owner_id is null then
    raise exception 'vehicle not found';
  end if;
  if v_owner_id <> v_user_id then
    raise exception 'not authorized to delete this vehicle';
  end if;

  with d as (delete from public.user_vehicle_maintenance_tasks where vehicle_id = p_vehicle_id returning 1)
    select count(*) into v_tasks_deleted from d;

  with d as (delete from public.maintenance_logs where vehicle_id = p_vehicle_id returning 1)
    select count(*) into v_logs_deleted from d;

  with d as (delete from public.vehicle_mileage_history where vehicle_id = p_vehicle_id returning 1)
    select count(*) into v_hist_deleted from d;

  with d as (delete from public.vehicle_wallet_documents where vehicle_id = p_vehicle_id returning 1)
    select count(*) into v_wallet_deleted from d;

  with d as (delete from public.vehicles where id = p_vehicle_id and user_id = v_user_id returning 1)
    select count(*) into v_veh_deleted from d;

  if v_veh_deleted = 0 then
    raise exception 'vehicle row was not deleted';
  end if;

  return jsonb_build_object(
    'vehicle_id',      p_vehicle_id,
    'tasks_deleted',   v_tasks_deleted,
    'logs_deleted',    v_logs_deleted,
    'history_deleted', v_hist_deleted,
    'wallet_deleted',  v_wallet_deleted,
    'vehicle_deleted', v_veh_deleted
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.delete_vehicle_cascade(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_vehicle_cascade(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_vehicle_cascade(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_vehicle_cascade(uuid) TO service_role;

COMMIT;
