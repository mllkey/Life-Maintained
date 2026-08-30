import React, { useState, useEffect, useRef } from "react";
import { formatCostDisplay } from "@/lib/costFormat";
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
import { Colors } from "@/constants/colors";
import { Icon } from "@/components/ui/Icon";
import { Screen } from "@/components/ui/Screen";
import { Section } from "@/components/ui/Section";
import { Row as UiRow } from "@/components/ui/Row";
import { Typography } from "@/constants/typography";
import { Radius } from "@/constants/radius";
import { Spacing } from "@/constants/spacing";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import { SaveToast } from "@/components/SaveToast";
import DeveloperTestNotifications from "@/components/DeveloperTestNotifications";
import DeveloperTestUndoToast from "@/components/DeveloperTestUndoToast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { scheduleMaintenanceNotifications, upsertPushToken, resolveAuthUserId } from "@/lib/notificationScheduler";
import { loadNotifPrefs, saveNotifPrefs, type NotifPrefs, DEFAULT_NOTIF_PREFS } from "@/lib/notificationPrefs";
import { parseISO, differenceInDays, format, addDays } from "date-fns";
import {
  hasPersonalOrAbove,
  hasProOrAbove,
  hasBusiness,
  getLiveScanQuota,
  scanLimit,
} from "@/lib/subscription";
import ScanPackModal, { type ScanPackModalHandle } from "@/components/ScanPackModal";
import { PaidActionCTA } from "@/components/PaidActionCTA";
import { projectedMileage } from "@/lib/usageHelpers";
import ServicePredictionSheet, {
  type ServicePredictionSheetHandle,
  type ServicePredictionSheetData,
} from "@/components/ServicePredictionSheet";

const SETTINGS_KEY = "app_settings_v2";

type AppSettings = {
  budgetThreshold: string;
};

const DEFAULT_SETTINGS: AppSettings = {
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
  last_mileage_update: string | null;
  vehicle_type: string | null;
};

type PredCost = { shop_low: number | null; shop_high: number | null };

type PredTask = {
  id: string;
  name: string;
  interval_months: number | null;
  interval_miles: number | null;
  next_due_date: string | null;
  next_due_miles: number | null;
  last_completed_miles: number | null;
  priority: string | null;
};

