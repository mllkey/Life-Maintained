import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  RefreshControl,
  Platform,
  TextInput,
  LayoutAnimation,
  ActivityIndicator,
  UIManager,
  Modal,
  KeyboardAvoidingView,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import { usePulse, S, Row, Col } from "@/components/Skeleton";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { LinearGradient } from "expo-linear-gradient";
import { differenceInDays, parseISO, isBefore, addDays, format, subMonths, startOfMonth } from "date-fns";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useBudgetAlert } from "@/context/BudgetAlertContext";
import TrialBanner from "@/components/TrialBanner";
import { MILEAGE_TRACKED_TYPES } from "@/lib/vehicleTypes";
import * as Linking from "expo-linking";
import { LogSheet } from "@/components/LogSheet";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const SCREENING_NOTIF_KEY = "screening_notif_optins";

const CAT = {
  vehicles: { color: Colors.blue, muted: Colors.blueMuted, icon: "car" as const, label: "Vehicles", desc: "Cars, trucks, motorcycles & more", addRoute: "/add-vehicle" as any, tab: "/(tabs)/vehicles" as any },
  properties: { color: Colors.good, muted: Colors.goodMuted, icon: "home" as const, label: "Properties", desc: "Home, HVAC, roof & appliances", addRoute: "/add-property" as any, tab: "/(tabs)/home-tab" as any },
  health: { color: Colors.health, muted: Colors.healthMuted, icon: "heart" as const, label: "Health", desc: "Appointments & medications", addRoute: "/add-appointment" as any, tab: "/(tabs)/health" as any },
} as const;

type DashboardItem = {
  id: string;
  title: string;
  subtitle: string;
  dueDate: string | null;
  status: "overdue" | "due_soon" | "good";
  category: "vehicles" | "properties" | "health";
  entityId: string;
};

type MileageVehicle = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  nickname: string | null;
  mileage: number | null;
  vehicle_type: string | null;
  updated_at: string | null;
};


function getStatus(dueDate: string | null): "overdue" | "due_soon" | "good" {
  if (!dueDate) return "good";
  const due = parseISO(dueDate);
  const today = new Date();
  if (isBefore(due, today)) return "overdue";
  if (isBefore(due, addDays(today, 30))) return "due_soon";
  return "good";
}

function formatDueDate(dueDate: string | null): string {
  if (!dueDate) return "No due date";
  const due = parseISO(dueDate);
  const today = new Date();
  const days = differenceInDays(due, today);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 30) return `${days}d`;
  return format(due, "MMM d");
}

