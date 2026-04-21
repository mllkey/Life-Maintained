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

  if (milesVal != null && milesVal > (currentMileage ?? 0)) {
    await supabase
      .from("vehicles")
      .update({ mileage: milesVal, updated_at: now })
      .eq("id", vehicleId);

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      console.warn("[vehicleUsageHelper] skipping mileage history insert: no auth user");
    } else {
      await supabase.from("vehicle_mileage_history").insert({
        user_id: user.id,
        vehicle_id: vehicleId,
        mileage: milesVal,
        recorded_at: recordedAt,
        created_at: now,
      });
    }
  }

  if (hoursVal != null && hoursVal > (currentHours ?? 0)) {
    await supabase
      .from("vehicles")
      .update({ hours: hoursVal, updated_at: now })
      .eq("id", vehicleId);
  }
}