function getDaysUntil(t: PredTask, v: PredVehicle | null): number | null {
  if (t.next_due_date) {
    return differenceInDays(parseISO(t.next_due_date), new Date());
  }
  if (v?.mileage != null && v.average_miles_per_month) {
    const cur = projectedMileage(v) ?? v.mileage;
    let milesLeft: number | null = null;
    if (t.next_due_miles != null) {
      milesLeft = t.next_due_miles - cur;
    } else if (t.interval_miles != null && t.last_completed_miles != null) {
      milesLeft = t.interval_miles - (cur - t.last_completed_miles);
    }
    if (milesLeft != null) return Math.round(milesLeft / (v.average_miles_per_month / 30.44));
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
  const [notifPrefs, setNotifPrefs] = useState<NotifPrefs>(DEFAULT_NOTIF_PREFS);
  const [isPushTogglePending, setIsPushTogglePending] = useState(false);
  const pushTogglePendingRef = useRef(false);
  const isDeletingAccountRef = useRef(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const upgradeTapLockRef = useRef(false);

  const openSubscriptionFromSettings = () => {
    if (upgradeTapLockRef.current) return;
    upgradeTapLockRef.current = true;
    Haptics.selectionAsync();
    router.push("/subscription" as any);
    setTimeout(() => {
      upgradeTapLockRef.current = false;
    }, 500);
  };

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const scanPackModalRef = useRef<ScanPackModalHandle>(null);
  const isPaidNonTrialUser =
    hasPersonalOrAbove(profile) && profile?.subscription_tier !== "trial";
  const { data: scanQuota, isError: scanQuotaError } = useQuery({
    queryKey: ["scan-quota", user?.id, profile?.subscription_tier],
    queryFn: getLiveScanQuota,
    enabled: !!user?.id && isPaidNonTrialUser,
    staleTime: 30_000,
  });
  const scanQuotaLimit = scanQuota?.scans_limit ?? scanLimit(profile);
  const scanMonthlyRemaining = scanQuota
    ? Math.max(0, scanQuota.scans_limit - scanQuota.scans_used)
    : 0;
  const scanCreditBalance = scanQuota?.credit_balance ?? 0;

  const { data: budgetPref } = useQuery({
    queryKey: ["budget_threshold", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await (supabase.from("user_notification_preferences") as any)
        .select("budget_threshold")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [actionButtonExpanded, setActionButtonExpanded] = useState(false);
  const predSheetRef = useRef<ServicePredictionSheetHandle>(null);
  const [predSheetData, setPredSheetData] = useState<ServicePredictionSheetData | null>(null);

  useEffect(() => {
    if (!predSheetData) return;
    predSheetRef.current?.present();
  }, [predSheetData]);

  const { data: predVehicles } = useQuery({
    queryKey: ["settings_pred_vehicles", user?.id],
    queryFn: async () => {
      if (!user) return [] as PredVehicle[];
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, year, make, model, nickname, mileage, average_miles_per_month, last_mileage_update, vehicle_type")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
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
      const { data, error } = await supabase
        .from("user_vehicle_maintenance_tasks")
        .select("id, name, interval_months, interval_miles, next_due_date, next_due_miles, last_completed_miles, priority")
        .eq("vehicle_id", selectedVehicleId)
        .order("next_due_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as PredTask[];
    },
    enabled: !!selectedVehicleId,
  });

  const { data: predCosts } = useQuery({
    queryKey: ["settings_pred_costs", selectedVehicleId, predTasks?.length ?? 0],
    queryFn: async () => {
      const out: Record<string, PredCost> = {};
      if (!selectedVehicle?.make || !predTasks?.length) return out;
      const vehicleKey = `${selectedVehicle.year ?? ""}|${selectedVehicle.make}|${selectedVehicle.model ?? ""}|${selectedVehicle.vehicle_type ?? ""}`.toLowerCase();
      const names = predTasks.map(t => t.name.toLowerCase().trim());
      const { data, error } = await supabase
        .from("repair_cost_cache")
        .select("service_name, shop_low, shop_high")
        .eq("vehicle_key", vehicleKey)
        .in("service_name", names);
      if (error) throw error;
      for (const row of data ?? []) {
        out[row.service_name] = { shop_low: row.shop_low, shop_high: row.shop_high };
      }
      return out;
    },
    enabled: !!selectedVehicle?.make && !!predTasks?.length,
    staleTime: 1000 * 60 * 60,
  });

  useEffect(() => {
    loadSettings().then(s => {
      setSettings(s);
      savedRef.current = s;
      setIsLoaded(true);
    });
  }, []);

  useEffect(() => {
    // Load notification prefs from the canonical shared key.
    // One-time migration: if the canonical key has pushEnabled:false but the
    // legacy app_settings_v2 key had pushEnabled:true, carry it forward so the
    // user doesn't lose their preference after this architecture correction.
    (async () => {
      const prefs = await loadNotifPrefs();
      if (!prefs.pushEnabled) {
        try {
          const raw = await AsyncStorage.getItem(SETTINGS_KEY);
          const legacy = raw ? JSON.parse(raw) : null;
          if (legacy?.pushEnabled === true) {
            const migrated = { ...prefs, pushEnabled: true };
            await saveNotifPrefs(migrated);
            setNotifPrefs(migrated);
            return;
          }
        } catch {
          // migration errors are non-fatal; fall through to set loaded prefs
        }
      }
      setNotifPrefs(prefs);
    })();
  }, []);

  useEffect(() => {
    if (budgetPref?.budget_threshold != null && isLoaded) {
      const threshold = String(budgetPref.budget_threshold);
      setSettings(prev => {
        const next = { ...prev, budgetThreshold: threshold };
        savedRef.current = { ...savedRef.current, budgetThreshold: threshold };
        return next;
      });
    }
  }, [budgetPref, isLoaded]);

  const hasChanges = isLoaded && JSON.stringify(settings) !== JSON.stringify(savedRef.current);

  const [saveErrorToastVisible, setSaveErrorToastVisible] = useState(false);
  const [saveErrorToastTitle, setSaveErrorToastTitle] = useState("");
  const [saveErrorToastSubtitle, setSaveErrorToastSubtitle] = useState<string | undefined>(undefined);

  function fireSaveErrorToast(title: string, subtitle?: string) {
    setSaveErrorToastTitle(title);
    setSaveErrorToastSubtitle(subtitle);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    setSaveErrorToastVisible(true);
    setTimeout(() => setSaveErrorToastVisible(false), 3000);
  }

  function updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  async function togglePush(next: boolean) {
    if (pushTogglePendingRef.current) return;

    const previousPushEnabled = notifPrefs.pushEnabled;

    if (next) {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission Required", "Please enable notifications in your device settings.");
        return;
      }
    }

    pushTogglePendingRef.current = true;
    setIsPushTogglePending(true);
    setNotifPrefs(p => ({ ...p, pushEnabled: next }));
    Haptics.selectionAsync();

    try {
      const resolvedUserId = await resolveAuthUserId();
      if (!resolvedUserId) {
        setNotifPrefs(p => ({ ...p, pushEnabled: previousPushEnabled }));
        return;
      }

      if (next) {
        const tokenResult = await upsertPushToken(resolvedUserId);
        if (!tokenResult.ok) {
          console.warn("[NotifSettings] upsertPushToken failed:", tokenResult.reason);
          setNotifPrefs(p => ({ ...p, pushEnabled: previousPushEnabled }));
          return;
        }
      }

      let prefDbOk = false;
      try {
        const { error } = await (supabase.from("user_notification_preferences") as any)
          .upsert(
            { user_id: resolvedUserId, push_enabled: next, updated_at: new Date().toISOString() },
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
            if (readback?.push_enabled === next) {
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

      if (!prefDbOk) {
        setNotifPrefs(p => ({ ...p, pushEnabled: previousPushEnabled }));
        return;
      }

      try {
        await saveNotifPrefs({ ...notifPrefs, pushEnabled: next });
      } catch (e) {
        console.warn("[NotifSettings] AsyncStorage pushEnabled write failed:", e);
      }

      if (next) {
        scheduleMaintenanceNotifications(resolvedUserId).catch(() => {});
      } else {
        Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
        Notifications.setBadgeCountAsync(0).catch(() => {});
      }
    } finally {
      pushTogglePendingRef.current = false;
      setIsPushTogglePending(false);
    }
  }

  async function handleSave() {
    if (!user || !hasChanges) return;
    setIsSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await persistSettings(settings);

      const threshold = parseFloat(settings.budgetThreshold);
      if (!isNaN(threshold) && threshold > 0) {
        const { error: budgetErr } = await (supabase.from("user_notification_preferences") as any).upsert(
          { user_id: user.id, budget_threshold: threshold, updated_at: new Date().toISOString() },
          { onConflict: "user_id" }
        );
        if (budgetErr) throw budgetErr;
        queryClient.setQueryData(["budget_threshold", user.id], { budget_threshold: threshold });
        queryClient.invalidateQueries({ queryKey: ["budget_threshold"] });
      }

      savedRef.current = { ...settings };
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      fireSaveErrorToast("Could not save settings", "Please check your connection and try again.");
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
                    const { data: { session } } = await supabase.auth.getSession();
                    const { data, error } = await supabase.functions.invoke("delete-account", {
                      headers: { Authorization: `Bearer ${session?.access_token}` },
                    });
                    if (error || !data?.success) {
                      throw new Error(data?.error ?? error?.message ?? "Something went wrong.");
                    }
                    try {
                      const Purchases = (await import("react-native-purchases")).default;
                      await Purchases.logOut();
                    } catch (rcErr) {
                      const rcMessage = rcErr instanceof Error ? rcErr.message : String(rcErr);
                      console.warn("[delete-account] Purchases.logOut failed:", rcMessage);
                    }
                    await AsyncStorage.clear();
                    queryClient.clear();
                    await supabase.auth.signOut();
                    router.replace("/(auth)");
                  } catch (err) {
                    isDeletingAccountRef.current = false;
                    fireSaveErrorToast("Delete Failed", "Something went wrong. Please try again.");
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
  const expiryDate = profile?.subscription_expires_at ? parseISO(profile.subscription_expires_at) : null;
  const isLifetime = expiryDate != null && expiryDate.getFullYear() - new Date().getFullYear() > 50;
  const tierExpiry = expiryDate && !isLifetime ? format(expiryDate, "MMMM d, yyyy") : null;
  const tierExpiryLabel = isLifetime
    ? "Lifetime"
    : tierExpiry
      ? (expiryDate! > new Date() ? `Renews ${tierExpiry}` : `Expires ${tierExpiry}`)
      : "Active subscription";

  // When the user is in trial and a paid tier is on file (e.g. Apple-trial
  // period attached to Personal/Pro/Business), show the tier label so the
  // banner does not just say "Free Trial". Falls back to "Trial" when no
  // paid tier can be inferred from the profile.
  const trialBannerTitle =
    profile?.subscription_tier === "personal" ? "Personal Plan" :
    profile?.subscription_tier === "pro" ? "Pro Plan" :
    profile?.subscription_tier === "business" ? "Business Plan" :
    "Trial";

  if (!isLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <Screen title="Settings" keyboardShouldPersistTaps="handled" contentStyle={styles.content}>
        <View style={styles.maxWidth}>
          {/* Banners */}
          {userIsInTrial && (
            <Pressable
              style={({ pressed }) => [styles.banner, pressed && styles.bannerPressed]}
              onPress={openSubscriptionFromSettings}
              unstable_pressDelay={0}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              pressRetentionOffset={{ top: 24, bottom: 24, left: 24, right: 24 }}
              accessibilityRole="button"
              accessibilityLabel="Upgrade plan"
              accessibilityHint="Opens subscription options"
              testID="settings-trial-upgrade-card"
            >
              <View style={styles.bannerText}>
                <Text style={styles.bannerTitle}>{trialBannerTitle}</Text>
                <Text style={styles.bannerSub}>Free trial: {trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""} remaining</Text>
              </View>
              <View style={styles.bannerBtn} pointerEvents="none">
                <Text style={styles.bannerBtnText}>Upgrade</Text>
              </View>
            </Pressable>
          )}

          {userIsFreeTier && !userIsInTrial && (
            <Pressable
              style={({ pressed }) => [styles.banner, pressed && styles.bannerPressed]}
              onPress={openSubscriptionFromSettings}
              unstable_pressDelay={0}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              pressRetentionOffset={{ top: 24, bottom: 24, left: 24, right: 24 }}
              accessibilityRole="button"
              accessibilityLabel="Upgrade plan"
              accessibilityHint="Opens subscription options"
              testID="settings-free-upgrade-card"
            >
              <View style={styles.bannerText}>
                <Text style={styles.bannerTitle}>Free Plan</Text>
                <Text style={styles.bannerSub}>Upgrade to unlock vehicles, scans & exports</Text>
              </View>
              <View style={styles.bannerBtn} pointerEvents="none">
                <Text style={styles.bannerBtnText}>Upgrade</Text>
              </View>
            </Pressable>
          )}

          {isPremium && !userIsInTrial && (
            <View style={styles.banner}>
              <View style={styles.bannerText}>
                <Text style={styles.bannerTitle}>{tierLabel} Plan</Text>
                <Text style={styles.bannerSub}>{tierExpiryLabel}</Text>
              </View>
            </View>
          )}

          {isPremium && !userIsInTrial && !!profile?.revenuecat_customer_id && (
            <Pressable
              style={({ pressed }) => [styles.manageSubCard, { opacity: pressed ? 0.85 : 1 }]}
              onPress={() => {
                const { Linking } = require("react-native");
                Linking.openURL("itms-apps://apps.apple.com/account/subscriptions");
              }}
              accessibilityRole="button"
              accessibilityLabel="Manage subscription"
              accessibilityHint="Opens iOS subscription settings"
              testID="settings-manage-subscription-card"
            >
              <View style={styles.manageSubText}>
                <Text style={styles.manageSubTitle}>Subscription</Text>
                <Text style={styles.manageSubSub}>Cancel or change plan in iOS Settings</Text>
              </View>
              <View style={styles.manageSubPill} pointerEvents="none">
                <Icon name="open-outline" size={16} color={Colors.accent} />
                <Text style={styles.manageSubPillText}>Manage</Text>
              </View>
            </Pressable>
          )}

          {/* ACCOUNT */}
          <Section title="Account">
            <UiRow
              title={user?.email ?? ""}
              appearIndex={0}
              trailing={<Text style={styles.accountTierLabel}>{tierLabel}</Text>}
            />
            <UiRow
              title="Sign Out"
              destructive
              chevron={false}
              appearIndex={1}
              trailing={null}
              onPress={handleSignOut}
            />
          </Section>

          {isPaidNonTrialUser && (
            <>
              <Section title="Scans">
                <View style={styles.scansRow}>
                  <View style={styles.scansIconWrap}>
                    <Icon name="receipt-outline" size={18} color={Colors.textSecondary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.scansLabel}>Receipt scans</Text>
                    {scanQuota ? (
                      <>
                        <Text style={styles.scansSub}>
                          {scanMonthlyRemaining} of {scanQuotaLimit} remaining this month
                        </Text>
                        {scanCreditBalance > 0 && (
                          <Text style={styles.scansSub}>
                            + {scanCreditBalance} pack {scanCreditBalance === 1 ? "credit" : "credits"} (never expire)
                          </Text>
                        )}
                      </>
                    ) : (
                      <Text style={styles.scansSub}>
                        {scanQuotaError ? "Couldn't load your scans" : "Checking your scans…"}
                      </Text>
                    )}
                  </View>
                </View>
                <View style={styles.scansCtaWrap}>
                  <PaidActionCTA
                    label="Buy more scans"
                    icon="add-circle-outline"
                    variant="secondary"
                    onPress={() => {
                      const opened = scanPackModalRef.current?.present();
                      if (!opened) {
                        fireSaveErrorToast("Couldn't open scan packs", "Please try again.");
                      }
                    }}
                    testID="settings-buy-scans"
                  />
                </View>
              </Section>
            </>
          )}

          <Section title="Your Data" dividerInset={56}>
            <UiRow
              icon="arrow-down-circle-outline"
              iconBackground={Colors.card}
              title="Import vehicles"
              subtitle="Bring in a fleet from a CSV or Excel file"
              accessibilityLabel="Import vehicles from a file"
              onPress={() => router.push("/import-fleet")}
            />
          </Section>

          {/* NOTIFICATIONS */}
          <Section title="Notifications">
            <UiRow
              title="Push Notifications"
              subtitle="In-app alerts and banners"
              disabled={isPushTogglePending}
              onPress={() => togglePush(!notifPrefs.pushEnabled)}
              trailing={
                <View
                  style={[
                    styles.toggle,
                    notifPrefs.pushEnabled && styles.toggleOn,
                    isPushTogglePending && styles.toggleDisabled,
                    isPushTogglePending && styles.toggleLoading,
                  ]}
                >
                  <View style={[styles.toggleThumb, notifPrefs.pushEnabled && styles.toggleThumbOn, isPushTogglePending && styles.toggleThumbLoading]} />
                </View>
              }
            />
          </Section>
          {/* BUDGET */}
          <Section title="Budget Notifications">
            <View style={[styles.sectionBody, styles.budgetContent]}>
              <Text style={styles.budgetHint}>
                We&apos;ll notify you when upcoming maintenance costs in a given month exceed this amount.
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
              {budgetPref?.budget_threshold != null && (
                <Text style={styles.budgetSaved}>
                  Current: ${Number(budgetPref.budget_threshold).toLocaleString()}/mo
                </Text>
              )}
            </View>
          </Section>

          <Section title="Service Prediction">
            <View style={styles.sectionBody}>
            {(predVehicles?.length ?? 0) === 0 ? (
              <View style={styles.predEmpty}>
                <Icon name="car-outline" size={28} color={Colors.textTertiary} />
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
                        onPress={() => { setSelectedVehicleId(pv.id); Haptics.selectionAsync(); }}
                      >
                        <Icon
                          name="car-outline"
                          size={13}
                          color={isSelected ? Colors.accent : Colors.textTertiary}
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
                    <Icon name="speedometer-outline" size={13} color={Colors.textTertiary} />
                    <Text style={styles.vehicleMetaText}>
                      {selectedVehicle.mileage != null ? `${(projectedMileage(selectedVehicle) ?? selectedVehicle.mileage).toLocaleString()} mi est. now · ` : ""}
                      {selectedVehicle.average_miles_per_month.toLocaleString()} mi/mo avg
                    </Text>
                  </View>
                )}

                {predTasksLoading ? (
                  <ActivityIndicator color={Colors.accent} style={{ paddingVertical: 20 }} />
                ) : !predTasks || predTasks.length === 0 ? (
                  <View style={styles.predEmpty}>
                    <Icon name="construct-outline" size={26} color={Colors.textTertiary} />
                    <Text style={styles.predEmptyText}>No maintenance tasks found for this vehicle.</Text>
                  </View>
                ) : (
                  <>
                    <View style={styles.tableHeader}>
                      <Text style={[styles.tableCol, { flex: 2 }]}>Service</Text>
                      <Text style={[styles.tableCol, styles.tableColRight, { flex: 0.85 }]}>Interval</Text>
                      <Text style={[styles.tableCol, styles.tableColRight, { flex: 1.35 }]}>Next Due</Text>
                      <Text style={[styles.tableCol, styles.tableColRight]}>Est. Cost</Text>
                    </View>

                    {predTasks.map((pt, idx) => {
                      const daysLeft = getDaysUntil(pt, selectedVehicle);
                      const color = rowColor(daysLeft);
                      const dateLabel = formatDaysUntil(daysLeft, pt.next_due_date);
                      const intervalLabel = formatInterval(pt);
                      const est = predCosts?.[pt.name.toLowerCase().trim()];
                      const costLabel = est && est.shop_low != null
                        ? formatCostDisplay(Number(est.shop_low), est.shop_high != null ? Number(est.shop_high) : null)
                        : null;
                      const vehicleLabel = selectedVehicle
                        ? (selectedVehicle.nickname ?? `${selectedVehicle.year ?? ""} ${selectedVehicle.make ?? ""} ${selectedVehicle.model ?? ""}`.trim())
                        : "";
                      return (
                        <Pressable
                          key={pt.id}
                          style={({ pressed }) => [styles.tableRow, idx % 2 === 1 && styles.tableRowAlt, { opacity: pressed ? 0.55 : 1 }]}
                          accessibilityRole="button"
                          accessibilityLabel={`${pt.name}, ${intervalLabel}, ${dateLabel}`}
                          onPress={() => {
                            Haptics.selectionAsync();
                            setPredSheetData({ name: pt.name, vehicleLabel, intervalLabel, dueLabel: dateLabel, dueColor: color, costLabel });
                          }}
                        >
                          <View style={{ flex: 2, flexDirection: "row", alignItems: "center", gap: 8 }}>
                            <View style={[styles.tableDot, { backgroundColor: color }]} />
                            <Text style={styles.tableCellMain} numberOfLines={1}>{pt.name}</Text>
                          </View>
                          <Text style={[styles.tableCell, styles.tableCellRight, { flex: 0.85 }]} numberOfLines={1}>{intervalLabel}</Text>
                          <Text style={[styles.tableCell, styles.tableCellRight, { flex: 1.35, color }]} numberOfLines={1}>{dateLabel}</Text>
                          <Text style={[styles.tableCell, styles.tableCellRight, costLabel ? { color: Colors.textSecondary } : { color: Colors.textTertiary }]}>
                            {costLabel ?? "\u2014"}
                          </Text>
                        </Pressable>
                      );
                    })}

                    <View style={styles.tableNote}>
                      <Icon name="information-circle-outline" size={13} color={Colors.textTertiary} />
                      <Text style={styles.tableNoteText}>
                        Dates are calculated from your vehicle&apos;s current mileage and average monthly driving distance.
                      </Text>
                    </View>
                  </>
                )}
              </>
            )}
          </View>
          </Section>

          <ServicePredictionSheet
            ref={predSheetRef}
            data={predSheetData}
            onLogService={() => { if (selectedVehicleId) router.push(`/log-service/${selectedVehicleId}`); }}
            onViewVehicle={() => { if (selectedVehicleId) router.push(`/vehicle/${selectedVehicleId}`); }}
          />

          {/* Action Button shortcut tip card */}
          <Pressable
            style={({ pressed }) => [styles.actionBtnCard, { opacity: pressed ? 0.95 : 1 }]}
            onPress={() => { setActionButtonExpanded(v => !v); Haptics.selectionAsync(); }}
          >
            <View style={styles.actionBtnRow}>
              <View style={styles.actionBtnIconWrap}>
                <Icon name="flash-outline" size={18} color={Colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.actionBtnTitle}>Quick Log with Action Button</Text>
                <Text style={styles.actionBtnSub}>iPhone 15 Pro or newer? Instantly open voice logging.</Text>
              </View>
              <Icon
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
                  <Icon name="link-outline" size={13} color={Colors.accent} />
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

          <ScanPackModal
            ref={scanPackModalRef}
            onClose={() => {}}
            onSuccess={() => {}}
          />

          <View style={{ height: 32 }} />
          <Pressable
            style={({ pressed }) => [styles.deleteAccountBtn, { opacity: pressed ? 0.7 : 1 }]}
            onPress={handleDeleteAccount}
            hitSlop={8}
          >
            <Text style={styles.deleteAccountText}>Delete Account</Text>
          </Pressable>

          {__DEV__ && (
            <Pressable
              onPress={async () => {
                const { resetAllTooltips } = await import("@/components/Tooltip");
                await resetAllTooltips();
                Alert.alert("Tooltips Reset", "All tutorial tips will show again next time you visit each screen.");
              }}
              style={({ pressed }) => ({
                opacity: pressed ? 0.7 : 1,
                paddingVertical: 12,
                alignItems: "center",
                marginTop: 16,
              })}
            >
              <Text style={{ ...Typography.footnote, color: Colors.textTertiary }}>
                Reset Tutorial Tooltips (Dev Only)
              </Text>
            </Pressable>
          )}

        </View>
                {__DEV__ && <DeveloperTestNotifications />}
                {__DEV__ && <DeveloperTestUndoToast />}
      </Screen>

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
                  <Icon name="checkmark" size={16} color={Colors.textInverse} />
                  <Text style={styles.saveBtnText}>Save Changes</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      )}
      <SaveToast visible={saveErrorToastVisible} message={saveErrorToastTitle} subtitle={saveErrorToastSubtitle} isError />
    </View>
  );
}

const styles = StyleSheet.create({
  sectionBody: { padding: Spacing.lg },
  content: { paddingHorizontal: 20, paddingTop: 8, gap: 16 },
  maxWidth: {
    maxWidth: 768,
    alignSelf: "center",
    width: "100%",
    gap: 16,
  },


  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: Radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  bannerPressed: { opacity: 0.9 },
  bannerText: { flex: 1 },
  bannerTitle: { ...Typography.subheadline, fontWeight: "600", color: Colors.text },
  bannerSub: { ...Typography.footnote, color: Colors.textSecondary, marginTop: 2 },
  bannerBtn: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.lg,
    paddingHorizontal: 16,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  bannerBtnText: { ...Typography.footnote, fontWeight: "600", color: Colors.textInverse },


  accountTierLabel: { ...Typography.caption, fontWeight: "600", color: Colors.accent },



  toggle: {
    width: 50,
    height: 30,
    borderRadius: Radius.lg,
    backgroundColor: Colors.border,
    justifyContent: "center",
    paddingHorizontal: 2,
    overflow: "hidden",
  },
  toggleOn: { backgroundColor: Colors.accent },
  toggleDisabled: { opacity: 1 },
  toggleLoading: { opacity: 0.82 },
  toggleThumb: { width: 26, height: 26, borderRadius: Radius.pill, backgroundColor: Colors.text, alignSelf: "flex-start" },
  toggleThumbOn: { alignSelf: "flex-end" },
  toggleThumbLoading: { opacity: 0.72 },

  deleteAccountBtn: { alignItems: "center", paddingVertical: 12, minHeight: 44, justifyContent: "center" },
  deleteAccountText: { ...Typography.footnote, color: Colors.overdue },

  rowDivider: { height: 1, backgroundColor: Colors.border, marginHorizontal: -16, marginVertical: 0 },

  budgetContent: { gap: 12 },
  budgetHint: { ...Typography.footnote, color: Colors.textSecondary },
  budgetInputRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  budgetInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    flex: 1,
    maxWidth: 160,
    height: 46,
  },
  budgetCurrency: { ...Typography.body, fontWeight: "500", color: Colors.textSecondary },
  budgetInput: {
    ...Typography.body,
    flex: 1,
    paddingVertical: 12,
    color: Colors.text,
    paddingLeft: 4,
    minHeight: 44,
  },
  budgetLabel: { ...Typography.footnote, color: Colors.textTertiary },
  budgetSaved: { ...Typography.caption, color: Colors.good },

  chipScrollWrap: { marginHorizontal: -16, marginBottom: 12 },
  chipScroll: { paddingHorizontal: 16, gap: 8 },
  vehicleChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    minHeight: 36,
  },
  vehicleChipSelected: {
    backgroundColor: Colors.accentMuted,
    borderColor: Colors.accent,
  },
  vehicleChipText: { ...Typography.footnote, fontWeight: "500", color: Colors.textTertiary },
  vehicleChipTextSelected: { fontWeight: "600", color: Colors.accent },
  vehicleMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  vehicleMetaText: { ...Typography.caption, color: Colors.textTertiary },
  predEmpty: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 12,
  },
  predEmptyText: {
    ...Typography.footnote,
    color: Colors.textSecondary,
    textAlign: "center",
  },

  tableHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    marginHorizontal: -16,
    paddingHorizontal: 20,
    backgroundColor: Colors.surface,
  },
  tableCol: { ...Typography.caption, fontWeight: "600", color: Colors.textTertiary, textTransform: "uppercase", letterSpacing: 0.6, flex: 1 },
  tableColRight: { textAlign: "right" },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    marginHorizontal: -16,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  tableRowAlt: { backgroundColor: Colors.surface + "80" },
  tableDot: { width: 6, height: 6, borderRadius: Radius.pill, flexShrink: 0 },
  tableCellMain: { ...Typography.footnote, fontWeight: "500", color: Colors.text, flex: 1 },
  tableCell: { ...Typography.caption, flex: 1, color: Colors.textSecondary },
  tableCellRight: { textAlign: "right" },
  tableNote: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
    marginHorizontal: -16,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    alignItems: "flex-start",
  },
  tableNoteText: { ...Typography.caption, flex: 1, color: Colors.textTertiary },

  legalRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  legalBtn: { paddingVertical: 8, paddingHorizontal: 4, minHeight: 44, justifyContent: "center" },
  legalBtnText: { ...Typography.footnote, color: Colors.textTertiary },
  scansRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 },
  scansIconWrap: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  scansLabel: { ...Typography.subheadline, fontWeight: "500", color: Colors.text },
  scansSub: { ...Typography.footnote, color: Colors.textSecondary, marginTop: 2 },
  scansCtaWrap: { paddingTop: 8 },
  manageSubCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  manageSubText: { flex: 1 },
  manageSubTitle: { ...Typography.subheadline, fontWeight: "600", color: Colors.text },
  manageSubSub: { ...Typography.footnote, color: Colors.textSecondary, marginTop: 2 },
  manageSubPill: {
    height: 40,
    borderRadius: Radius.md,
    paddingHorizontal: 16,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  manageSubPillText: {
    ...Typography.footnote,
    fontWeight: "600",
    color: Colors.accent,
  },
  legalDot: { ...Typography.footnote, color: Colors.textTertiary },
  version: { ...Typography.caption, color: Colors.textTertiary, textAlign: "center" },

  saveBar: {
    position: "absolute",
    bottom: Platform.OS === "web" ? 84 : 80,
    left: 0,
    right: 0,
    zIndex: 100,
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
  saveBarHint: { ...Typography.footnote, color: Colors.textSecondary },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.accent,
    borderRadius: Radius.md,
    paddingHorizontal: 20,
    paddingVertical: 12,
    minHeight: 44,
  },
  saveBtnText: { ...Typography.footnote, fontWeight: "600", color: Colors.textInverse },

  actionBtnCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
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
    borderRadius: Radius.md,
    backgroundColor: Colors.accent + "18",
    alignItems: "center",
    justifyContent: "center",
  },
  actionBtnTitle: {
    ...Typography.footnote,
    fontWeight: "600",
    color: Colors.text,
    marginBottom: 2,
  },
  actionBtnSub: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
  actionBtnSteps: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    padding: 16,
    gap: 12,
  },
  actionBtnStepHeader: {
    ...Typography.caption,
    fontWeight: "600",
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  actionBtnStep: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  actionBtnStepNum: {
    width: 20,
    height: 20,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accent + "22",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  actionBtnStepNumText: {
    ...Typography.caption,
    fontWeight: "600",
    color: Colors.accent,
  },
  actionBtnStepText: {
    ...Typography.footnote,
    flex: 1,
    color: Colors.text,
  },
  actionBtnUrlBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 4,
  },
  actionBtnUrl: {
    ...Typography.caption,
    fontWeight: "500",
    color: Colors.accent,
  },
});