function getAgeScreenings(dob: string | null, sex: string | null): { title: string; description: string }[] {
  if (!dob) return [];
  const age = new Date().getFullYear() - parseISO(dob).getFullYear();
  const screenings: { title: string; description: string }[] = [];
  if (age >= 45) screenings.push({ title: "Colonoscopy", description: "Recommended every 10 years from age 45" });
  if (age >= 18) screenings.push({ title: "Annual Physical", description: "Yearly checkup with your primary care provider" });
  if (sex === "female" && age >= 40) screenings.push({ title: "Mammogram", description: "Recommended annually from age 40" });
  if (sex === "male" && age >= 50) screenings.push({ title: "Prostate Screening", description: "PSA test recommended from age 50" });
  if (age >= 20) screenings.push({ title: "Skin Check", description: "Annual full-body skin exam" });
  if (age >= 18) screenings.push({ title: "Eye Exam", description: "Comprehensive exam every 1–2 years" });
  return screenings;
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [screeningOptIns, setScreeningOptIns] = useState<Record<string, boolean>>({});
  const [budgetDismissed, setBudgetDismissed] = useState(false);
  const [logSheetVisible, setLogSheetVisible] = useState(false);
  const handledDeepLinkRef = useRef<string | null>(null);
  const webTopPad = Platform.OS === "web" ? 67 : 0;
  const { monthlyCost, budgetThreshold } = useBudgetAlert();

  // Deep link: lifemaintained://voice-log → auto-open the voice log sheet
  useEffect(() => {
    if (!user) return;

    const openIfMatch = (url: string | null) => {
      if (!url || url === handledDeepLinkRef.current) return;
      try {
        const parsed = Linking.parse(url);
        if (parsed.scheme === "lifemaintained" && parsed.path === "voice-log") {
          handledDeepLinkRef.current = url;
          setLogSheetVisible(true);
        }
      } catch {}
    };

    Linking.getInitialURL().then(openIfMatch);
    const sub = Linking.addEventListener("url", (e) => openIfMatch(e.url));
    return () => sub.remove();
  }, [user]);

  useEffect(() => {
    AsyncStorage.getItem(SCREENING_NOTIF_KEY).then(raw => {
      if (raw) setScreeningOptIns(JSON.parse(raw));
    });
    const now = new Date();
    const dismissKey = `budget_dismissed_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, "0")}`;
    AsyncStorage.getItem(dismissKey).then(val => {
      if (val === "true") setBudgetDismissed(true);
    });
  }, []);

  async function dismissBudgetBanner() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBudgetDismissed(true);
    const now = new Date();
    const dismissKey = `budget_dismissed_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, "0")}`;
    await AsyncStorage.setItem(dismissKey, "true");
  }

  async function toggleScreeningOptIn(title: string) {
    Haptics.selectionAsync();
    const next = { ...screeningOptIns, [title]: !screeningOptIns[title] };
    setScreeningOptIns(next);
    await AsyncStorage.setItem(SCREENING_NOTIF_KEY, JSON.stringify(next));
  }

  const { data: counts, isLoading: countsLoading, refetch: refetchCounts } = useQuery({
    queryKey: ["dashboard_counts", user?.id],
    queryFn: async () => {
      if (!user) return { vehicles: 0, properties: 0, health: 0 };
      const [veh, prop, health] = await Promise.all([
        supabase.from("vehicles").select("id", { count: "exact", head: true }).eq("user_id", user.id),
        supabase.from("properties").select("id", { count: "exact", head: true }).eq("user_id", user.id),
        supabase.from("health_appointments").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      ]);
      return {
        vehicles: veh.count ?? 0,
        properties: prop.count ?? 0,
        health: health.count ?? 0,
      };
    },
    enabled: !!user,
  });

  const { data: dashboardItems, isLoading: dashLoading, refetch: refetchDash } = useQuery({
    queryKey: ["dashboard", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const items: DashboardItem[] = [];
      const [vehicleTasks, propertyTasks, healthAppts] = await Promise.all([
        supabase.from("user_vehicle_maintenance_tasks").select("*, vehicles(make, model, nickname)").eq("vehicles.user_id", user.id),
        supabase.from("property_maintenance_tasks").select("*, properties(address, nickname)").eq("properties.user_id", user.id),
        supabase.from("health_appointments").select("*").eq("user_id", user.id),
      ]);
      for (const t of vehicleTasks.data ?? []) {
        const v = (t as any).vehicles;
        if (!v) continue;
        const status = getStatus(t.next_due_date);
        if (status !== "good") {
          items.push({ id: t.id, title: t.name, subtitle: v.nickname ?? `${v.make} ${v.model}`, dueDate: t.next_due_date, status, category: "vehicles", entityId: t.vehicle_id });
        }
      }
      for (const t of propertyTasks.data ?? []) {
        const p = (t as any).properties;
        if (!p) continue;
        const status = getStatus(t.next_due_date);
        if (status !== "good") {
          items.push({ id: t.id, title: t.task, subtitle: p.nickname ?? p.address ?? "Property", dueDate: t.next_due_date, status, category: "properties", entityId: t.property_id });
        }
      }
      for (const a of healthAppts.data ?? []) {
        const status = getStatus(a.next_due_date);
        if (status !== "good") {
          items.push({ id: a.id, title: a.appointment_type, subtitle: a.provider_name ?? "Health", dueDate: a.next_due_date, status, category: "health", entityId: a.id });
        }
      }
      return items.sort((a, b) => {
        const order = { overdue: 0, due_soon: 1, good: 2 };
        return order[a.status] - order[b.status];
      });
    },
    enabled: !!user,
  });

  const { data: spending, refetch: refetchSpending } = useQuery({
    queryKey: ["dashboard_spending", user?.id],
    queryFn: async () => {
      if (!user) return {};
      const { data: veh } = await supabase.from("vehicles").select("id").eq("user_id", user.id);
      if (!veh || veh.length === 0) return {};
      const ids = veh.map(v => v.id);
      const sixMonthsAgo = startOfMonth(subMonths(new Date(), 5)).toISOString().split("T")[0];
      const { data: logs } = await supabase
        .from("maintenance_logs")
        .select("service_date, cost")
        .in("vehicle_id", ids)
        .gte("service_date", sixMonthsAgo)
        .not("cost", "is", null);
      const map: Record<string, number> = {};
      for (const log of logs ?? []) {
        if (!log.service_date || log.cost == null) continue;
        const key = log.service_date.substring(0, 7);
        map[key] = (map[key] ?? 0) + log.cost;
      }
      return map;
    },
    enabled: !!user,
  });

  const { data: mileageVehicles, refetch: refetchMileage } = useQuery({
    queryKey: ["mileage_vehicles", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase
        .from("vehicles")
        .select("id, year, make, model, nickname, mileage, vehicle_type, updated_at")
        .eq("user_id", user.id)
        .in("vehicle_type", MILEAGE_TRACKED_TYPES as unknown as string[]);
      return (data ?? []) as MileageVehicle[];
    },
    enabled: !!user,
  });

  const { data: healthProfile } = useQuery({
    queryKey: ["health_profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase.from("health_profiles").select("*").eq("user_id", user.id).single();
      return data;
    },
    enabled: !!user,
  });

  const { data: familyMembers } = useQuery({
    queryKey: ["family_members_count", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase.from("family_members").select("id").eq("user_id", user.id);
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: totalTasksData, refetch: refetchTotalTasks } = useQuery({
    queryKey: ["total_tasks_count", user?.id],
    queryFn: async () => {
      if (!user) return 0;
      const [veh, prop, health] = await Promise.all([
        supabase.from("user_vehicle_maintenance_tasks").select("vehicles!inner(user_id)", { count: "exact", head: true }).eq("vehicles.user_id", user.id),
        supabase.from("property_maintenance_tasks").select("properties!inner(user_id)", { count: "exact", head: true }).eq("properties.user_id", user.id),
        supabase.from("health_appointments").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      ]);
      return (veh.count ?? 0) + (prop.count ?? 0) + (health.count ?? 0);
    },
    enabled: !!user,
  });

  function refetch() {
    refetchCounts();
    refetchDash();
    refetchSpending();
    refetchMileage();
    refetchTotalTasks();
  }

  const isLoading = countsLoading || dashLoading;
  const isNewUser = !isLoading && counts != null && counts.vehicles === 0 && counts.properties === 0 && counts.health === 0;
  const screenings = healthProfile ? getAgeScreenings(healthProfile.date_of_birth, healthProfile.sex_at_birth) : [];
  const upcomingItems = dashboardItems?.slice(0, 6) ?? [];

  const overdueCnt = dashboardItems?.filter(i => i.status === "overdue").length ?? 0;
  const dueSoonCnt = dashboardItems?.filter(i => i.status === "due_soon").length ?? 0;
  const totalTasks = totalTasksData ?? 0;
  const rawScore = totalTasks === 0 ? 100 : Math.round(((totalTasks - overdueCnt - dueSoonCnt * 0.5) / totalTasks) * 100);
  const healthScore = Math.max(0, Math.min(100, rawScore));
  const onTrackCnt = Math.max(0, totalTasks - overdueCnt - dueSoonCnt);

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
    <ScrollView
      style={{ flex: 1 }}
      showsVerticalScrollIndicator={false}
      contentInsetAdjustmentBehavior="never"
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={Colors.accent} />}
    >
      <LinearGradient
        colors={["rgba(232,147,58,0.06)", "transparent"]}
        style={[styles.headerGradient, { paddingTop: insets.top + webTopPad + 16 }]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>{getGreeting()}</Text>
            <Text style={styles.headerTitle}>Dashboard</Text>
            {!isLoading && !isNewUser && (
              <Text style={styles.headerSummary}>
                {counts?.vehicles ?? 0} vehicle{(counts?.vehicles ?? 0) !== 1 ? "s" : ""}{" · "}{counts?.properties ?? 0} propert{(counts?.properties ?? 0) !== 1 ? "ies" : "y"}{" · "}{counts?.health ?? 0} health item{(counts?.health ?? 0) !== 1 ? "s" : ""}
              </Text>
            )}
          </View>
          {!isNewUser && !isLoading && (
            <View style={styles.statusBadges}>
              {(dashboardItems?.filter(i => i.status === "overdue").length ?? 0) > 0 && (
                <View style={[styles.badge, { backgroundColor: Colors.overdueMuted }]}>
                  <View style={[styles.badgeDot, { backgroundColor: Colors.overdue }]} />
                  <Text style={[styles.badgeText, { color: Colors.overdue }]}>
                    {dashboardItems!.filter(i => i.status === "overdue").length} overdue
                  </Text>
                </View>
              )}
              {(dashboardItems?.filter(i => i.status === "due_soon").length ?? 0) > 0 && (
                <View style={[styles.badge, { backgroundColor: Colors.dueSoonMuted }]}>
                  <View style={[styles.badgeDot, { backgroundColor: Colors.dueSoon }]} />
                  <Text style={[styles.badgeText, { color: Colors.dueSoon }]}>
                    {dashboardItems!.filter(i => i.status === "due_soon").length} due soon
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
      </LinearGradient>

      <View style={[styles.content, { paddingBottom: insets.bottom + 100 + (Platform.OS === "web" ? 34 : 0) }]}>
        {isLoading ? (
          <DashboardSkeleton />
        ) : isNewUser ? (
          <WelcomeView />
        ) : (
          <>
            <TrialBanner />
            {!budgetDismissed && !!budgetThreshold && budgetThreshold > 0 && monthlyCost > budgetThreshold && (
              <Pressable onPress={dismissBudgetBanner} style={styles.budgetBanner} accessibilityRole="button" accessibilityLabel="Dismiss budget alert">
                <Ionicons name="warning-outline" size={15} color={Colors.dueSoon} style={{ flexShrink: 0, marginTop: 1 }} />
                <Text style={styles.budgetBannerText} numberOfLines={3}>
                  {"Heads up: $"}{monthlyCost.toFixed(0)}{" estimated in maintenance this month (your alert is set to $"}{budgetThreshold.toFixed(0)}{")"}</Text>
                <Ionicons name="close" size={14} color={Colors.dueSoon} style={{ flexShrink: 0, marginTop: 1 }} />
              </Pressable>
            )}
            {(mileageVehicles?.length ?? 0) > 0 && (
              <QuickMileageCard vehicles={mileageVehicles!} userId={user!.id} />
            )}

            {totalTasks > 0 && (
              <HealthScoreCard
                score={healthScore}
                overdue={overdueCnt}
                dueSoon={dueSoonCnt}
                onTrack={onTrackCnt}
              />
            )}

            <UpcomingTasksCard items={upcomingItems} />

            <SpendingChartCard spending={spending} />

            <QuickActionsRow onLogService={() => setLogSheetVisible(true)} />

            {screenings.length > 0 && (familyMembers?.length ?? 0) > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionLabel}>HEALTH SCREENINGS</Text>
                </View>
                {screenings.slice(0, 3).map((s, i) => (
                  <Pressable key={i} style={({ pressed }) => [styles.screeningCard, { opacity: pressed ? 0.8 : 1 }]} onPress={() => router.push("/add-appointment" as any)}>
                    <View style={styles.screeningBar} />
                    <View style={styles.screeningContent}>
                      <Text style={styles.screeningTitle}>{s.title}</Text>
                      <Text style={styles.screeningDesc}>{s.description}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
          </>
        )}
      </View>
    </ScrollView>

    <LogSheet
      visible={logSheetVisible}
      onClose={() => setLogSheetVisible(false)}
      userId={user?.id ?? ""}
    />
    </View>
  );
}

function formatMileageAge(updatedAt: string | null): string {
  if (!updatedAt) return "Never updated";
  const days = differenceInDays(new Date(), parseISO(updatedAt));
  if (days === 0) return "Updated today";
  if (days === 1) return "Updated 1d ago";
  return `Updated ${days}d ago`;
}

function QuickMileageCard({ vehicles, userId }: { vehicles: MileageVehicle[]; userId: string }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isStale = (v: MileageVehicle) => {
    if (!v.updated_at) return true;
    return differenceInDays(new Date(), parseISO(v.updated_at)) >= 7;
  };

  const staleCount = vehicles.filter(isStale).length;
  const allUpToDate = staleCount === 0;

  const sortedVehicles = [...vehicles].sort((a, b) => {
    const aDays = a.updated_at ? differenceInDays(new Date(), parseISO(a.updated_at)) : 9999;
    const bDays = b.updated_at ? differenceInDays(new Date(), parseISO(b.updated_at)) : 9999;
    return bDays - aDays;
  });

  function getInput(v: MileageVehicle): string {
    return inputs[v.id] ?? (v.mileage != null ? String(v.mileage) : "");
  }

  async function handleSave(v: MileageVehicle) {
    const input = getInput(v).replace(/,/g, "");
    const newMileage = parseInt(input, 10);
    if (!input.trim() || isNaN(newMileage) || newMileage <= 0) {
      setErrors(e => ({ ...e, [v.id]: "Please enter a valid mileage" }));
      return;
    }
    if (v.mileage != null && newMileage < v.mileage) {
      setErrors(e => ({ ...e, [v.id]: "Mileage can't be less than current reading" }));
      return;
    }
    setErrors(e => ({ ...e, [v.id]: "" }));
    setSaving(s => ({ ...s, [v.id]: true }));
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const now = new Date().toISOString();
      const { error: updateErr } = await supabase.from("vehicles").update({ mileage: newMileage, updated_at: now }).eq("id", v.id);
      if (updateErr) throw updateErr;
      const { error: histErr } = await supabase.from("vehicle_mileage_history").insert({ vehicle_id: v.id, user_id: userId, mileage: newMileage, recorded_at: now });
      if (histErr && !histErr.message.includes("does not exist")) throw histErr;
      setSaved(s => ({ ...s, [v.id]: true }));
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["mileage_vehicles"] });
      setTimeout(() => {
        setSaved(s => ({ ...s, [v.id]: false }));
      }, 1500);
    } catch {
      setErrors(e => ({ ...e, [v.id]: "Save failed. Try again." }));
    } finally {
      setSaving(s => ({ ...s, [v.id]: false }));
    }
  }

  function VehicleRow({ v }: { v: MileageVehicle }) {
    const stale = isStale(v);
    const inputVal = getInput(v);
    const isSaving = saving[v.id] ?? false;
    const isSaved = saved[v.id] ?? false;
    const err = errors[v.id];
    const vehicleName = v.nickname ?? [v.year, v.make, v.model].filter(Boolean).join(" ");

    return (
      <View style={styles.qmVehicleRow}>
        <View style={styles.qmVehicleInfo}>
          <Text style={styles.qmVehicleName} numberOfLines={1}>{vehicleName}</Text>
          <Text style={[styles.qmVehicleAge, { color: stale ? Colors.dueSoon : Colors.good }]}>
            {formatMileageAge(v.updated_at)}
          </Text>
          {!!err && <Text style={styles.qmError}>{err}</Text>}
        </View>
        <View style={styles.qmInputRow}>
          <TextInput
            style={styles.qmInput}
            value={inputVal}
            onChangeText={t => {
              setInputs(i => ({ ...i, [v.id]: t }));
              if (errors[v.id]) setErrors(e => ({ ...e, [v.id]: "" }));
            }}
            keyboardType="number-pad"
            returnKeyType="done"
            onSubmitEditing={() => handleSave(v)}
            selectTextOnFocus
            placeholder="miles"
            placeholderTextColor={Colors.textTertiary}
          />
          <Pressable
            style={[styles.qmSaveBtn, isSaved && { backgroundColor: Colors.good }]}
            onPress={() => { if (!isSaving && !isSaved) handleSave(v); }}
            disabled={isSaving}
          >
            {isSaved ? (
              <Ionicons name="checkmark" size={14} color="#fff" />
            ) : isSaving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.qmSaveBtnText}>Save</Text>
            )}
          </Pressable>
        </View>
      </View>
    );
  }

  if (vehicles.length === 1) {
    const v = vehicles[0];
    const vehicleName = v.nickname ?? [v.year, v.make, v.model].filter(Boolean).join(" ");
    return (
      <View style={styles.qmCard}>
        <View style={styles.qmCardHeaderStatic}>
          <View style={{ flex: 1 }}>
            <Text style={styles.qmCardTitle}>{vehicleName}</Text>
            <Text style={styles.qmCardSub}>Update mileage</Text>
          </View>
          <View style={styles.qmInputRow}>
            <TextInput
              style={styles.qmInput}
              value={getInput(v)}
              onChangeText={t => {
                setInputs(i => ({ ...i, [v.id]: t }));
                if (errors[v.id]) setErrors(e => ({ ...e, [v.id]: "" }));
              }}
              keyboardType="number-pad"
              returnKeyType="done"
              onSubmitEditing={() => handleSave(v)}
              selectTextOnFocus
              placeholder="miles"
              placeholderTextColor={Colors.textTertiary}
            />
            <Pressable
              style={[styles.qmSaveBtn, (saved[v.id] ?? false) && { backgroundColor: Colors.good }]}
              onPress={() => { if (!(saving[v.id] ?? false) && !(saved[v.id] ?? false)) handleSave(v); }}
              disabled={saving[v.id] ?? false}
            >
              {(saved[v.id] ?? false) ? (
                <Ionicons name="checkmark" size={14} color="#fff" />
              ) : (saving[v.id] ?? false) ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.qmSaveBtnText}>Save</Text>
              )}
            </Pressable>
          </View>
        </View>
        {!!(errors[v.id]) && <Text style={[styles.qmError, { marginTop: 6, marginLeft: 50 }]}>{errors[v.id]}</Text>}
      </View>
    );
  }

  return (
    <View style={styles.qmCard}>
      <Pressable
        style={styles.qmCardHeader}
        onPress={() => {
          Haptics.selectionAsync();
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setExpanded(e => !e);
        }}
        accessibilityRole="button"
        accessibilityLabel={expanded ? "Collapse mileage updater" : "Expand mileage updater"}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.qmCardTitle}>Mileage</Text>
          <Text style={[styles.qmCardSub, { color: allUpToDate ? Colors.good : Colors.dueSoon }]}>
            {allUpToDate
              ? "All up to date"
              : `${staleCount} vehicle${staleCount !== 1 ? "s" : ""} need updating`}
          </Text>
        </View>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={16}
          color={Colors.textTertiary}
        />
      </Pressable>

      {expanded && (
        <View style={styles.qmVehicleList}>
          {sortedVehicles.map((v, idx) => (
            <View key={v.id} style={idx < sortedVehicles.length - 1 ? styles.qmVehicleRowBorder : undefined}>
              <VehicleRow v={v} />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ConfirmCard and LogSheet moved to components/LogSheet.tsx

function DashboardSkeleton() {
  const anim = usePulse();
  return (
    <View style={{ gap: 20 }}>
      <Row gap={10} align="flex-start">
        {[0, 1, 2].map(i => (
          <View key={i} style={[styles.catCard, { gap: 8 }]}>
            <S anim={anim} w={44} h={44} r={13} />
            <S anim={anim} w={36} h={22} r={6} />
            <S anim={anim} w="65%" h={11} r={5} />
          </View>
        ))}
      </Row>

      <Row gap={10} align="flex-start">
        <View style={[styles.panelCard, { flex: 5, gap: 10 }]}>
          <Row gap={8}>
            <S anim={anim} w={70} h={13} r={5} />
            <S anim={anim} w={28} h={22} r={7} ml={4} />
          </Row>
          {[0, 1, 2, 3, 4].map(i => (
            <Row key={i} gap={8}>
              <S anim={anim} w={7} h={7} r={3.5} />
              <Col flex={1} gap={4}>
                <S anim={anim} w="70%" h={12} r={5} />
                <S anim={anim} w="45%" h={10} r={4} />
              </Col>
              <S anim={anim} w={30} h={12} r={5} />
            </Row>
          ))}
        </View>

        <View style={[styles.panelCard, { flex: 3, gap: 6 }]}>
          <S anim={anim} w={55} h={13} r={5} />
          <S anim={anim} w={64} h={22} r={6} mt={2} />
          <S anim={anim} w={44} h={11} r={4} />
          <Row gap={4} align="flex-end" mt={8}>
            {[48, 20, 36, 28, 44, 16].map((barH, i) => (
              <View key={i} style={{ flex: 1, alignItems: "center", gap: 4 }}>
                <S anim={anim} w="100%" h={barH} r={3} />
                <S anim={anim} w={8} h={8} r={4} />
              </View>
            ))}
          </Row>
        </View>
      </Row>
    </View>
  );
}

function UpcomingTasksCard({ items }: { items: DashboardItem[] }) {
  function handlePress(item: DashboardItem) {
    Haptics.selectionAsync();
    if (item.category === "vehicles") router.push(`/vehicle/${item.entityId}` as any);
    else if (item.category === "properties") router.push(`/property/${item.entityId}` as any);
    else router.push("/(tabs)/health");
  }

  const visibleItems = items.slice(0, 4);
  const hasMore = items.length > 4;
  const firstNavItem = items.find(i => i.category === "vehicles" || i.category === "properties");
  const seeAllRoute: any = firstNavItem?.category === "vehicles" ? "/(tabs)/vehicles" : "/(tabs)/home-tab";

  return (
    <>
      {items.length > 0 && (
        <Text style={styles.sectionLabel}>NEEDS ATTENTION</Text>
      )}
      <View style={styles.panelCard}>
        {items.length === 0 ? (
          <View style={styles.panelEmpty}>
            <Ionicons name="checkmark-circle-outline" size={24} color={Colors.good} />
            <Text style={styles.panelEmptyText}>All good</Text>
          </View>
        ) : (
          <View style={styles.taskList}>
            {visibleItems.map((item, idx) => {
              const statusColor = item.status === "overdue" ? Colors.overdue : Colors.dueSoon;
              return (
                <Pressable
                  key={item.id}
                  style={({ pressed }) => [
                    styles.taskRow,
                    (idx < visibleItems.length - 1 || hasMore) && styles.taskRowBorder,
                    { opacity: pressed ? 0.75 : 1 },
                  ]}
                  onPress={() => handlePress(item)}
                >
                  <View style={[styles.taskBar, { backgroundColor: statusColor }]} />
                  <View style={styles.taskInfo}>
                    <Text style={styles.taskTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.taskSub} numberOfLines={1}>{item.subtitle}</Text>
                  </View>
                  <Text style={[styles.taskDue, { color: statusColor }]}>{formatDueDate(item.dueDate)}</Text>
                </Pressable>
              );
            })}
            {hasMore && (
              <Pressable
                style={({ pressed }) => [styles.seeAllRow, { opacity: pressed ? 0.7 : 1 }]}
                onPress={() => { Haptics.selectionAsync(); router.push(seeAllRoute); }}
              >
                <Text style={styles.seeAllText}>{"See all "}{items.length}{" items →"}</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </>
  );
}

function HealthScoreCard({ score, overdue, dueSoon, onTrack }: { score: number; overdue: number; dueSoon: number; onTrack: number }) {
  const scoreColor = score >= 80 ? Colors.good : score >= 50 ? Colors.dueSoon : Colors.overdue;
  const r = 30;
  const cx = 36;
  const cy = 36;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - score / 100);
  const message =
    score >= 90 ? "Everything is on track" :
    score >= 70 ? "A few items need attention" :
    score >= 50 ? "Several items are overdue" :
    "Maintenance is falling behind";

  return (
    <View style={styles.scoreCard}>
      <View style={{ width: 72, height: 72 }}>
        <Svg width={72} height={72} style={{ transform: [{ rotate: "-90deg" }] }}>
          <Circle cx={cx} cy={cy} r={r} stroke={Colors.border} strokeWidth={6} fill="none" />
          <Circle
            cx={cx} cy={cy} r={r}
            stroke={scoreColor}
            strokeWidth={6}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        </Svg>
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 20, fontFamily: "Inter_700Bold", color: scoreColor, lineHeight: 24 }}>
            {score}<Text style={{ fontSize: 11 }}>%</Text>
          </Text>
        </View>
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.scoreTitle}>Maintenance Score</Text>
        <Text style={styles.scoreMessage}>{message}</Text>
        <Text style={styles.scoreDetail}>{onTrack} on track · {dueSoon} due soon · {overdue} overdue</Text>
      </View>
    </View>
  );
}

function SpendingChartCard({ spending }: { spending: Record<string, number> | undefined }) {
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = subMonths(new Date(), 5 - i);
    return { key: format(d, "yyyy-MM"), label: format(d, "MMM") };
  });
  const currentMonthKey = format(new Date(), "yyyy-MM");
  const amounts = months.map(m => (spending ?? {})[m.key] ?? 0);
  const maxAmount = Math.max(...amounts, 1);
  const currentMonthTotal = (spending ?? {})[currentMonthKey] ?? 0;
  const hasData = amounts.some(a => a > 0);

  return (
    <>
      <Text style={styles.sectionLabel}>SPENDING</Text>
      <View style={styles.panelCard}>
        <View style={styles.spendingTopRow}>
          <Text style={styles.spendingThisMonth}>This month</Text>
          <Text style={styles.spendingAmount}>${currentMonthTotal.toFixed(0)}</Text>
        </View>
        {!hasData ? (
          <Text style={styles.spendingEmpty}>No spending recorded yet</Text>
        ) : (
          <View style={styles.spendingBars}>
            {months.map((m, i) => {
              const amount = amounts[i];
              const isCurrent = m.key === currentMonthKey;
              const widthPercent = (amount / maxAmount) * 100;
              return (
                <View key={m.key} style={styles.spendingBarRow}>
                  <View style={styles.spendingBarTrack}>
                    <View style={[styles.spendingBarFill, { width: `${widthPercent}%` as any, opacity: isCurrent ? 1 : 0.5 }]} />
                  </View>
                  <Text style={styles.spendingBarLabel}>{m.label}</Text>
                </View>
              );
            })}
          </View>
        )}
      </View>
    </>
  );
}

function QuickActionsRow({ onLogService }: { onLogService: () => void }) {
  return (
    <View style={styles.quickActionsRow}>
      <Pressable
        style={({ pressed }) => [styles.quickActionBtn, { opacity: pressed ? 0.75 : 1 }]}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onLogService(); }}
      >
        <Ionicons name="mic-outline" size={20} color={Colors.accent} />
        <Text style={styles.quickActionLabel}>Log Service</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.quickActionBtn, { opacity: pressed ? 0.75 : 1 }]}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/add-vehicle"); }}
      >
        <Ionicons name="car-outline" size={20} color={Colors.accent} />
        <Text style={styles.quickActionLabel}>Add Vehicle</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.quickActionBtn, { opacity: pressed ? 0.75 : 1 }]}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/add-property"); }}
      >
        <Ionicons name="home-outline" size={20} color={Colors.accent} />
        <Text style={styles.quickActionLabel}>Add Property</Text>
      </Pressable>
    </View>
  );
}

