import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { supabase } from "./supabase";

const PREFS_KEY = "notification_prefs";

const DEFAULT_PREFS = {
  pushEnabled: false,
  advanceDays: 14,
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
  notificationTime: "09:00",
  mutedVehicles: [] as string[],
  mutedProperties: [] as string[],
};

type NotifPrefs = typeof DEFAULT_PREFS;

async function loadPrefs(): Promise<NotifPrefs> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

function parseNotifTime(timeStr: string): { hour: number; minute: number } {
  const parts = (timeStr ?? "09:00").split(":");
  const hour = parseInt(parts[0] ?? "9", 10);
  const minute = parseInt(parts[1] ?? "0", 10);
  return {
    hour: isNaN(hour) ? 9 : hour,
    minute: isNaN(minute) ? 0 : minute,
  };
}

async function upsertPushToken(userId: string): Promise<void> {
  try {
    if (Platform.OS === "web") return;
    const tokenData = await Notifications.getExpoPushTokenAsync();
    if (tokenData?.data) {
      await (supabase.from("profiles") as any)
        .update({ push_token: tokenData.data })
        .eq("user_id", userId);
    }
  } catch {
  }
}

type Candidate = {
  body: string;
  triggerDate: Date;
  priority: number;
};

export async function scheduleMaintenanceNotifications(userId: string): Promise<void> {
  if (Platform.OS === "web") return;

  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") return;

    const prefs = await loadPrefs();

    if (!prefs.pushEnabled) {
      await Notifications.cancelAllScheduledNotificationsAsync();
      await Notifications.setBadgeCountAsync(0);
      return;
    }

    upsertPushToken(userId);

    const [vehiclesRes, propertiesRes] = await Promise.all([
      supabase
        .from("vehicles")
        .select("id, year, make, model, nickname")
        .eq("user_id", userId),
      supabase
        .from("properties")
        .select("id, address, nickname")
        .eq("user_id", userId),
    ]);

    const vehicles = vehiclesRes.data ?? [];
    const properties = propertiesRes.data ?? [];
    const vehicleIds = vehicles.map(v => v.id);
    const propertyIds = properties.map(p => p.id);

    const [vehicleTasksRes, propertyTasksRes] = await Promise.all([
      vehicleIds.length > 0
        ? supabase
            .from("user_vehicle_maintenance_tasks")
            .select("vehicle_id, name, next_due_date")
            .in("vehicle_id", vehicleIds)
            .not("next_due_date", "is", null)
        : Promise.resolve({ data: [] as any[] }),
      propertyIds.length > 0
        ? supabase
            .from("property_maintenance_tasks")
            .select("property_id, task, next_due_date")
            .in("property_id", propertyIds)
            .not("next_due_date", "is", null)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const vehicleTasks = vehicleTasksRes.data ?? [];
    const propertyTasks = propertyTasksRes.data ?? [];

    const vehicleMap = new Map(vehicles.map(v => [v.id, v]));
    const propertyMap = new Map(properties.map(p => [p.id, p]));

    const { hour, minute } = parseNotifTime(prefs.notificationTime ?? "09:00");
    const now = new Date();
    const msPerDay = 1000 * 60 * 60 * 24;

    const candidates: Candidate[] = [];

    function enqueue(taskName: string, assetName: string, dueDateStr: string, isMuted: boolean) {
      if (isMuted) return;

      const dueDate = new Date(dueDateStr + "T12:00:00");
      const daysUntilDue = Math.floor((dueDate.getTime() - now.getTime()) / msPerDay);

      const priority =
        daysUntilDue < 0 ? 0
        : daysUntilDue <= 7 ? 1
        : daysUntilDue <= 30 ? 2
        : 3;

      const advDays = prefs.advanceDays ?? 14;
      const OFFSETS = [
        ...(advDays >= 30 ? [{ days: -30, label: "is due in 30 days" }] : []),
        ...(advDays >= 14 ? [{ days: -14, label: "is due in 2 weeks" }] : []),
        ...(advDays >= 7 ? [{ days: -7, label: "is due in 7 days" }] : []),
        { days: -3, label: "is due in 3 days" },
        { days: 0, label: "is due today" },
        { days: 7, label: "is 7 days overdue" },
      ];

      for (const { days, label } of OFFSETS) {
        const triggerDate = new Date(dueDate);
        triggerDate.setDate(triggerDate.getDate() + days);
        triggerDate.setHours(hour, minute, 0, 0);
        if (triggerDate <= now) continue;
        candidates.push({
          body: `🔧 ${taskName} on ${assetName} ${label}`,
          triggerDate,
          priority,
        });
      }
    }

    for (const task of vehicleTasks) {
      if (!task.next_due_date) continue;
      const vehicle = vehicleMap.get(task.vehicle_id);
      if (!vehicle) continue;
      const assetName = vehicle.nickname ?? `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
      const isMuted = (prefs.mutedVehicles ?? []).includes(task.vehicle_id);
      enqueue(task.name, assetName, task.next_due_date, isMuted);
    }

    for (const task of propertyTasks) {
      if (!task.next_due_date) continue;
      const property = propertyMap.get(task.property_id);
      if (!property) continue;
      const assetName = property.nickname ?? property.address ?? "Property";
      const isMuted = (prefs.mutedProperties ?? []).includes(task.property_id);
      enqueue(task.task, assetName, task.next_due_date, isMuted);
    }

    // ── Health appointments (single query, reused for scheduling + badge) ──
    let healthApptsData: any[] = [];
    try {
      const { data: healthAppts } = await supabase
        .from("health_appointments")
        .select("appointment_type, next_due_date, family_member_id, family_members(name)")
        .eq("user_id", userId)
        .not("next_due_date", "is", null);

      healthApptsData = healthAppts ?? [];

      for (const appt of healthApptsData) {
        if (!appt.next_due_date) continue;
        const memberName = (appt as any).family_members?.name;
        const assetName = memberName ? `${memberName}'s` : "Your";
        enqueue(appt.appointment_type, assetName, appt.next_due_date, false);
      }
    } catch (e) {
      console.warn("[NOTIF] Health appointments query failed:", e);
    }

    candidates.sort((a, b) =>
      a.priority !== b.priority
        ? a.priority - b.priority
        : a.triggerDate.getTime() - b.triggerDate.getTime()
    );

    const toSchedule = candidates.slice(0, 64);

    await Notifications.cancelAllScheduledNotificationsAsync();

    for (const { body, triggerDate } of toSchedule) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "LifeMaintained",
          body,
          sound: true,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: triggerDate,
        },
      });
    }

    const overdueVehicle = vehicleTasks.filter(t => {
      if (!t.next_due_date) return false;
      if ((prefs.mutedVehicles ?? []).includes(t.vehicle_id)) return false;
      return new Date(t.next_due_date + "T12:00:00") < now;
    }).length;

    const overdueProperty = propertyTasks.filter(t => {
      if (!t.next_due_date) return false;
      if ((prefs.mutedProperties ?? []).includes(t.property_id)) return false;
      return new Date(t.next_due_date + "T12:00:00") < now;
    }).length;

    const overdueHealth = healthApptsData.filter(a =>
      a.next_due_date && new Date(a.next_due_date + "T12:00:00") < now
    ).length;

    await Notifications.setBadgeCountAsync(overdueVehicle + overdueProperty + overdueHealth);

  } catch (err) {
    console.error("Notification scheduling failed:", err);
  }
}
