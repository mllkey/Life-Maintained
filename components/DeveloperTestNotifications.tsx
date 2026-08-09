// DEV-ONLY TEST TOOL — notification deep-link validation.
//
// Gated to __DEV__ in app/(tabs)/settings.tsx, so it never ships in a
// production build. The temporary email-based gate used for TestFlight
// validation has been removed; do not reintroduce it.

import React, { useEffect, useState, useCallback } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import * as Notifications from "expo-notifications";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";

type NotifAssetKind = "vehicle" | "property" | "family_member";
type NotifTaskKind = "vehicle_task" | "property_task" | "health_appointment" | "medication";

type SeedEntry = { assetId: string; assetName: string; taskId: string; taskName: string };

type TestSeed = {
  vehicleTask: SeedEntry | null;
  propertyTask: SeedEntry | null;
  healthAppointment: SeedEntry | null;
  medication: SeedEntry | null;
};

const EMPTY_SEED: TestSeed = {
  vehicleTask: null,
  propertyTask: null,
  healthAppointment: null,
  medication: null,
};

function isValidId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export default function DeveloperTestNotifications() {
  const { user } = useAuth();
  const [seed, setSeed] = useState<TestSeed>(EMPTY_SEED);
  const [loading, setLoading] = useState(true);
  const [firingKind, setFiringKind] = useState<NotifTaskKind | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const loadSeed = useCallback(async () => {
    if (!user?.id) {
      setSeed(EMPTY_SEED);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [vehicleRes, propertyRes, apptRes, medRes] = await Promise.all([
        supabase
          .from("user_vehicle_maintenance_tasks")
          .select("id, name, vehicle_id, vehicles!inner(id, year, make, model, nickname, user_id)")
          .eq("vehicles.user_id", user.id)
          .limit(1)
          .maybeSingle(),
        supabase
          .from("property_maintenance_tasks")
          .select("id, task, property_id, properties!inner(id, address, nickname, user_id)")
          .eq("properties.user_id", user.id)
          .limit(1)
          .maybeSingle(),
        supabase
          .from("health_appointments")
          .select("id, appointment_type, family_member_id, family_members!inner(id, name, user_id)")
          .eq("user_id", user.id)
          .limit(1)
          .maybeSingle(),
        supabase
          .from("medications")
          .select("id, name, family_member_id, family_members!inner(id, name, user_id)")
          .eq("user_id", user.id)
          .limit(1)
          .maybeSingle(),
      ]);

      const v = vehicleRes.data as any;
      const p = propertyRes.data as any;
      const a = apptRes.data as any;
      const m = medRes.data as any;

      setSeed({
        vehicleTask:
          v && isValidId(v.vehicle_id) && isValidId(v.id)
            ? {
                assetId: v.vehicle_id,
                assetName:
                  v.vehicles?.nickname ??
                  (`${v.vehicles?.year ?? ""} ${v.vehicles?.make ?? ""} ${v.vehicles?.model ?? ""}`.trim() ||
                    "Vehicle"),
                taskId: v.id,
                taskName: v.name,
              }
            : null,
        propertyTask:
          p && isValidId(p.property_id) && isValidId(p.id)
            ? {
                assetId: p.property_id,
                assetName: p.properties?.nickname ?? p.properties?.address ?? "Property",
                taskId: p.id,
                taskName: p.task,
              }
            : null,
        healthAppointment:
          a && isValidId(a.family_member_id) && isValidId(a.id)
            ? {
                assetId: a.family_member_id,
                assetName: a.family_members?.name ?? "Family member",
                taskId: a.id,
                taskName: a.appointment_type,
              }
            : null,
        medication:
          m && isValidId(m.family_member_id) && isValidId(m.id)
            ? {
                assetId: m.family_member_id,
                assetName: m.family_members?.name ?? "Family member",
                taskId: m.id,
                taskName: m.name,
              }
            : null,
      });
    } catch (err) {
      if (__DEV__) console.warn("[DevTestNotif] loadSeed failed:", err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void loadSeed();
  }, [loadSeed]);

  async function fireTest(
    kind: NotifTaskKind,
    seedEntry: SeedEntry | null,
    assetKind: NotifAssetKind,
    title: string,
    body: string,
  ) {
    if (!seedEntry) return;

    if (
      !isValidId(seedEntry.assetId) ||
      !isValidId(seedEntry.taskId) ||
      !isValidId(assetKind) ||
      !isValidId(kind)
    ) {
      setInlineError("Test seed has an empty ID. Re-load and try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return;
    }

    setFiringKind(kind);
    setInlineError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    try {
      const perm = await Notifications.getPermissionsAsync();
      if (perm.status !== "granted") {
        setInlineError(
          "Notifications permission not granted. Enable in iOS Settings → LifeMaintained → Notifications, then try again.",
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        setFiringKind(null);
        return;
      }

      // DEV-ONLY: force the deep-linked item into a genuinely date-overdue state so the
      // reminder-fired moment has a reason to present. Medication is intentionally excluded
      // and must never be mutated (it must never fire the moment).
      const devPastDue = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
      const devPastCompleted = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
      // Each update ends with .select("id").single().throwOnError() so an RLS failure, a
      // zero-row update, or any error THROWS into the catch below and stops the notification
      // from firing — never produce a false "moment didn't fire" result from a silent write.
      if (kind === "vehicle_task") {
        await supabase.from("user_vehicle_maintenance_tasks").update({ next_due_date: devPastDue }).eq("id", seedEntry.taskId).select("id").single().throwOnError();
      } else if (kind === "property_task") {
        await supabase.from("property_maintenance_tasks").update({ next_due_date: devPastDue }).eq("id", seedEntry.taskId).select("id").single().throwOnError();
      } else if (kind === "health_appointment") {
        await supabase.from("health_appointments").update({ next_due_date: devPastDue, last_completed_at: devPastCompleted }).eq("id", seedEntry.taskId).select("id").single().throwOnError();
      }

      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          sound: true,
          data: {
            assetId: seedEntry.assetId,
            assetKind,
            taskId: seedEntry.taskId,
            taskKind: kind,
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(Date.now() + 5000),
        },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err) {
      if (__DEV__) console.warn("[DevTestNotif] schedule failed:", err);
      setInlineError("Failed to schedule the test notification. See dev console for details.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setFiringKind(null);
    }
  }

  const buttons: Array<{
    kind: NotifTaskKind;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    accent: string;
    seedEntry: SeedEntry | null;
    fire: () => Promise<void>;
  }> = [
    {
      kind: "vehicle_task",
      label: "Vehicle task",
      icon: "car-outline",
      accent: Colors.vehicle ?? Colors.accent,
      seedEntry: seed.vehicleTask,
      fire: () =>
        fireTest(
          "vehicle_task",
          seed.vehicleTask,
          "vehicle",
          "LifeMaintained",
          `🔧 ${seed.vehicleTask?.taskName ?? "Task"} on ${seed.vehicleTask?.assetName ?? "your vehicle"} is overdue`,
        ),
    },
    {
      kind: "property_task",
      label: "Property task",
      icon: "home-outline",
      accent: Colors.home ?? Colors.accent,
      seedEntry: seed.propertyTask,
      fire: () =>
        fireTest(
          "property_task",
          seed.propertyTask,
          "property",
          "LifeMaintained",
          `🏠 ${seed.propertyTask?.taskName ?? "Task"} on ${seed.propertyTask?.assetName ?? "your property"} is overdue`,
        ),
    },
    {
      kind: "health_appointment",
      label: "Family appointment",
      icon: "calendar-outline",
      accent: Colors.health ?? Colors.accent,
      seedEntry: seed.healthAppointment,
      fire: () =>
        fireTest(
          "health_appointment",
          seed.healthAppointment,
          "family_member",
          "LifeMaintained",
          `📅 ${seed.healthAppointment?.assetName ?? "Family member"}'s ${seed.healthAppointment?.taskName ?? "appointment"} is overdue`,
        ),
    },
    {
      kind: "medication",
      label: "Family medication",
      icon: "medkit-outline",
      accent: Colors.health ?? Colors.accent,
      seedEntry: seed.medication,
      fire: () =>
        fireTest(
          "medication",
          seed.medication,
          "family_member",
          "Medication Reminder",
          `${seed.medication?.assetName ?? "Family member"}: Time to take ${seed.medication?.taskName ?? "medication"}`,
        ),
    },
  ];

  return (
    <View>
      <Text style={styles.sectionLabel}>Developer</Text>
      <View style={styles.groupCard}>
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={Colors.accent} />
            <Text style={styles.loadingText}>Loading test seed…</Text>
          </View>
        ) : (
          buttons.map((b, idx) => {
            const disabled = b.seedEntry === null || firingKind !== null;
            return (
              <React.Fragment key={b.kind}>
                {idx > 0 && <View style={styles.divider} />}
                <Pressable
                  style={({ pressed }) => [
                    styles.row,
                    { opacity: pressed || disabled ? 0.55 : 1 },
                  ]}
                  onPress={b.fire}
                  disabled={disabled}
                >
                  <View style={[styles.iconWrap, { backgroundColor: `${b.accent}1A`, borderColor: `${b.accent}33` }]}>
                    <Ionicons name={b.icon} size={18} color={b.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowLabel}>{b.label}</Text>
                    <Text style={styles.rowSub}>
                      {b.seedEntry === null
                        ? "(no data — add one first)"
                        : `Fires in 5s · ${b.seedEntry.assetName} → ${b.seedEntry.taskName}`}
                    </Text>
                  </View>
                  {firingKind === b.kind ? (
                    <ActivityIndicator size="small" color={b.accent} />
                  ) : (
                    <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
                  )}
                </Pressable>
              </React.Fragment>
            );
          })
        )}
      </View>
      {inlineError ? (
        <View style={styles.errorCard}>
          <Ionicons name="alert-circle" size={16} color={Colors.overdue} />
          <Text style={styles.errorText}>{inlineError}</Text>
        </View>
      ) : null}
      <Text style={styles.hint}>
        Tap a button, then background the app within 5 seconds. The notification banner deep-links to the
        relevant screen on tap.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 4,
  },
  groupCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  loadingText: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  rowLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.text },
  rowSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary, marginTop: 2 },
  divider: { height: 1, backgroundColor: Colors.border, marginLeft: 60 },
  errorCard: {
    marginTop: 10,
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.overdue,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: Colors.overdue,
    lineHeight: 17,
  },
  hint: {
    marginTop: 8,
    paddingHorizontal: 4,
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    lineHeight: 16,
  },
});