function WelcomeView() {
  const cats: (keyof typeof CAT)[] = ["vehicles", "properties", "health"];
  return (
    <View style={styles.welcomeWrap}>
      <View style={styles.welcomeBanner}>
        <View style={styles.welcomeIconWrap}>
          <Ionicons name="sparkles" size={28} color={Colors.accent} />
        </View>
        <View style={styles.welcomeText}>
          <Text style={styles.welcomeTitle}>Welcome to LifeMaintained!</Text>
          <Text style={styles.welcomeBody}>Stay on top of your vehicles, home, and health maintenance.</Text>
        </View>
      </View>
      <View style={styles.emptyCardsRow}>
        {cats.map(key => {
          const cat = CAT[key];
          return (
            <View key={key} style={[styles.emptyCard, { borderColor: cat.color + "55" }]}>
              <View style={[styles.emptyCardIcon, { backgroundColor: cat.muted }]}>
                <Ionicons name={cat.icon} size={24} color={cat.color} />
              </View>
              <Text style={styles.emptyCardLabel}>{cat.label}</Text>
              <Text style={styles.emptyCardDesc}>{cat.desc}</Text>
              <Pressable
                style={({ pressed }) => [styles.emptyCardBtn, { backgroundColor: cat.color, opacity: pressed ? 0.85 : 1 }]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(cat.addRoute); }}
              >
                <Ionicons name="add" size={18} color={Colors.textInverse} />
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerGradient: { paddingBottom: 20 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", paddingHorizontal: 20, paddingTop: 16 },
  greeting: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  headerTitle: { fontSize: 30, fontFamily: "Inter_700Bold", color: Colors.text, letterSpacing: -0.5 },
  statusBadges: { flexDirection: "column", gap: 6, alignItems: "flex-end" },
  badge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10 },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  content: { paddingHorizontal: 20, paddingTop: 4, gap: 12 },
  budgetBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "rgba(255, 214, 10, 0.10)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 214, 10, 0.30)",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  budgetBannerText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.dueSoon,
    lineHeight: 18,
  },

  panelCard: { backgroundColor: Colors.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: Colors.border },
  panelEmpty: { alignItems: "center", paddingVertical: 16, gap: 6 },
  panelEmptyText: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary },

  sectionLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.textTertiary, letterSpacing: 1.5, textTransform: "uppercase" },

  taskList: { gap: 0 },
  taskRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 14 },
  taskRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  taskBar: { width: 4, height: 28, borderRadius: 2, flexShrink: 0 },
  taskInfo: { flex: 1, gap: 2 },
  taskTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.text, lineHeight: 19 },
  taskSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, lineHeight: 17 },
  taskDue: { fontSize: 12, fontFamily: "Inter_500Medium", flexShrink: 0 },

  seeAllRow: { paddingVertical: 12, alignItems: "center" },
  seeAllText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.accent },

  headerSummary: { fontSize: 13, fontFamily: "Inter_400Regular", fontWeight: "300" as const, color: Colors.textTertiary, marginTop: 4 },

  section: { gap: 10 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.text },
  screeningCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: Colors.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: Colors.border },
  screeningBar: { width: 4, height: 28, borderRadius: 2, backgroundColor: Colors.health, flexShrink: 0 },
  screeningContent: { flex: 1, gap: 2 },
  screeningTitle: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.text },
  screeningDesc: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary },

  welcomeWrap: { gap: 16 },
  welcomeBanner: { flexDirection: "row", gap: 14, backgroundColor: Colors.accentLight, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: Colors.accent + "30", alignItems: "flex-start" },
  welcomeIconWrap: { width: 48, height: 48, borderRadius: 14, backgroundColor: Colors.accentMuted, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  welcomeText: { flex: 1, gap: 4 },
  welcomeTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.text },
  welcomeBody: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, lineHeight: 20 },
  emptyCardsRow: { flexDirection: "row", gap: 10 },
  emptyCard: {
    flex: 1,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderRadius: 16,
    padding: 14,
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.card,
    minHeight: 160,
    justifyContent: "center",
  },
  emptyCardIcon: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  emptyCardLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.text, textAlign: "center" },
  emptyCardDesc: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textTertiary, textAlign: "center", lineHeight: 15 },
  emptyCardBtn: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center", marginTop: 2 },

  qmCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  qmCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
  },
  qmCardHeaderStatic: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
  },
  qmIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.accentMuted,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  qmCardTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
    lineHeight: 19,
  },
  qmCardSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    lineHeight: 16,
    marginTop: 1,
  },
  qmVehicleList: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  qmVehicleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  qmVehicleRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  qmVehicleInfo: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  qmVehicleName: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.text,
    lineHeight: 17,
  },
  qmVehicleAge: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    lineHeight: 15,
  },
  qmInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    flexShrink: 0,
  },
  qmInput: {
    width: 82,
    height: 34,
    backgroundColor: Colors.surface,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 9,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.text,
    textAlign: "right",
  },
  qmSaveBtn: {
    height: 34,
    paddingHorizontal: 13,
    borderRadius: 9,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 52,
  },
  qmSaveBtnText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  qmError: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: Colors.overdue,
    lineHeight: 14,
  },

  sheetOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheetKAV: {
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 20,
  },
  sheetHandleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: "center",
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sheetIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: Colors.accentMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetTitle: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  sheetCloseBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetTextInput: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
    minHeight: 96,
    textAlignVertical: "top",
  },
  sheetProcessBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: Colors.accent,
    borderRadius: 12,
    height: 46,
  },
  sheetProcessBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  sheetProcessing: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 24,
  },
  sheetProcessingText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },
  sheetErrorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: Colors.dueSoonMuted,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(255,193,0,0.25)",
  },
  sheetErrorText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.dueSoon,
    lineHeight: 18,
  },

  confirmCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    gap: 12,
    marginBottom: 10,
  },
  confirmCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  confirmCatIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  confirmAssetName: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  confirmLowBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.dueSoonMuted,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
  },
  confirmLowBadgeText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dueSoon,
  },
  confirmFields: {
    gap: 8,
  },
  confirmActions: {
    flexDirection: "row",
    gap: 10,
    paddingTop: 2,
  },
  confirmDiscardBtn: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  confirmDiscardText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },
  confirmSaveBtn: {
    flex: 2,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.accent,
  },
  confirmSaveBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  confirmCardError: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.overdue,
  },

  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 36,
  },
  fieldLabel: {
    width: 66,
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
    flexShrink: 0,
  },
  fieldInputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 9,
    height: 36,
  },
  fieldInput: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
    height: 36,
  },
  fieldAffix: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textTertiary,
    flexShrink: 0,
  },

  scoreCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
  },
  scoreTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.text },
  scoreMessage: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  scoreDetail: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary },

  spendingTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  spendingThisMonth: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  spendingAmount: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.text },
  spendingEmpty: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textTertiary, textAlign: "center", paddingVertical: 12 },
  spendingBars: { gap: 8 },
  spendingBarRow: { gap: 3 },
  spendingBarTrack: { height: 24, backgroundColor: Colors.borderSubtle, borderRadius: 4, overflow: "hidden" },
  spendingBarFill: { height: 24, backgroundColor: Colors.accent, borderRadius: 4 },
  spendingBarLabel: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.textTertiary },

  catCard: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    alignItems: "center",
  },

  quickActionsRow: { flexDirection: "row", gap: 8 },
  quickActionBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 12,
  },
  quickActionLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
});
