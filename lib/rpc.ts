/**
 * Typed RPC boundary for Supabase functions whose generated return types are
 * `Json` because supabase-js cannot introspect jsonb_build_object SQL bodies.
 *
 * The result types below mirror the exact `jsonb_build_object(...)` return
 * shape of each SQL function. Keep this file in sync with the canonical SQL
 * migrations:
 *   - supabase/migrations/20260417000000_complete_vehicle_task_v4.sql
 *   - supabase/migrations/20260411000000_complete_property_task.sql
 *   - supabase/migrations/20260422034337_revoke_public_exec_and_gate_receipt_scan_rpcs.sql
 *
 * Args types are sourced from the generated Database type so that any
 * future migration that changes a function's parameter list is caught at
 * compile time without manual sync.
 *
 * Implementation note: `.overrideTypes<T, { merge: false }>()` is used (not
 * `.returns<T>()` which is @deprecated as of postgrest-js 2.103.0). The
 * `merge: false` option is required — without it, supabase-js merges the
 * provided type with the inferred `Json` base, producing a useless union.
 */

import { supabase } from "./supabase";
import type { Database } from "./supabase-types";

type Functions = Database["public"]["Functions"];

export type CompleteVehicleTaskArgs = Functions["complete_vehicle_task"]["Args"];
export type CompleteVehicleTaskResult = {
  task_name: string;
  vehicle_name: string;
  next_due_date: string | null;
  next_due_miles: number | null;
  next_due_hours: number | null;
};

export function completeVehicleTask(args: CompleteVehicleTaskArgs) {
  return supabase
    .rpc("complete_vehicle_task", args)
    .returns<Array<CompleteVehicleTaskResult>>()
    .single();
}

export type CompletePropertyTaskArgs = Functions["complete_property_task"]["Args"];
export type CompletePropertyTaskResult = {
  task_id: string;
  task_name: string;
  property_id: string;
  property_name: string;
  completed_date: string;
  next_due_date: string;
  interval_months: number;
  log_created: boolean;
};

export function completePropertyTask(args: CompletePropertyTaskArgs) {
  return supabase
    .rpc("complete_property_task", args)
    .returns<Array<CompletePropertyTaskResult>>()
    .single();
}

export type GetScanQuotaArgs = Functions["get_scan_quota"]["Args"];
export type GetScanQuotaResult = {
  tier: string | null;
  scans_used: number;
  scans_limit: number;
  scans_remaining: number;
};

export function getScanQuota(args: GetScanQuotaArgs) {
  return supabase
    .rpc("get_scan_quota", args)
    .returns<Array<GetScanQuotaResult>>()
    .single();
}
