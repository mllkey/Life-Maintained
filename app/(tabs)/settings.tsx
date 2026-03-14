import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  Alert,
  Platform,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { parseISO, differenceInDays, format, addDays } from "date-fns";
import {
  hasPersonalOrAbove,
  hasProOrAbove,
  hasBusiness,
} from "@/lib/subscription";

const SETTINGS_KEY = "app_settings_v2";

type AppSettings = {
  pushEnabled: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
  budgetThreshold: string;
};

const DEFAULT_SETTINGS: AppSettings = {
  pushEnabled: false,
  emailEnabled: true,
  smsEnabled: false,
  budgetThreshold: "",
};

type PredVehicle = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  nickname: string | null;
  mileage: number | null;
  average_miles_per_month: number | null;
};

type PredTask = {
  id: string;
  name: string;
  interval_months: number | null;
  interval_miles: number | null;
  next_due_date: string | null;
  last_completed_miles: number | null;
  priority: string | null;
};

function getDaysUntil(t: PredTask, v: PredVehicle | null): number | null {
  if (t.next_due_date) {
    return differenceInDays(parseISO(t.next_due_date), new Date());
  }
  if (t.interval_miles != null && v?.mileage != null && v.average_miles_per_month) {
    const milesLeft = t.interval_miles - (v.mileage - (t.last_completed_miles ?? 0));
    return Math.round(milesLeft / (v.average_miles_per_month / 30.44));
  }
  return null;
}

function formatDaysUntil(days: number | null, nextDueDate: string | null): string {
  if (days === null) return "-";
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Today";
  if (nextDueDate) return format(parseISO(nextDueDate), "MMM d");
  return format(addDays(new Date(), days), "MMM d");
}

function formatInterval(t: PredTask): string {
  if (t.interval_miles != null) {
    return t.interval_miles >= 1000
      ? `${t.interval_miles / 1000}k mi`
      : `${t.interval_miles} mi`;
  }
  if (t.interval_months != null) return `${t.interval_months}mo`;
  return "-";
}

function rowColor(days: number | null): string {
  if (days === null) return Colors.textTertiary;
  if (days < 0) return Colors.overdue;
  if (days < 30) return Colors.dueSoon;
  return Colors.good;
}

async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

