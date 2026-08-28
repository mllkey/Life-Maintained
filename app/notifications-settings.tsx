import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "@/constants/colors";
import { Icon } from "@/components/ui/Icon";
import { Typography } from "@/constants/typography";
import { Radius } from "@/constants/radius";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { upsertPushToken, resolveAuthUserId } from "@/lib/notificationScheduler";
import { loadNotifPrefs, saveNotifPrefs, type NotifPrefs, DEFAULT_NOTIF_PREFS } from "@/lib/notificationPrefs";
import Tooltip, { TOOLTIP_IDS } from "@/components/Tooltip";

export default function NotificationsSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_NOTIF_PREFS);
  const [isLoading, setIsLoading] = useState(true);
  const [budgetAmount, setBudgetAmount] = useState("");
  const [budgetSaved, setBudgetSaved] = useState(false);
  const budgetDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: vehicles } = useQuery({
    queryKey: ["vehicles", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase.from("vehicles").select("id, make, model, nickname, year").eq("user_id", user.id);
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: properties } = useQuery({
    queryKey: ["properties", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase.from("properties").select("id, address, nickname").eq("user_id", user.id);
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: budgetPref } = useQuery({
    queryKey: ["budget_threshold", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await (supabase.from("user_notification_preferences") as any)
        .select("budget_threshold")
        .eq("user_id", user.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  useEffect(() => {
    loadNotifPrefs().then(p => { setPrefs(p); setIsLoading(false); });
  }, []);

  useEffect(() => {
    if (budgetPref?.budget_threshold != null) {
      setBudgetAmount(String(budgetPref.budget_threshold));
    }
  }, [budgetPref]);

  async function updatePref<K extends keyof NotifPrefs>(key: K, value: NotifPrefs[K]) {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    await saveNotifPrefs(next);
  }

  async function togglePush() {
    if (!prefs.pushEnabled) {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission Required",
          "Please enable notifications in your device settings to receive maintenance reminders.",
          [{ text: "OK" }]
        );
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      const resolvedUserId = await resolveAuthUserId();
      if (!resolvedUserId) return;

      const tokenResult = await upsertPushToken(resolvedUserId);
      if (!tokenResult.ok) {
        console.warn("[NotifSettings] upsertPushToken failed:", tokenResult.reason);
        return;
      }

      let prefDbOk = false;
      try {
        const { error } = await (supabase.from("user_notification_preferences") as any)
          .upsert(
            { user_id: resolvedUserId, push_enabled: true, updated_at: new Date().toISOString() },
            { onConflict: "user_id" }
          );
        if (error) {
          console.warn("[NotifSettings] push_enabled DB upsert failed:", error.message);
        } else {
          try {
            const { data: readback } = await (supabase.from("user_notification_preferences") as any)
              .select("push_enabled")
              .eq("user_id", resolvedUserId)
              .maybeSingle();
            if (readback?.push_enabled === true) {
              prefDbOk = true;
            } else {
              console.warn("[NotifSettings] push_enabled readback mismatch");
            }
          } catch {
            console.warn("[NotifSettings] push_enabled readback threw");
          }
        }
      } catch (e) {
        console.warn("[NotifSettings] push_enabled DB upsert threw:", e);
      }
      if (!prefDbOk) return;

      try {
        await saveNotifPrefs({ ...prefs, pushEnabled: true });
      } catch (e) {
        console.warn("[NotifSettings] AsyncStorage pushEnabled write failed:", e);
      }
      setPrefs(p => ({ ...p, pushEnabled: true }));

    } else {
      // ── Disable path ─────────────────────────────────────────────────────
      // Resolve authenticated user id live from Supabase auth
      const resolvedUserId = await resolveAuthUserId();
      if (!resolvedUserId) return;

      // Step 1: DB upsert for push_enabled with readback — must confirm before AsyncStorage or UI
      let prefDbOk = false;
      try {
        const { error } = await (supabase.from("user_notification_preferences") as any)
          .upsert(
            { user_id: resolvedUserId, push_enabled: false, updated_at: new Date().toISOString() },
            { onConflict: "user_id" }
          );
        if (error) {
          console.warn("[NotifSettings] push_enabled DB upsert failed:", error.message);
        } else {
          try {
            const { data: readback } = await (supabase.from("user_notification_preferences") as any)
              .select("push_enabled")
              .eq("user_id", resolvedUserId)
              .maybeSingle();
            if (readback?.push_enabled === false) {
              prefDbOk = true;
            } else {
              console.warn("[NotifSettings] push_enabled readback mismatch");
            }
          } catch {
            console.warn("[NotifSettings] push_enabled readback threw");
          }
        }
      } catch (e) {
        console.warn("[NotifSettings] push_enabled DB upsert threw:", e);
      }
      if (!prefDbOk) return;

      // Step 2: AsyncStorage only after DB committed and verified
      try {
        await saveNotifPrefs({ ...prefs, pushEnabled: false });
      } catch (e) {
        console.warn("[NotifSettings] AsyncStorage pushEnabled write failed:", e);
        // DB already verified — sync UI to match committed DB intent
      }
      // Step 3: UI always reflects committed DB intent, regardless of AsyncStorage result
      setPrefs(p => ({ ...p, pushEnabled: false }));
    }
  }

  function toggleMutedVehicle(id: string) {
    const muted = prefs.mutedVehicles.includes(id)
      ? prefs.mutedVehicles.filter(v => v !== id)
      : [...prefs.mutedVehicles, id];
    updatePref("mutedVehicles", muted);
    Haptics.selectionAsync();
  }

  function toggleMutedProperty(id: string) {
    const muted = prefs.mutedProperties.includes(id)
      ? prefs.mutedProperties.filter(p => p !== id)
      : [...prefs.mutedProperties, id];
    updatePref("mutedProperties", muted);
    Haptics.selectionAsync();
  }

  function handleBudgetBlur() {
    if (budgetDebounceRef.current) clearTimeout(budgetDebounceRef.current);
    budgetDebounceRef.current = setTimeout(async () => {
      if (!user || !budgetAmount) return;
      const amount = parseFloat(budgetAmount);
      if (isNaN(amount) || amount < 1 || amount > 9999) return;
      const { error } = await (supabase.from("user_notification_preferences") as any).upsert(
        { user_id: user.id, budget_threshold: amount, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
      if (!error) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setBudgetSaved(true);
        queryClient.invalidateQueries({ queryKey: ["budget_threshold"] });
        setTimeout(() => setBudgetSaved(false), 500);
      }
    }, 500);
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Icon name="close" size={22} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Tooltip
          id={TOOLTIP_IDS.NOTIF_SETTINGS_TIP}
          message="Choose how far in advance you want maintenance reminders. Quiet hours delay maintenance reminders; medication reminders stay at the time you set."
          icon="notifications-outline"
        />

        <Section title="Push Notifications">
          <ToggleRow
            label="Enable Push Notifications"
            sublabel="Receive reminders for upcoming maintenance"
            value={prefs.pushEnabled}
            onToggle={togglePush}
            color={Colors.accent}
          />
        </Section>

        <Section title="Advance Warning">
          <Text style={styles.sectionHint}>Notify me this many days before a task is due</Text>
          <View style={styles.advanceRow}>
            {[7, 14, 30].map(days => (
              <Pressable
                key={days}
                style={[styles.advanceOption, prefs.advanceDays === days && styles.advanceOptionActive]}
                onPress={() => { updatePref("advanceDays", days); Haptics.selectionAsync(); }}
              >
                <Text style={[styles.advanceOptionText, prefs.advanceDays === days && styles.advanceOptionTextActive]}>
                  {days} days
                </Text>
              </Pressable>
            ))}
          </View>
        </Section>

        <Section title="Quiet Hours">
          <Text style={styles.sectionHint}>Maintenance reminders wait until quiet hours end. Medication reminders stay at the time you set.</Text>
          <View style={styles.quietRow}>
            <View style={styles.quietField}>
              <Text style={styles.quietLabel}>Start</Text>
              <TextInput
                style={styles.quietInput}
                value={prefs.quietHoursStart}
                onChangeText={v => updatePref("quietHoursStart", v)}
                placeholder="22:00"
                placeholderTextColor={Colors.textTertiary}
                keyboardType="numbers-and-punctuation"
              />
            </View>
            <Icon name="arrow-forward" size={16} color={Colors.textTertiary} style={{ marginTop: 24 }} />
            <View style={styles.quietField}>
              <Text style={styles.quietLabel}>End</Text>
              <TextInput
                style={styles.quietInput}
                value={prefs.quietHoursEnd}
                onChangeText={v => updatePref("quietHoursEnd", v)}
                placeholder="08:00"
                placeholderTextColor={Colors.textTertiary}
                keyboardType="numbers-and-punctuation"
              />
            </View>
          </View>
          <Text style={styles.quietHint}>Use 24-hour format (e.g., 22:00 for 10 PM)</Text>
        </Section>

        <Section title="Budget Alerts">
          <Text style={styles.sectionHint}>
            Get notified when upcoming maintenance costs exceed your threshold
          </Text>
          <View style={styles.budgetRow}>
            <View style={styles.budgetInputWrapper}>
              <Text style={styles.budgetCurrency}>$</Text>
              <TextInput
                style={styles.budgetInput}
                value={budgetAmount}
                onChangeText={(v) => setBudgetAmount(v.replace(/[^0-9]/g, "").slice(0, 4))}
                onBlur={handleBudgetBlur}
                placeholder="500"
                placeholderTextColor={Colors.textTertiary}
                keyboardType="number-pad"
                maxLength={4}
              />
            </View>
            {budgetSaved ? (
              <Icon name="checkmark-circle" size={24} color={Colors.good} style={{ marginRight: 8 }} />
            ) : (
              <View style={{ width: 30 }} />
            )}
          </View>
          <Text style={styles.budgetHint}>1–$9,999 · Saved automatically when you leave the field</Text>
        </Section>

        {vehicles && vehicles.length > 0 && (
          <Section title="Mute Vehicles">
            <Text style={styles.sectionHint}>Muted vehicles won&apos;t send any reminders</Text>
            {vehicles.map(v => (
              <ToggleRow
                key={v.id}
                label={v.nickname ?? `${v.year} ${v.make} ${v.model}`}
                sublabel={v.nickname ? `${v.year} ${v.make} ${v.model}` : undefined}
                value={prefs.mutedVehicles.includes(v.id)}
                onToggle={() => toggleMutedVehicle(v.id)}
                color={Colors.vehicle}
                inverted
              />
            ))}
          </Section>
        )}

        {properties && properties.length > 0 && (
          <Section title="Mute Properties">
            <Text style={styles.sectionHint}>Muted properties won&apos;t send any reminders</Text>
            {properties.map(p => (
              <ToggleRow
                key={p.id}
                label={p.nickname ?? p.address ?? "Property"}
                sublabel={p.nickname ? p.address ?? undefined : undefined}
                value={prefs.mutedProperties.includes(p.id)}
                onToggle={() => toggleMutedProperty(p.id)}
                color={Colors.home}
                inverted
              />
            ))}
          </Section>
        )}
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionContent}>{children}</View>
    </View>
  );
}

function ToggleRow({ label, sublabel, value, onToggle, color, inverted }: {
  label: string;
  sublabel?: string;
  value: boolean;
  onToggle: () => void;
  color: string;
  inverted?: boolean;
}) {
  const isOn = inverted ? !value : value;
  return (
    <Pressable style={styles.toggleRow} onPress={onToggle}>
      <View style={styles.toggleInfo}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {sublabel && <Text style={styles.toggleSub}>{sublabel}</Text>}
      </View>
      <View style={[styles.toggle, isOn && [styles.toggleOn, { backgroundColor: color }]]}>
        <View style={[styles.toggleThumb, isOn && styles.toggleThumbOn]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  closeBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...Typography.title2, color: Colors.text },
  scroll: { paddingHorizontal: 20, paddingTop: 20, gap: 24 },
  section: { gap: 12 },
  sectionTitle: { ...Typography.caption, fontWeight: "600", color: Colors.textTertiary, textTransform: "uppercase", letterSpacing: 1.5 },
  sectionContent: { backgroundColor: Colors.card, borderRadius: Radius.lg, overflow: "hidden", borderWidth: 1, borderColor: Colors.border, gap: 0 },
  sectionHint: { ...Typography.caption, color: Colors.textTertiary, paddingHorizontal: 2 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  toggleInfo: { flex: 1 },
  toggleLabel: { ...Typography.subheadline, fontWeight: "500", color: Colors.text },
  toggleSub: { ...Typography.caption, color: Colors.textSecondary },
  toggle: { width: 48, height: 28, borderRadius: Radius.lg, backgroundColor: Colors.border, justifyContent: "center", paddingHorizontal: 2 },
  toggleOn: {},
  toggleThumb: { width: 24, height: 24, borderRadius: Radius.pill, backgroundColor: Colors.text, alignSelf: "flex-start" },
  toggleThumbOn: { alignSelf: "flex-end" },
  advanceRow: { flexDirection: "row", gap: 8, padding: 12 },
  advanceOption: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: Radius.md, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  advanceOptionActive: { backgroundColor: Colors.accentLight, borderColor: Colors.accent },
  advanceOptionText: { ...Typography.footnote, fontWeight: "500", color: Colors.textSecondary },
  advanceOptionTextActive: { fontWeight: "600", color: Colors.accent },
  quietRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12 },
  quietField: { flex: 1, gap: 4 },
  quietLabel: { ...Typography.caption, fontWeight: "500", color: Colors.textSecondary },
  quietInput: {
    ...Typography.subheadline,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: Colors.text,
    textAlign: "center",
  },
  quietHint: { ...Typography.caption, color: Colors.textTertiary, paddingHorizontal: 16, paddingBottom: 12 },
  budgetRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },
  budgetInputWrapper: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
  },
  budgetCurrency: { ...Typography.subheadline, fontWeight: "500", color: Colors.textSecondary },
  budgetInput: { ...Typography.subheadline, flex: 1, paddingVertical: 12, color: Colors.text, paddingLeft: 4 },
  budgetHint: { ...Typography.caption, color: Colors.textTertiary, paddingHorizontal: 16, paddingBottom: 12 },
});
