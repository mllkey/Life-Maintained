import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { supabase } from "@/lib/supabase";

interface BudgetAlertValue {
  monthlyCost: number;
  budgetThreshold: number | null;
  refreshBudget: () => void;
}

const BudgetAlertContext = createContext<BudgetAlertValue>({
  monthlyCost: 0,
  budgetThreshold: null,
  refreshBudget: () => {},
});

export function useBudgetAlert() {
  return useContext(BudgetAlertContext);
}

interface Props {
  userId: string | null;
  children: React.ReactNode;
}

export function BudgetAlertProvider({ userId, children }: Props) {
  const [monthlyCost, setMonthlyCost] = useState(0);
  const [budgetThreshold, setBudgetThreshold] = useState<number | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  async function refresh() {
    if (!userId) return;
    try {
      const now = new Date();
      const y = now.getFullYear();
      const m = now.getMonth();
      const monthStart = new Date(y, m, 1).toISOString().slice(0, 10);
      const monthEnd = new Date(y, m + 1, 0).toISOString().slice(0, 10);

      const [vehicleIdsRes, propertyTasksRes, prefsRes] = await Promise.all([
        supabase.from("vehicles").select("id").eq("user_id", userId),
        supabase
          .from("property_maintenance_tasks")
          .select("estimated_cost")
          .eq("user_id", userId)
          .not("estimated_cost", "is", null)
          .gte("next_due_date", monthStart)
          .lte("next_due_date", monthEnd),
        (supabase.from("user_notification_preferences") as any)
          .select("budget_threshold, push_enabled")
          .eq("user_id", userId)
          .maybeSingle(),
      ]);

      const vehicleIds = (vehicleIdsRes.data ?? []).map((v: any) => v.id);
      const propertySum = (propertyTasksRes.data ?? []).reduce(
        (s: number, t: any) => s + (t.estimated_cost ?? 0),
        0
      );

      let vehicleSum = 0;
      if (vehicleIds.length > 0) {
        // Get all due vehicle tasks this month
        const { data: dueVehicleTasks } = await supabase
          .from("user_vehicle_maintenance_tasks")
          .select("vehicle_id, name")
          .in("vehicle_id", vehicleIds)
          .not("next_due_date", "is", null)
          .gte("next_due_date", monthStart)
          .lte("next_due_date", monthEnd);

        if (dueVehicleTasks && dueVehicleTasks.length > 0) {
          // Batch: load all vehicles at once
          const uniqueVehicleIds = [...new Set(dueVehicleTasks.map(t => t.vehicle_id))];
          const { data: vehicles } = await supabase
            .from("vehicles")
            .select("id, year, make, model, vehicle_type")
            .in("id", uniqueVehicleIds);

          if (vehicles) {
            const vehicleMap = new Map(vehicles.map(v => [v.id, v]));

            // Build all cache keys, then batch query
            const lookups = dueVehicleTasks.map(t => {
              const v = vehicleMap.get(t.vehicle_id);
              if (!v) return null;
              return {
                vehicleKey: `${v.year ?? ""}|${v.make}|${v.model ?? ""}|${v.vehicle_type ?? ""}`.toLowerCase(),
                serviceKey: t.name.toLowerCase().trim(),
              };
            }).filter(Boolean) as { vehicleKey: string; serviceKey: string }[];

            // Query all matching estimates in one call per unique vehicle key
            const uniqueVehicleKeys = [...new Set(lookups.map(l => l.vehicleKey))];
            const { data: allEstimates } = await supabase
              .from("repair_cost_cache")
              .select("vehicle_key, service_name, shop_low, shop_high")
              .in("vehicle_key", uniqueVehicleKeys);

            if (allEstimates) {
              const estimateMap = new Map(allEstimates.map(e => [`${e.vehicle_key}|${e.service_name}`, e]));
              for (const lookup of lookups) {
                const est = estimateMap.get(`${lookup.vehicleKey}|${lookup.serviceKey}`);
                if (est) {
                  vehicleSum += Math.round((Number(est.shop_low) + Number(est.shop_high)) / 2);
                }
              }
            }
          }
        }
      }

      const total = vehicleSum + propertySum;
      const threshold = prefsRes.data?.budget_threshold ?? null;
      const pushEnabled = prefsRes.data?.push_enabled ?? false;

      setMonthlyCost(total);
      setBudgetThreshold(threshold);

      if (
        Platform.OS !== "web" &&
        now.getDate() === 1 &&
        pushEnabled &&
        threshold &&
        threshold > 0 &&
        total > threshold
      ) {
        const sentKey = `budget_notif_sent_${y}_${String(m + 1).padStart(2, "0")}`;
        const alreadySent = await AsyncStorage.getItem(sentKey);
        if (!alreadySent) {
          try {
            const { status } = await Notifications.getPermissionsAsync();
            if (status === "granted") {
              await Notifications.scheduleNotificationAsync({
                identifier: `budget_alert_${y}_${String(m + 1).padStart(2, "0")}`,
                content: {
                  title: "LifeMaintained",
                  body: `$${total.toFixed(0)} in maintenance estimated this month — tap to review`,
                  sound: true,
                },
                trigger: null,
              });
              await AsyncStorage.setItem(sentKey, "true");
            }
          } catch {}
        }
      }
    } catch {}
  }

  useEffect(() => {
    refresh();

    const sub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;
      if (nextState === "active" && prev !== "active") {
        refresh();
      }
    });

    return () => sub.remove();
  }, [userId]);

  return (
    <BudgetAlertContext.Provider value={{ monthlyCost, budgetThreshold, refreshBudget: refresh }}>
      {children}
    </BudgetAlertContext.Provider>
  );
}
