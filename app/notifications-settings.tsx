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
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const STORAGE_KEY = "notification_prefs";
const DEFAULT_PREFS = {
  pushEnabled: false,
  advanceDays: 14,
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
  mutedVehicles: [] as string[],
  mutedProperties: [] as string[],
};

type NotifPrefs = typeof DEFAULT_PREFS;

async function loadPrefs(): Promise<NotifPrefs> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

async function savePrefs(prefs: NotifPrefs) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

export default function NotificationsSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_PREFS);
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
    loadPrefs().then(p => { setPrefs(p); setIsLoading(false); });
  }, []);

  useEffect(() => {
    if (budgetPref?.budget_threshold != null) {
      setBudgetAmount(String(budgetPref.budget_threshold));
    }
  }, [budgetPref]);

  async function updatePref<K extends keyof NotifPrefs>(key: K, value: NotifPrefs[K]) {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    await savePrefs(next);
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
      await updatePref("pushEnabled", true);
    } else {
      await updatePref("pushEnabled", false);
    }
  }

  function toggleMutedVehicle(id: string) {
    Haptics.selectionAsync();
    const muted = prefs.mutedVehicles.includes(id)
      ? prefs.mutedVehicles.filter(v => v !== id)
      : [...prefs.mutedVehicles, id];
    updatePref("mutedVehicles", muted);
  }

  function toggleMutedProperty(id: string) {
    Haptics.selectionAsync();
    const muted = prefs.mutedProperties.includes(id)
      ? prefs.mutedProperties.filter(p => p !== id)
      : [...prefs.mutedProperties, id];
    updatePref("mutedProperties", muted);
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
          <Ionicons name="close" size={22} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
      >
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
                onPress={() => { Haptics.selectionAsync(); updatePref("advanceDays", days); }}
              >
                <Text style={[styles.advanceOptionText, prefs.advanceDays === days && styles.advanceOptionTextActive]}>
                  {days} days
                </Text>
              </Pressable>
            ))}
          </View>
        </Section>

        <Section title="Quiet Hours">
          <Text style={styles.sectionHint}>No notifications will be sent during this period</Text>
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
            <Ionicons name="arrow-forward" size={16} color={Colors.textTertiary} style={{ marginTop: 22 }} />
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
              <Ionicons name="checkmark-circle" size={24} color={Colors.good} style={{ marginRight: 6 }} />
            ) : (
              <View style={{ width: 30 }} />
            )}
          </View>
          <Text style={styles.budgetHint}>1–$9,999 · Saved automatically when you leave the field</Text>
        </Section>

        {vehicles && vehicles.length > 0 && (
          <Section title="Mute Vehicles">
            <Text style={styles.sectionHint}>Muted vehicles won't send any reminders</Text>
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
            <Text style={styles.sectionHint}>Muted properties won't send any reminders</Text>
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
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  closeBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  scroll: { paddingHorizontal: 16, paddingTop: 20, gap: 24 },
  section: { gap: 10 },
  sectionTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.textTertiary, textTransform: "uppercase", letterSpacing: 0.8 },
  sectionContent: { backgroundColor: Colors.card, borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: Colors.border, gap: 0 },
  sectionHint: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary, paddingHorizontal: 2 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  toggleInfo: { flex: 1 },
  toggleLabel: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.text },
  toggleSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  toggle: { width: 48, height: 28, borderRadius: 14, backgroundColor: Colors.border, justifyContent: "center", paddingHorizontal: 2 },
  toggleOn: {},
  toggleThumb: { width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.text, alignSelf: "flex-start" },
  toggleThumbOn: { alignSelf: "flex-end" },
  advanceRow: { flexDirection: "row", gap: 8, padding: 12 },
  advanceOption: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  advanceOptionActive: { backgroundColor: Colors.accentLight, borderColor: Colors.accent },
  advanceOptionText: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  advanceOptionTextActive: { color: Colors.accent, fontFamily: "Inter_600SemiBold" },
  quietRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12 },
  quietField: { flex: 1, gap: 4 },
  quietLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  quietInput: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
    textAlign: "center",
  },
  quietHint: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textTertiary, paddingHorizontal: 14, paddingBottom: 10 },
  budgetRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  budgetInputWrapper: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
  },
  budgetCurrency: { fontSize: 16, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  budgetInput: { flex: 1, paddingVertical: 10, fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.text, paddingLeft: 4 },
  budgetHint: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textTertiary, paddingHorizontal: 14, paddingBottom: 10 },
});