async function persistSettings(s: AppSettings) {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const queryClient = useQueryClient();
  const webTopPad = Platform.OS === "web" ? 67 : 0;

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const savedRef = useRef<AppSettings>(DEFAULT_SETTINGS);
  const isDeletingAccountRef = useRef(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase.from("profiles").select("*").eq("user_id", user.id).single();
      return data;
    },
    enabled: !!user,
  });

  const { data: budgetTier } = useQuery({
    queryKey: ["budget_tier", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from("budget_notification_tiers")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [actionButtonExpanded, setActionButtonExpanded] = useState(false);

  const { data: predVehicles } = useQuery({
    queryKey: ["settings_pred_vehicles", user?.id],
    queryFn: async () => {
      if (!user) return [] as PredVehicle[];
      const { data } = await supabase
        .from("vehicles")
        .select("id, year, make, model, nickname, mileage, average_miles_per_month")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });
      return (data ?? []) as PredVehicle[];
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (predVehicles && predVehicles.length > 0 && !selectedVehicleId) {
      setSelectedVehicleId(predVehicles[0].id);
    }
  }, [predVehicles, selectedVehicleId]);

  const selectedVehicle = predVehicles?.find(pv => pv.id === selectedVehicleId) ?? null;

  const { data: predTasks, isLoading: predTasksLoading } = useQuery({
    queryKey: ["settings_pred_tasks", selectedVehicleId],
    queryFn: async () => {
      if (!selectedVehicleId) return [] as PredTask[];
      const { data } = await supabase
        .from("user_vehicle_maintenance_tasks")
        .select("id, name, interval_months, interval_miles, next_due_date, last_completed_miles, priority")
        .eq("vehicle_id", selectedVehicleId)
        .order("next_due_date", { ascending: true, nullsFirst: false });
      return (data ?? []) as PredTask[];
    },
    enabled: !!selectedVehicleId,
  });

  useEffect(() => {
    loadSettings().then(s => {
      setSettings(s);
      savedRef.current = s;
      setIsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (budgetTier?.threshold_amount != null && isLoaded) {
      const threshold = String(budgetTier.threshold_amount);
      setSettings(prev => {
        const next = { ...prev, budgetThreshold: threshold };
        savedRef.current = { ...savedRef.current, budgetThreshold: threshold };
        return next;
      });
    }
  }, [budgetTier, isLoaded]);

  const hasChanges = isLoaded && JSON.stringify(settings) !== JSON.stringify(savedRef.current);

  function updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  async function togglePush(next: boolean) {
    if (next) {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission Required", "Please enable notifications in your device settings.");
        return;
      }
    }
    updateSetting("pushEnabled", next);
    Haptics.selectionAsync();
  }

  async function handleSave() {
    if (!user || !hasChanges) return;
    setIsSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await persistSettings(settings);

      const threshold = parseFloat(settings.budgetThreshold);
      if (!isNaN(threshold) && threshold > 0) {
        const payload = {
          user_id: user.id,
          threshold_amount: threshold,
          updated_at: new Date().toISOString(),
        };
        if (budgetTier) {
          await supabase.from("budget_notification_tiers").update(payload).eq("user_id", user.id);
        } else {
          await supabase.from("budget_notification_tiers").insert({ ...payload, created_at: new Date().toISOString() });
        }
        queryClient.invalidateQueries({ queryKey: ["budget_tier"] });
      }

      savedRef.current = { ...settings };
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert("Error saving settings", e.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSignOut() {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          await signOut();
          router.replace("/(auth)");
        },
      },
    ]);
  }

  function handleDeleteAccount() {
    if (isDeletingAccountRef.current) return;
    Alert.alert(
      "Delete Account",
      "This will permanently delete your account and all data. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Forever",
          style: "destructive",
          onPress: () => {
            Alert.alert("Are you absolutely sure?", "All vehicles, properties, health records, and history will be deleted.", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Yes, Delete My Account",
                style: "destructive",
                onPress: async () => {
                  if (isDeletingAccountRef.current) return;
                  isDeletingAccountRef.current = true;
                  try {
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                    if (!user) return;
                    await supabase.rpc("delete_user_account", { user_id: user.id }).maybeSingle();
                    await supabase.auth.signOut();
                    queryClient.clear();
                    router.replace("/(auth)");
                  } catch (err: any) {
                    isDeletingAccountRef.current = false;
                    Alert.alert("Delete Failed", err?.message ?? "Something went wrong. Please try again.");
                  }
                },
              },
            ]);
          },
        },
      ]
    );
  }

  const userIsInTrial =
    profile?.subscription_tier === "trial" ||
    (!!profile?.trial_expires_at && new Date(profile.trial_expires_at) > new Date());
  const trialDaysLeft = profile?.trial_expires_at
    ? Math.max(0, Math.ceil((new Date(profile.trial_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;
  const isPremium = hasPersonalOrAbove(profile);
  const userIsFreeTier = !userIsInTrial && !isPremium;
  const tierLabel = userIsInTrial ? "Trial" : hasBusiness(profile) ? "Business" : hasProOrAbove(profile) ? "Pro" : hasPersonalOrAbove(profile) ? "Personal" : "Free";
  const tierExpiry = profile?.subscription_expires_at
    ? format(parseISO(profile.subscription_expires_at), "MMMM d, yyyy")
    : null;

  if (!isLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + webTopPad + 16 }]}>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 120 + (Platform.OS === "web" ? 34 : 0) },
        ]}
      >
        <View style={styles.maxWidth}>
          {/* Banners */}
          {userIsInTrial && (
            <View style={styles.banner}>
              <View style={styles.bannerText}>
                <Text style={styles.bannerTitle}>Free Trial</Text>
                <Text style={styles.bannerSub}>{trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""} remaining</Text>
              </View>
              <Pressable
                style={({ pressed }) => [styles.bannerBtn, { opacity: pressed ? 0.8 : 1 }]}
                onPress={() => router.push("/subscription" as any)}
              >
                <Text style={styles.bannerBtnText}>Upgrade</Text>
              </Pressable>
            </View>
          )}

          {userIsFreeTier && !userIsInTrial && (
            <View style={styles.banner}>
              <View style={styles.bannerText}>
                <Text style={styles.bannerTitle}>Free Plan</Text>
                <Text style={styles.bannerSub}>Upgrade to unlock vehicles, scans & exports</Text>
              </View>
              <Pressable
                style={({ pressed }) => [styles.bannerBtn, { opacity: pressed ? 0.8 : 1 }]}
                onPress={() => router.push("/subscription" as any)}
              >
                <Text style={styles.bannerBtnText}>Upgrade</Text>
              </Pressable>
            </View>
          )}

          {isPremium && !userIsInTrial && (
            <View style={styles.banner}>
              <View style={styles.bannerText}>
                <Text style={styles.bannerTitle}>{tierLabel} Plan</Text>
                {tierExpiry
                  ? <Text style={styles.bannerSub}>Renews {tierExpiry}</Text>
                  : <Text style={styles.bannerSub}>Active subscription</Text>}
              </View>
              <Pressable
                style={({ pressed }) => [styles.bannerBtn, { opacity: pressed ? 0.8 : 1 }]}
                onPress={() => {
                  if (Platform.OS === "ios") {
                    const { Linking } = require("react-native");
                    Linking.openURL("itms-apps://apps.apple.com/account/subscriptions");
                  } else {
                    router.push("/subscription" as any);
                  }
                }}
              >
                <Text style={styles.bannerBtnText}>Manage</Text>
              </Pressable>
            </View>
          )}

          {/* ACCOUNT */}
          <Text style={styles.sectionLabel}>Account</Text>
          <View style={styles.groupCard}>
            <View style={styles.accountEmailRow}>
              <Text style={styles.accountEmail} numberOfLines={1}>{user?.email}</Text>
              <Text style={styles.accountTierLabel}>{tierLabel}</Text>
            </View>
            <View style={styles.groupDivider} />
            <Pressable
              style={({ pressed }) => [styles.signOutRow, { opacity: pressed ? 0.7 : 1 }]}
              onPress={handleSignOut}
              hitSlop={4}
            >
              <Text style={styles.signOutText}>Sign Out</Text>
            </Pressable>
          </View>

          {/* NOTIFICATIONS */}
          <Text style={styles.sectionLabel}>Notifications</Text>
          <View style={styles.groupCard}>
            <ToggleRow
              label="Push Notifications"
              sublabel="In-app alerts and banners"
              value={settings.pushEnabled}
              onToggle={() => togglePush(!settings.pushEnabled)}
            />
            <View style={styles.groupDivider} />
            <ToggleRow
              label="Email"
              sublabel="Sent to your registered email"
              value={settings.emailEnabled}
              onToggle={() => { Haptics.selectionAsync(); updateSetting("emailEnabled", !settings.emailEnabled); }}
            />
            <View style={styles.groupDivider} />
            <ToggleRow
              label="SMS"
              sublabel="Text message reminders"
              value={settings.smsEnabled}
              onToggle={() => { Haptics.selectionAsync(); updateSetting("smsEnabled", !settings.smsEnabled); }}
            />
          </View>

          {/* BUDGET */}
          <Text style={styles.sectionLabel}>Budget Notifications</Text>
          <SectionCard
            title="Budget Notifications"
            subtitle="Get alerted when costs exceed your threshold"
          >
            <View style={styles.budgetContent}>
              <Text style={styles.budgetHint}>
                We'll notify you when upcoming maintenance costs in a given month exceed this amount.
              </Text>
              <View style={styles.budgetInputRow}>
                <View style={styles.budgetInputWrap}>
                  <Text style={styles.budgetCurrency}>$</Text>
                  <TextInput
                    style={styles.budgetInput}
                    value={settings.budgetThreshold}
                    onChangeText={v => updateSetting("budgetThreshold", v)}
                    placeholder="500"
                    placeholderTextColor={Colors.textTertiary}
                    keyboardType="decimal-pad"
                    returnKeyType="done"
                  />
                </View>
                <Text style={styles.budgetLabel}>monthly threshold</Text>
              </View>
              {budgetTier?.threshold_amount != null && (
                <Text style={styles.budgetSaved}>
                  Current: ${Number(budgetTier.threshold_amount).toLocaleString()}/mo
                </Text>
              )}
            </View>
          </SectionCard>

          <Text style={styles.sectionLabel}>Service Prediction</Text>
          <SectionCard
            title="Service Prediction"
            subtitle={selectedVehicle
              ? (selectedVehicle.nickname ?? `${selectedVehicle.year ?? ""} ${selectedVehicle.make ?? ""} ${selectedVehicle.model ?? ""}`.trim())
              : "Predict upcoming services by vehicle"}
          >
            {(predVehicles?.length ?? 0) === 0 ? (
              <View style={styles.predEmpty}>
                <Ionicons name="car-outline" size={28} color={Colors.textTertiary} />
                <Text style={styles.predEmptyText}>Add a vehicle to see service predictions.</Text>
              </View>
            ) : (
              <>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipScroll}
                  style={styles.chipScrollWrap}
                >
                  {(predVehicles ?? []).map(pv => {
                    const chipLabel = pv.nickname ?? `${pv.year ?? ""} ${pv.make ?? ""} ${pv.model ?? ""}`.trim();
                    const isSelected = pv.id === selectedVehicleId;
                    return (
                      <Pressable
                        key={pv.id}
                        style={({ pressed }) => [
                          styles.vehicleChip,
                          isSelected && styles.vehicleChipSelected,
                          { opacity: pressed ? 0.8 : 1 },
                        ]}
                        onPress={() => { Haptics.selectionAsync(); setSelectedVehicleId(pv.id); }}
                      >
                        <Ionicons
                          name="car-outline"
                          size={13}
                          color={isSelected ? Colors.vehicle : Colors.textTertiary}
                        />
                        <Text style={[styles.vehicleChipText, isSelected && styles.vehicleChipTextSelected]}>
                          {chipLabel}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                {selectedVehicle?.average_miles_per_month && (
                  <View style={styles.vehicleMeta}>
                    <Ionicons name="speedometer-outline" size={13} color={Colors.textTertiary} />
                    <Text style={styles.vehicleMetaText}>
                      {selectedVehicle.mileage != null ? `${selectedVehicle.mileage.toLocaleString()} mi current · ` : ""}
                      {selectedVehicle.average_miles_per_month.toLocaleString()} mi/mo avg
                    </Text>
                  </View>
                )}

                {predTasksLoading ? (
                  <ActivityIndicator color={Colors.accent} style={{ paddingVertical: 20 }} />
                ) : !predTasks || predTasks.length === 0 ? (
                  <View style={styles.predEmpty}>
                    <Ionicons name="construct-outline" size={26} color={Colors.textTertiary} />
                    <Text style={styles.predEmptyText}>No maintenance tasks found for this vehicle.</Text>
                  </View>
                ) : (
                  <>
                    <View style={styles.tableHeader}>
                      <Text style={[styles.tableCol, { flex: 2 }]}>Service</Text>
                      <Text style={[styles.tableCol, styles.tableColRight]}>Interval</Text>
                      <Text style={[styles.tableCol, styles.tableColRight]}>Next Due</Text>
                      <Text style={[styles.tableCol, styles.tableColRight]}>Est. Cost</Text>
                    </View>

                    {predTasks.map((pt, idx) => {
                      const daysLeft = getDaysUntil(pt, selectedVehicle);
                      const color = rowColor(daysLeft);
                      const dateLabel = formatDaysUntil(daysLeft, pt.next_due_date);
                      const intervalLabel = formatInterval(pt);
                      return (
                        <View key={pt.id} style={[styles.tableRow, idx % 2 === 1 && styles.tableRowAlt]}>
                          <View style={{ flex: 2, flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <View style={[styles.tableDot, { backgroundColor: color }]} />
                            <Text style={styles.tableCellMain} numberOfLines={1}>{pt.name}</Text>
                          </View>
                          <Text style={[styles.tableCell, styles.tableCellRight]}>{intervalLabel}</Text>
                          <Text style={[styles.tableCell, styles.tableCellRight, { color }]}>{dateLabel}</Text>
                        </View>
                      );
                    })}

                    <View style={styles.tableNote}>
                      <Ionicons name="information-circle-outline" size={13} color={Colors.textTertiary} />
                      <Text style={styles.tableNoteText}>
                        Dates are calculated from your vehicle's current mileage and average monthly driving distance.
                      </Text>
                    </View>
                  </>
                )}
              </>
            )}
          </SectionCard>

          {/* Action Button shortcut tip card */}
          <Pressable
            style={({ pressed }) => [styles.actionBtnCard, { opacity: pressed ? 0.95 : 1 }]}
            onPress={() => { Haptics.selectionAsync(); setActionButtonExpanded(v => !v); }}
          >
            <View style={styles.actionBtnRow}>
              <View style={styles.actionBtnIconWrap}>
                <Ionicons name="flash-outline" size={18} color={Colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.actionBtnTitle}>Quick Log with Action Button</Text>
                <Text style={styles.actionBtnSub}>iPhone 15 Pro or newer? Instantly open voice logging.</Text>
              </View>
              <Ionicons
                name={actionButtonExpanded ? "chevron-up" : "chevron-down"}
                size={16}
                color={Colors.textTertiary}
              />
            </View>

            {actionButtonExpanded && (
              <View style={styles.actionBtnSteps}>
                <Text style={styles.actionBtnStepHeader}>How to set up your Action Button:</Text>
                {[
                  "Open the Settings app on your iPhone",
                  'Tap "Action Button"',
                  'Swipe to "Shortcut"',
                  'Tap "Choose a Shortcut"',
                  "Tap + to create a new shortcut",
                  'Add action "Open URLs"',
                  "Enter: lifemaintained://voice-log",
                  "Save the shortcut and select it",
                ].map((step, i) => (
                  <View key={i} style={styles.actionBtnStep}>
                    <View style={styles.actionBtnStepNum}>
                      <Text style={styles.actionBtnStepNumText}>{i + 1}</Text>
                    </View>
                    <Text style={styles.actionBtnStepText}>{step}</Text>
                  </View>
                ))}
                <View style={styles.actionBtnUrlBox}>
                  <Ionicons name="link-outline" size={13} color={Colors.accent} />
                  <Text style={styles.actionBtnUrl}>lifemaintained://voice-log</Text>
                </View>
              </View>
            )}
          </Pressable>

          <View style={styles.legalRow}>
            <Pressable
              style={({ pressed }) => [styles.legalBtn, { opacity: pressed ? 0.7 : 1 }]}
              onPress={() => router.push("/terms-of-service" as any)}
            >
              <Text style={styles.legalBtnText}>Terms of Service</Text>
            </Pressable>
            <Text style={styles.legalDot}>·</Text>
            <Pressable
              style={({ pressed }) => [styles.legalBtn, { opacity: pressed ? 0.7 : 1 }]}
              onPress={() => router.push("/privacy-policy" as any)}
            >
              <Text style={styles.legalBtnText}>Privacy Policy</Text>
            </Pressable>
          </View>

          <Text style={styles.version}>LifeMaintained v1.0.0</Text>

          <View style={{ height: 32 }} />
          <Pressable
            style={({ pressed }) => [styles.deleteAccountBtn, { opacity: pressed ? 0.7 : 1 }]}
            onPress={handleDeleteAccount}
            hitSlop={8}
          >
            <Text style={styles.deleteAccountText}>Delete Account</Text>
          </Pressable>
        </View>
      </ScrollView>

      {hasChanges && (
        <View style={[styles.saveBar, { paddingBottom: insets.bottom + 8 + (Platform.OS === "web" ? 34 : 0) }]}>
          <View style={styles.saveBarInner}>
            <Text style={styles.saveBarHint}>You have unsaved changes</Text>
            <Pressable
              style={({ pressed }) => [styles.saveBtn, { opacity: pressed ? 0.9 : 1 }]}
              onPress={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color={Colors.textInverse} />
              ) : (
                <>
                  <Ionicons name="checkmark" size={16} color={Colors.textInverse} />
                  <Text style={styles.saveBtnText}>Save Changes</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

function SectionCard({ title, subtitle, children }: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionCardBody}>{children}</View>
    </View>
  );
}

function ToggleRow({ label, sublabel, value, onToggle }: {
  label: string;
  sublabel: string;
  value: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable style={styles.toggleRow} onPress={onToggle} hitSlop={4}>
      <View style={styles.toggleRowInfo}>
        <Text style={styles.toggleRowLabel}>{label}</Text>
        <Text style={styles.toggleRowSub}>{sublabel}</Text>
      </View>
      <Pressable onPress={onToggle} style={styles.toggleHitArea} hitSlop={8}>
        <View style={[styles.toggle, value && styles.toggleOn]}>
          <View style={[styles.toggleThumb, value && styles.toggleThumbOn]} />
        </View>
      </Pressable>
    </Pressable>
  );
}


const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: Colors.background,
  },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", color: Colors.text, letterSpacing: -0.5 },
  content: { paddingHorizontal: 20, paddingTop: 8, gap: 16 },
  maxWidth: {
    maxWidth: 768,
    alignSelf: "center",
    width: "100%",
    gap: 16,
  },

  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginBottom: -4,
  },

  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  bannerText: { flex: 1 },
  bannerTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.text },
  bannerSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, marginTop: 2 },
  bannerBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  bannerBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },

  groupCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  groupDivider: { height: 1, backgroundColor: Colors.borderSubtle },

  accountEmailRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  accountEmail: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.text },
  accountTierLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.accent },

  signOutRow: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 48,
    justifyContent: "center",
  },
  signOutText: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.textSecondary },

  sectionCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  sectionCardBody: { padding: 16, gap: 0 },

  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 56,
  },
  toggleRowInfo: { flex: 1 },
  toggleRowLabel: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.text },
  toggleRowSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, marginTop: 2 },
  toggleHitArea: { padding: 5 },
  toggle: {
    width: 50,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.border,
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  toggleOn: { backgroundColor: Colors.accent },
  toggleThumb: { width: 26, height: 26, borderRadius: 13, backgroundColor: Colors.text, alignSelf: "flex-start" },
  toggleThumbOn: { alignSelf: "flex-end" },

  deleteAccountBtn: { alignItems: "center", paddingVertical: 12, minHeight: 44, justifyContent: "center" },
  deleteAccountText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.overdue },

  rowDivider: { height: 1, backgroundColor: Colors.border, marginHorizontal: -16, marginVertical: 0 },

  budgetContent: { gap: 10 },
  budgetHint: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, lineHeight: 19 },
  budgetInputRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  budgetInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    flex: 1,
    maxWidth: 160,
    height: 46,
  },
  budgetCurrency: { fontSize: 18, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  budgetInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 18,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
    paddingLeft: 4,
    minHeight: 44,
  },
  budgetLabel: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  budgetSaved: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.good },

  chipScrollWrap: { marginHorizontal: -16, marginBottom: 12 },
  chipScroll: { paddingHorizontal: 16, gap: 8 },
  vehicleChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    minHeight: 36,
  },
  vehicleChipSelected: {
    backgroundColor: Colors.vehicleMuted,
    borderColor: Colors.vehicle + "66",
  },
  vehicleChipText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textTertiary },
  vehicleChipTextSelected: { color: Colors.vehicle, fontFamily: "Inter_600SemiBold" },
  vehicleMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  vehicleMetaText: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  predEmpty: {
    alignItems: "center",
    paddingVertical: 28,
    gap: 10,
  },
  predEmptyText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 18,
  },

  tableHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    marginHorizontal: -16,
    paddingHorizontal: 16,
    backgroundColor: Colors.surface,
  },
  tableCol: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: Colors.textTertiary, textTransform: "uppercase", letterSpacing: 0.6, flex: 1 },
  tableColRight: { textAlign: "right" },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 11,
    marginHorizontal: -16,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  tableRowAlt: { backgroundColor: Colors.surface + "80" },
  tableDot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
  tableCellMain: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.text, flex: 1 },
  tableCell: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  tableCellRight: { textAlign: "right" },
  tableNote: {
    flexDirection: "row",
    gap: 6,
    marginTop: 12,
    marginHorizontal: -16,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    alignItems: "flex-start",
  },
  tableNoteText: { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textTertiary, lineHeight: 16 },

  legalRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  legalBtn: { paddingVertical: 8, paddingHorizontal: 4, minHeight: 44, justifyContent: "center" },
  legalBtnText: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  legalDot: { fontSize: 13, color: Colors.textTertiary },
  version: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary, textAlign: "center" },

  saveBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.card,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 12,
    paddingHorizontal: 20,
  },
  saveBarInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    maxWidth: 768,
    alignSelf: "center",
    width: "100%",
  },
  saveBarHint: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: Colors.accent,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 11,
    minHeight: 44,
  },
  saveBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },

  actionBtnCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.accent + "33",
    marginBottom: 12,
    overflow: "hidden",
  },
  actionBtnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
  },
  actionBtnIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.accent + "18",
    alignItems: "center",
    justifyContent: "center",
  },
  actionBtnTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
    marginBottom: 2,
  },
  actionBtnSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
  },
  actionBtnSteps: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    padding: 16,
    gap: 10,
  },
  actionBtnStepHeader: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  actionBtnStep: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  actionBtnStepNum: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.accent + "22",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  actionBtnStepNumText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.accent,
  },
  actionBtnStepText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
    lineHeight: 19,
  },
  actionBtnUrlBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.surface,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 4,
  },
  actionBtnUrl: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: Colors.accent,
    letterSpacing: 0.3,
  },
});
