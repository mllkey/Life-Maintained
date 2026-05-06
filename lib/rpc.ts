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
 * Implementation note: these SQL functions return a scalar `jsonb` value (a
 * single object built via `jsonb_build_object(...)`), not `SETOF` rows. The
 * postgrest-js RPC builder, however, statically infers an array result and
 * its compile-time path for collapsing to a single object does not match a
 * scalar `jsonb` shape. To keep call-site types clean, each wrapper awaits
 * the RPC and narrows `data` to the declared result type at the boundary,
 * preserving the familiar `{ data, error }` contract.
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

export async function completeVehicleTask(args: CompleteVehicleTaskArgs): Promise<{
  data: CompleteVehicleTaskResult | null;
  error: unknown;
}> {
  const { data, error } = await supabase.rpc("complete_vehicle_task", args);
  return { data: (data as CompleteVehicleTaskResult | null), error };
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

export async function completePropertyTask(args: CompletePropertyTaskArgs): Promise<{
  data: CompletePropertyTaskResult | null;
  error: unknown;
}> {
  const { data, error } = await supabase.rpc("complete_property_task", args);
  return { data: (data as CompletePropertyTaskResult | null), error };
}

export type GetScanQuotaArgs = Functions["get_scan_quota"]["Args"];
export type GetScanQuotaResult = {
  tier: string | null;
  scans_used: number;
  scans_limit: number;
  scans_remaining: number;
};

export async function getScanQuota(args: GetScanQuotaArgs): Promise<{
  data: GetScanQuotaResult | null;
  error: unknown;
}> {
  const { data, error } = await supabase.rpc("get_scan_quota", args);
  return { data: (data as GetScanQuotaResult | null), error };
}
