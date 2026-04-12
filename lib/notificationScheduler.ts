import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { supabase } from "./supabase";
import { loadNotifPrefs } from "./notificationPrefs";
import * as Sentry from "@sentry/react-native";

function parseNotifTime(timeStr: string): { hour: number; minute: number } {
  const parts = (timeStr ?? "09:00").split(":");
  const hour = parseInt(parts[0] ?? "9", 10);
  const minute = parseInt(parts[1] ?? "0", 10);
  return {
    hour: isNaN(hour) ? 9 : hour,
    minute: isNaN(minute) ? 0 : minute,
  };
}

function parseDueDateAnchor(dueDateInput: string | null | undefined): Date | null {
  if (!dueDateInput) return null;
  const raw = String(dueDateInput).trim();
  if (!raw) return null;
  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!ymd) return null;
  const year = Number(ymd[1]);
  const month = Number(ymd[2]) - 1;
  const day = Number(ymd[3]);
  const anchored = new Date(year, month, day, 12, 0, 0, 0);
  return Number.isNaN(anchored.getTime()) ? null : anchored;
}

function parseMedicationTime(timeStr: string | null | undefined): { hour: number; minute: number } | null {
  if (!timeStr) return null;
  const trimmed = timeStr.trim();
  // Match formats like "8:00 AM", "12:30 PM", "8:00", "08:00"
  const match = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const meridiem = match[3]?.toUpperCase();

  if (isNaN(hour) || isNaN(minute)) return null;
  if (minute < 0 || minute > 59) return null;

  if (meridiem === "AM") {
    if (hour < 1 || hour > 12) return null;
    if (hour === 12) hour = 0;
  } else if (meridiem === "PM") {
    if (hour < 1 || hour > 12) return null;
    if (hour !== 12) hour += 12;
  } else {
    if (hour < 0 || hour > 23) return null;
  }

  return { hour, minute };
}

export type UpsertPushTokenResult = {
  ok: boolean;
  token: string | null;
  reason: string | null;
};

export async function resolveAuthUserId(): Promise<string | null> {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) {
      console.warn("[NotifSetup] resolveAuthUserId threw:", error);
      return null;
    }
    if (!user?.id) {
      console.warn("[NotifSetup] no authenticated user");
      return null;
    }
    return user.id;
  } catch (err) {
    console.warn("[NotifSetup] resolveAuthUserId threw:", err);
    return null;
  }
}

export async function upsertPushToken(userId: string): Promise<UpsertPushTokenResult> {
  if (Platform.OS === "web") return { ok: false, token: null, reason: "web platform" };
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as any).easConfig?.projectId ??
    "2b817e52-5d6d-43c4-9855-966f7ded10ad";

  let tokenData: Awaited<ReturnType<typeof Notifications.getExpoPushTokenAsync>> | null = null;
  try {
    tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
  } catch (err) {
    console.warn("[PushToken] getExpoPushTokenAsync threw:", err);
    return { ok: false, token: null, reason: "getExpoPushTokenAsync threw" };
  }

  const token = tokenData?.data ?? null;
  if (!token) {
    console.warn("[PushToken] Empty token returned");
    return { ok: false, token: null, reason: "empty token" };
  }

  // Attempt first profiles update — log error but always proceed to readback regardless
  try {
    const { error } = await (supabase.from("profiles") as any)
      .update({ push_token: token })
      .eq("user_id", userId);
    if (error) {
      console.warn("[PushToken] profiles update failed:", error.message);
    }
  } catch (err) {
    console.warn("[PushToken] profiles update threw:", err);
  }

  // Readback 1: verify token was actually persisted via user_id selector
  let verified = false;
  try {
    const { data: readback } = await (supabase.from("profiles") as any)
      .select("push_token")
      .eq("user_id", userId)
      .maybeSingle();
    verified = readback?.push_token === token;
  } catch (err) {
    console.warn("[PushToken] profiles readback threw:", err);
  }

  if (!verified) {
    console.warn("[PushToken] profiles readback mismatch");
    return { ok: false, token, reason: "profiles readback mismatch" };
  }

  return { ok: true, token, reason: null };
}

