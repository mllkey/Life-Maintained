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

      const vehicleSum = 0;

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
