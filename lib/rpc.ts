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
 *   - supabase/migrations/20260723090000_completion_events_atomic_undo.sql
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

export type CompleteHealthAppointmentArgs = Functions["complete_health_appointment"]["Args"];
export type CompleteHealthAppointmentResult = {
  appointment_id: string;
  appointment_type: string;
  family_member_id: string;
  family_member_name: string;
  completed_date: string;
  next_due_date: string | null;
  log_created: boolean;
  idempotent: boolean;
};

export async function completeHealthAppointment(args: CompleteHealthAppointmentArgs): Promise<{
  data: CompleteHealthAppointmentResult | null;
  error: unknown;
}> {
  const { data, error } = await supabase.rpc("complete_health_appointment", args);
  return { data: (data as CompleteHealthAppointmentResult | null), error };
}

export type LogMedicationDoseArgs = Functions["log_medication_dose"]["Args"];
export type LogMedicationDoseResult = {
  medication_id: string;
  medication_name: string;
  family_member_id: string | null;
  dose_date: string;
  today_count: number;
  streak_days: number;
  dose_dates_30d: string[];
  idempotent: boolean;
  logged: boolean;
};

export async function logMedicationDose(args: LogMedicationDoseArgs): Promise<{
  data: LogMedicationDoseResult | null;
  error: unknown;
}> {
  const { data, error } = await supabase.rpc("log_medication_dose", args);
  return { data: (data as LogMedicationDoseResult | null), error };
}

export type UndoLastMedicationDoseArgs = Functions["undo_last_medication_dose"]["Args"];
export type UndoLastMedicationDoseResult = {
  medication_id: string;
  medication_name: string;
  family_member_id: string | null;
  dose_date: string;
  today_count: number;
  streak_days: number;
  dose_dates_30d: string[];
  undone: boolean;
};

export async function undoLastMedicationDose(args: UndoLastMedicationDoseArgs): Promise<{
  data: UndoLastMedicationDoseResult | null;
  error: unknown;
}> {
  const { data, error } = await supabase.rpc("undo_last_medication_dose", args);
  return { data: (data as UndoLastMedicationDoseResult | null), error };
}

export type GetScanQuotaArgs = Functions["get_scan_quota"]["Args"];
export type GetScanQuotaResult = {
  tier: string | null;
  scans_used: number;
  scans_limit: number;
  scans_remaining: number;
  credit_balance: number;
};

export async function getScanQuota(args: GetScanQuotaArgs): Promise<{
  data: GetScanQuotaResult | null;
  error: unknown;
}> {
  const { data, error } = await supabase.rpc("get_scan_quota", args);
  return { data: (data as GetScanQuotaResult | null), error };
}

export type DeleteVehicleCascadeArgs = Functions["delete_vehicle_cascade"]["Args"];
export type DeleteVehicleCascadeResult = {
  vehicle_id: string;
  tasks_deleted: number;
  logs_deleted: number;
  history_deleted: number;
  wallet_deleted: number;
  vehicle_deleted: number;
};

export async function deleteVehicleCascade(args: DeleteVehicleCascadeArgs): Promise<{
  data: DeleteVehicleCascadeResult | null;
  error: unknown;
}> {
  const { data, error } = await supabase.rpc("delete_vehicle_cascade", args);
  return { data: (data as DeleteVehicleCascadeResult | null), error };
}

export type ReverseVehicleTaskCompletionArgs = Functions["reverse_vehicle_task_completion"]["Args"];
export type ReverseVehicleTaskCompletionResult = {
  applied: boolean;
};

export async function reverseVehicleTaskCompletion(args: ReverseVehicleTaskCompletionArgs): Promise<{
  data: ReverseVehicleTaskCompletionResult | null;
  error: unknown;
}> {
  const { data, error } = await supabase.rpc("reverse_vehicle_task_completion", args);
  return { data: (data as ReverseVehicleTaskCompletionResult | null), error };
}

export type TaskCompletionSnapshot = {
  last_completed_date: string | null;
  last_completed_miles: number | null;
  last_completed_hours: number | null;
  next_due_miles: number | null;
  next_due_hours: number | null;
  next_due_date: string | null;
  status: string;
  updated_at: string | null;
};

export type CompleteVehicleTaskIdempotentArgs = {
  p_task_id: string;
  p_operation_id: string;
  /**
   * REQUIRED on the idempotent path. The SQL default is now(); an omitted
   * date would differ between retries and surface as idempotency_mismatch.
   * The type makes the mistake impossible at compile time.
   */
  p_completed_date: string;
  p_mileage?: number;
  p_hours?: number;
  p_notes?: string;
  p_cost?: number;
  p_skip_log?: boolean;
  p_provider_name?: string;
  p_did_it_myself?: boolean;
};

export type CompleteVehicleTaskIdempotentResult =
  | { error: "idempotency_mismatch"; task_id: string; completion_event_id: string }
  | { error: "explicit_date_required" }
  | {
      task_id: string;
      completion_event_id: string;
      replayed: boolean;
      /** "undone" on replay means the operation is consumed but the task is NOT completed. */
      event_status: "applied" | "undone";
      prior: TaskCompletionSnapshot;
      applied: TaskCompletionSnapshot;
    };

export async function completeVehicleTaskIdempotent(args: CompleteVehicleTaskIdempotentArgs): Promise<{
  data: CompleteVehicleTaskIdempotentResult | null;
  error: unknown;
}> {
  const { data, error } = await supabase.rpc("complete_vehicle_task", args);
  return { data: (data as CompleteVehicleTaskIdempotentResult | null), error };
}

export type UndoVehicleCompletionsResult =
  | { ok: true; replayed: boolean; restored_task_ids: string[]; already_undone_task_ids: string[] }
  | { ok: false; error: "invalid_input" | "not_found" }
  | { ok: false; error: "conflict"; conflict_task_id: string };

export async function undoVehicleCompletions(eventIds: string[]): Promise<{
  data: UndoVehicleCompletionsResult | null;
  error: unknown;
}> {
  const { data, error } = await supabase.rpc("undo_vehicle_completions", { p_event_ids: eventIds });
  return { data: (data as UndoVehicleCompletionsResult | null), error };
}