type Candidate = {
  body: string;
  triggerDate: Date;
  priority: number;
};

export async function scheduleMaintenanceNotifications(userId: string): Promise<void> {
  if (Platform.OS === "web") return;

  try {
    const warmupStart = Date.now();
    let warmedUp = false;
    while (Date.now() - warmupStart < 2000) {
      try {
        await Notifications.getAllScheduledNotificationsAsync();
        warmedUp = true;
        break;
      } catch {
        await new Promise(r => setTimeout(r, 100));
      }
    }
    if (!warmedUp) {
      console.warn("[NotifScheduler] aborting scheduling run: native module warmup failed after 2s");
      return;
    }

    const { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") return;

    // Register/refresh the push token whenever OS permission is granted,
    // regardless of the in-app pushEnabled toggle.
    const tokenRefreshResult = await upsertPushToken(userId);
    if (!tokenRefreshResult.ok) {
      console.warn("[NotificationScheduler] upsertPushToken failed:", tokenRefreshResult.reason);
    }

    const prefs = await loadNotifPrefs();

    if (!prefs.pushEnabled) {
      if (__DEV__) {
        console.log("[NotifScheduler] skipped scheduling:", { pushEnabled: false, reason: "push disabled" });
      }
      await Notifications.cancelAllScheduledNotificationsAsync();
      await Notifications.setBadgeCountAsync(0);
      return;
    }

    const [vehiclesRes, propertiesRes, medicationsRes] = await Promise.all([
      supabase
        .from("vehicles")
        .select("id, year, make, model, nickname, mileage, hours, tracking_mode, vehicle_type")
        .eq("user_id", userId),
      supabase
        .from("properties")
        .select("id, address, nickname")
        .eq("user_id", userId),
      supabase
        .from("medications")
        .select("id, name, reminder_time, reminders_enabled, family_member_id, family_members(name)")
        .eq("user_id", userId)
        .eq("reminders_enabled", true),
    ]);

    const vehicles = vehiclesRes.data ?? [];
    const properties = propertiesRes.data ?? [];
    const medications = medicationsRes.data ?? [];
    const vehicleIds = vehicles.map(v => v.id);
    const propertyIds = properties.map(p => p.id);

    const [vehicleTasksRes, propertyTasksRes] = await Promise.all([
      vehicleIds.length > 0
        ? supabase
            .from("user_vehicle_maintenance_tasks")
            .select("id, vehicle_id, name, next_due_date, next_due_miles, next_due_hours")
            .in("vehicle_id", vehicleIds)
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
    const MAX_FUTURE_MS = 5 * 365 * 24 * 60 * 60 * 1000;

    // iOS allows 64 scheduled local notifications total. DAILY repeating
    // triggers count as 1 slot. Medications and maintenance share this pool.
    // 4 slots reserved for ad-hoc notifications outside this scheduler
    // (BudgetAlertContext, etc.). Medications take priority over maintenance
    // because missing a dose has real health consequences.
    const TOTAL_NOTIFICATION_BUDGET = 60;

    const candidates: Candidate[] = [];

    function enqueue(taskName: string, assetName: string, dueDateStr: string, isMuted: boolean) {
      if (isMuted) return;

      const dueDate = parseDueDateAnchor(dueDateStr);
      if (!dueDate) {
        if (__DEV__) {
          console.warn("[NotifScheduler] skipped invalid due date:", { taskName, assetName, dueDateStr });
        }
        return;
      }

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
        const triggerDate = new Date(dueDate.getTime());
        triggerDate.setDate(triggerDate.getDate() + days);
        triggerDate.setHours(hour, minute, 0, 0);

        const t = triggerDate.getTime();
        if (!Number.isFinite(t)) {
          if (__DEV__) {
            console.warn("[NotifScheduler] skipped invalid trigger date:", { taskName, assetName, dueDateStr, days });
          }
          continue;
        }
        if (t - now.getTime() > MAX_FUTURE_MS) {
          if (__DEV__) {
            console.warn("[NotifScheduler] skipped far-future trigger date:", { taskName, assetName, dueDateStr, days });
          }
          continue;
        }
        if (triggerDate <= now) continue;

        candidates.push({
          body: `🔧 ${taskName} on ${assetName} ${label}`,
          triggerDate,
          priority,
        });
      }
    }

    // ── Vehicle notifications: unified date + usage pass ────────────────
    // Each task gets AT MOST one notification per offset cycle.
    for (const task of vehicleTasks) {
      const vehicle = vehicleMap.get(task.vehicle_id);
      if (!vehicle) continue;
      const assetName = vehicle.nickname ?? `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
      const isMuted = (prefs.mutedVehicles ?? []).includes(task.vehicle_id);
      if (isMuted) continue;

      // Date-based notifications (existing behavior)
      if (task.next_due_date) {
        enqueue(task.name, assetName, task.next_due_date, false);
      }

      // Usage-based notifications (new)
      const trackingMode = (vehicle as any).tracking_mode ?? "";
      const isBoth = trackingMode === "both";
      const isHoursMode = trackingMode === "hours" || isBoth;
      const isMilesMode = trackingMode === "mileage" || isBoth;

      // Check hours
      let hoursRemaining: number | null = null;
      if (isHoursMode && (vehicle as any).hours != null && task.next_due_hours != null) {
        hoursRemaining = Number(task.next_due_hours) - Number((vehicle as any).hours);
      }

      // Check miles
      let milesRemaining: number | null = null;
      if (isMilesMode && (vehicle as any).mileage != null && task.next_due_miles != null) {
        milesRemaining = Number(task.next_due_miles) - Number((vehicle as any).mileage);
      }

      // Pick the more urgent usage dimension
      let usageRemaining: number | null = null;
      let usageUnit = "";
      if (hoursRemaining != null && milesRemaining != null) {
        // Both tracked: use whichever is more urgent (lower remaining)
        if (hoursRemaining <= milesRemaining) {
          usageRemaining = hoursRemaining;
          usageUnit = "hours";
        } else {
          usageRemaining = milesRemaining;
          usageUnit = "miles";
        }
      } else if (hoursRemaining != null) {
        usageRemaining = hoursRemaining;
        usageUnit = "hours";
      } else if (milesRemaining != null) {
        usageRemaining = milesRemaining;
        usageUnit = "miles";
      }

      if (usageRemaining == null) continue;

      // Only add usage notification if no date-based notification already covers this urgency,
      // OR if the task has no date at all
      const hasDateNotif = task.next_due_date != null;
      const dateAnchor = hasDateNotif ? parseDueDateAnchor(task.next_due_date) : null;
      const dateOverdue = !!dateAnchor && dateAnchor.getTime() < now.getTime();
      const usageOverdue = usageRemaining <= 0;
      const usageDueSoon = usageUnit === "hours" ? usageRemaining <= 25 : usageRemaining <= 500;

      // Skip usage notification if date already shows overdue (avoid duplicate)
      if (dateOverdue && usageOverdue) continue;

      // Schedule usage notification for tomorrow morning
      const triggerDate = new Date();
      triggerDate.setDate(triggerDate.getDate() + 1);
      triggerDate.setHours(hour, minute, 0, 0);
      if (triggerDate <= now) continue;

      if (usageOverdue) {
        candidates.push({
          body: `\u{1F527} ${task.name} on ${assetName} is ${Math.abs(Math.round(usageRemaining)).toLocaleString()} ${usageUnit} overdue`,
          triggerDate,
          priority: 0,
        });
      } else if (usageDueSoon && !hasDateNotif) {
        // Only add due-soon usage notification if there's no date-based notification for this task
        candidates.push({
          body: `\u{1F527} ${task.name} on ${assetName} is due in ${Math.round(usageRemaining).toLocaleString()} ${usageUnit}`,
          triggerDate,
          priority: 1,
        });
      }
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

    // ── Quiet hours filter ──────────────────────────────────────────────
    const qStart = prefs.quietHoursStart ?? "22:00";
    const qEnd = prefs.quietHoursEnd ?? "08:00";
    const [qsH, qsM] = qStart.split(":").map(Number);
    const [qeH, qeM] = qEnd.split(":").map(Number);
    const qsMin = qsH * 60 + (qsM || 0);
    const qeMin = qeH * 60 + (qeM || 0);

    for (const c of candidates) {
      const trigMin = c.triggerDate.getHours() * 60 + c.triggerDate.getMinutes();
      const inQuiet = qsMin < qeMin
        ? (trigMin >= qsMin && trigMin < qeMin)   // e.g., 01:00–06:00
        : (trigMin >= qsMin || trigMin < qeMin);   // e.g., 22:00–08:00 (wraps midnight)
      if (inQuiet) {
        c.triggerDate.setHours(qeH, qeM || 0, 0, 0);
        if (c.triggerDate <= now) {
          c.triggerDate.setDate(c.triggerDate.getDate() + 1);
        }
      }
    }

    await Notifications.cancelAllScheduledNotificationsAsync();

    // ── Medication daily reminders (priority over maintenance) ──────────
    // Medications get whatever they need from the budget first.
    // Maintenance fills whatever's left.
    const enabledMedications = medications.filter(
      (m: any) => m.reminders_enabled && m.reminder_time
    );
    let medicationsScheduled = 0;
    let medicationsParseSkipped = 0;

    for (const med of enabledMedications) {
      if (medicationsScheduled >= TOTAL_NOTIFICATION_BUDGET) {
        const dropped = enabledMedications.length - medicationsScheduled;
        console.error(
          `[NotifScheduler] iOS cap reached with medications alone. Dropping ${dropped} medication reminder(s) and ALL maintenance reminders.`
        );
        try {
          Sentry.captureMessage("Medication reminder cap exceeded", {
            level: "warning",
            extra: {
              userId,
              enabledMedicationCount: enabledMedications.length,
              scheduled: medicationsScheduled,
              dropped,
              cap: TOTAL_NOTIFICATION_BUDGET,
            },
          });
        } catch {}
        break;
      }

      const parsed = parseMedicationTime(med.reminder_time);
      if (!parsed) {
        medicationsParseSkipped++;
        console.warn("[NotifScheduler] skipped medication with unparseable reminder_time:", {
          medId: med.id,
          name: med.name,
          reminder_time: med.reminder_time,
        });
        try {
          Sentry.captureMessage("Medication reminder_time unparseable", {
            level: "warning",
            extra: {
              userId,
              medId: med.id,
              name: med.name,
              reminder_time: med.reminder_time,
            },
          });
        } catch {}
        continue;
      }

      // Quiet hours filter for medications.
      let medHour = parsed.hour;
      let medMinute = parsed.minute;
      const medTrigMin = medHour * 60 + medMinute;
      const inQuiet = qsMin < qeMin
        ? (medTrigMin >= qsMin && medTrigMin < qeMin)
        : (medTrigMin >= qsMin || medTrigMin < qeMin);
      if (inQuiet) {
        medHour = qeH;
        medMinute = qeM || 0;
      }

      const memberName = (med as any).family_members?.name;
      const subjectPrefix = memberName ? `${memberName}: ` : "";

      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: "Medication Reminder",
            body: `${subjectPrefix}Time to take ${med.name}`,
            sound: true,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DAILY,
            hour: medHour,
            minute: medMinute,
          },
        });
        medicationsScheduled++;
      } catch (err) {
        console.warn("[NotifScheduler] medication scheduleNotificationAsync threw:", { medId: med.id, err });
        try {
          Sentry.captureException(err, {
            extra: {
              context: "medication scheduleNotificationAsync",
              userId,
              medId: med.id,
            },
          });
        } catch {}
      }
    }

    // ── Date-based maintenance notifications (fills remaining budget) ──
    const maintenanceBudget = Math.max(0, TOTAL_NOTIFICATION_BUDGET - medicationsScheduled);
    const toSchedule = candidates.slice(0, maintenanceBudget);

    if (__DEV__) {
      console.log("[NotifScheduler] scheduling run:", {
        pushEnabled: prefs.pushEnabled,
        advanceDays: prefs.advanceDays,
        quietHoursStart: prefs.quietHoursStart,
        quietHoursEnd: prefs.quietHoursEnd,
        notificationTime: prefs.notificationTime,
        mutedVehiclesCount: (prefs.mutedVehicles ?? []).length,
        mutedPropertiesCount: (prefs.mutedProperties ?? []).length,
        candidateCount: candidates.length,
        enabledMedications: enabledMedications.length,
        medicationsScheduled,
        medicationsParseSkipped,
        maintenanceBudget,
        scheduledCount: toSchedule.length,
        totalBudget: TOTAL_NOTIFICATION_BUDGET,
      });
    }

    for (const { body, triggerDate } of toSchedule) {
      const tt = triggerDate.getTime();
      if (!Number.isFinite(tt)) {
        if (__DEV__) {
          console.warn("[NotifScheduler] skipped scheduleNotificationAsync for invalid trigger:", { body });
        }
        continue;
      }
      if (tt - now.getTime() > MAX_FUTURE_MS) {
        if (__DEV__) {
          console.warn("[NotifScheduler] skipped scheduleNotificationAsync for far-future trigger:", { body });
        }
        continue;
      }
      try {
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
      } catch (err) {
        console.warn("[NotifScheduler] scheduleNotificationAsync threw:", err);
      }
    }

    if (__DEV__) {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      const normalized = scheduled
        .map((n: any) => {
          const triggerValue = n?.trigger?.value;
          const rawDate =
            (typeof triggerValue === "number" ? triggerValue : null) ??
            (triggerValue && typeof triggerValue === "object" ? triggerValue.date : null) ??
            n?.trigger?.date ??
            n?.trigger?.timestamp ??
            null;

          let ts: number | null = null;

          if (typeof rawDate === "number") {
            ts = rawDate > 1e12 ? rawDate : rawDate * 1000;
          } else if (typeof rawDate === "string") {
            const parsed = Date.parse(rawDate);
            ts = Number.isFinite(parsed) ? parsed : null;
          } else if (rawDate instanceof Date) {
            ts = rawDate.getTime();
          }

          return {
            body: n?.content?.body ?? "(no body)",
            title: n?.content?.title ?? "(no title)",
            ts,
          };
        })
        .filter((x: any) => x.ts != null)
        .sort((a: any, b: any) => a.ts - b.ts);

      console.log("[NotifScheduler] next scheduled reminders:", normalized.slice(0, 5).map((x: any) => ({
        title: x.title,
        body: x.body,
        iso: new Date(x.ts).toISOString(),
        local: new Date(x.ts).toString(),
      })));
    }

    const overdueVehicle = vehicleTasks.filter(t => {
      if ((prefs.mutedVehicles ?? []).includes(t.vehicle_id)) return false;
      // Date-based overdue
      {
        const dueDate = parseDueDateAnchor(t.next_due_date);
        if (dueDate && dueDate.getTime() < now.getTime()) return true;
      }
      // Usage-based overdue
      const vehicle = vehicleMap.get(t.vehicle_id);
      if (vehicle) {
        const tm = (vehicle as any).tracking_mode ?? "";
        const isH = tm === "hours" || tm === "both";
        const isM = tm === "mileage" || tm === "both";
        if (isH && (vehicle as any).hours != null && t.next_due_hours != null) {
          if (Number((vehicle as any).hours) >= Number(t.next_due_hours)) return true;
        }
        if (isM && (vehicle as any).mileage != null && t.next_due_miles != null) {
          if (Number((vehicle as any).mileage) >= Number(t.next_due_miles)) return true;
        }
      }
      return false;
    }).length;

    const overdueProperty = propertyTasks.filter(t => {
      if (!t.next_due_date) return false;
      if ((prefs.mutedProperties ?? []).includes(t.property_id)) return false;
      const dueDate = parseDueDateAnchor(t.next_due_date);
      return !!dueDate && dueDate.getTime() < now.getTime();
    }).length;

    const overdueHealth = healthApptsData.filter(a => {
      const dueDate = parseDueDateAnchor(a.next_due_date);
      return !!dueDate && dueDate.getTime() < now.getTime();
    }).length;

    await Notifications.setBadgeCountAsync(overdueVehicle + overdueProperty + overdueHealth);

  } catch (err) {
    console.error("Notification scheduling failed:", err);
  }
}
