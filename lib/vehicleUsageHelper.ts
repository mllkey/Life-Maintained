/**
 * lib/vehicleUsageHelper.ts
 *
 * Shared helper: update vehicle usage reading + insert mileage history.
 * Call this after a service is logged to keep vehicle.mileage / vehicle.hours
 * current without duplicating the guard logic across screens.
 *
 * Does NOT touch maintenance tasks or maintenance_logs — use the
 * complete_vehicle_task RPC for that.
 */

import { supabase } from "./supabase";

/**
 * Update vehicle mileage and/or hours if the new readings exceed the current
 * stored values. Inserts a vehicle_mileage_history row only when mileage
 * actually increases.
 *
 * @param vehicleId       - target vehicle id
 * @param milesVal        - new mileage reading (null = skip mileage update)
 * @param hoursVal        - new hours reading (null = skip hours update)
 * @param recordedAt      - ISO date or timestamptz string for history row
 * @param currentMileage  - vehicle.mileage as currently stored
 * @param currentHours    - vehicle.hours as currently stored
 */
export async function updateVehicleUsage(
  vehicleId: string,
  milesVal: number | null,
  hoursVal: number | null,
  recordedAt: string,
  currentMileage: number | null,
  currentHours: number | null,
): Promise<void> {
  const now = new Date().toISOString();

  // Mileage: the client currentMileage is a cheap pre-filter only. The
  // authoritative up-only guard is the server WHERE clause below —
  // (mileage IS NULL OR mileage < milesVal) — so a stale client baseline can
  // never regress vehicles.mileage. History is recorded only when the server
  // actually raised the odometer (the update returned a row).
  if (milesVal != null && milesVal > (currentMileage ?? 0)) {
    const { data: raised, error: updErr } = await supabase
      .from("vehicles")
      .update({ mileage: milesVal, updated_at: now })
      .eq("id", vehicleId)
      .or(`mileage.is.null,mileage.lt.${milesVal}`)
      .select("id");
    if (updErr) {
      console.warn("[vehicleUsageHelper] mileage update failed:", updErr.message);
    } else if (raised && raised.length > 0) {
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) {
        console.warn("[vehicleUsageHelper] skipping mileage history insert: no auth user");
      } else {
        const { error: histErr } = await supabase.from("vehicle_mileage_history").insert({
          user_id: user.id,
          vehicle_id: vehicleId,
          mileage: milesVal,
          recorded_at: recordedAt,
          created_at: now,
        });
        if (histErr) console.warn("[vehicleUsageHelper] mileage history insert failed:", histErr.message);
      }
    }
  }

  // Hours: same server-side up-only guard.
  if (hoursVal != null && hoursVal > (currentHours ?? 0)) {
    const { error: hoursErr } = await supabase
      .from("vehicles")
      .update({ hours: hoursVal, last_hours_update: now, updated_at: now })
      .eq("id", vehicleId)
      .or(`hours.is.null,hours.lt.${hoursVal}`);
    if (hoursErr) console.warn("[vehicleUsageHelper] hours update failed:", hoursErr.message);
  }
}
