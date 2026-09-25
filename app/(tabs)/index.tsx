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
  Alert,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import { usePulse, S, Row, Col } from "@/components/Skeleton";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import type { Href } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Colors } from "@/constants/colors";
import { Icon } from "@/components/ui/Icon";
import { Section } from "@/components/ui/Section";
import { Row as UiRow } from "@/components/ui/Row";
import { Typography } from "@/constants/typography";
import { Radius } from "@/constants/radius";
import { Spacing } from "@/constants/spacing";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { LinearGradient } from "expo-linear-gradient";
import { differenceInDays, parseISO, isBefore, addDays, format, subMonths, startOfMonth } from "date-fns";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { primeHaptics } from "@/lib/haptics";
import { vehicleTaskCalibrationState, propertyTaskCalibrationState } from "@/lib/calibration";
import { useBudgetAlert } from "@/context/BudgetAlertContext";
import TrialBanner from "@/components/TrialBanner";
import { currentUsageValue, projectedMileage, projectedHours, resolveTrackingMode, calcVehicleTaskStatus, isHoursTrackedMode, isMileageTrackedMode, isHoursTracked, isTimeOnly, taskDaysUntilDue } from "@/lib/usageHelpers";
import * as Linking from "expo-linking";
import { LogSheet } from "@/components/LogSheet";
import { SaveToast } from "@/components/SaveToast";
import Tooltip, { TOOLTIP_IDS } from "@/components/Tooltip";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const SCREENING_NOTIF_KEY = "screening_notif_optins";

const VEHICLE_DISMISS_KEY = "@yma_crosssell_dismissed_vehicle_only";
const PROPERTY_DISMISS_KEY = "@yma_crosssell_dismissed_property_only";
const HEALTH_DISMISS_KEY = "@yma_crosssell_dismissed_health_only";

const CAT = {
  vehicles: { color: Colors.vehicle, muted: Colors.vehicleMuted, icon: "car" as const, label: "Vehicles", desc: "Cars, trucks, motorcycles & more", addRoute: "/add-vehicle" as any, tab: "/(tabs)/vehicles" as any },
  properties: { color: Colors.home, muted: Colors.homeMuted, icon: "home" as const, label: "Properties", desc: "Home, HVAC, roof & appliances", addRoute: "/add-property" as any, tab: "/(tabs)/home-tab" as any },
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
  hours: number | null;
  vehicle_type: string | null;
  tracking_mode: string | null;
  updated_at: string | null;
  average_miles_per_month: number | null;
  last_mileage_update: string | null;
  last_hours_update: string | null;
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

type MonthAheadItem = DashboardItem & { daysUntil: number };

function verticalCount(items: DashboardItem[]): number {
  return new Set(items.map(item => item.category)).size;
}

function possessiveName(label: string): string {
  const clean = label.trim() || "item";
  return clean.endsWith("s") ? `${clean}'` : `${clean}'s`;
}

interface JoinedVehicle {
  make: string | null;
  model: string | null;
  nickname: string | null;
  mileage: number | null;
  hours: number | null;
  tracking_mode: string | null;
  vehicle_type: string | null;
  average_miles_per_month: number | null;
  last_mileage_update: string | null;
  last_hours_update: string | null;
}

interface JoinedProperty {
  address: string | null;
  nickname: string | null;
}

function formatDaysUntil(d: number): string {
  if (d < 0) return `${Math.abs(d)}d overdue`;
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  return `${d}d`;
}

function monthAheadPhrase(item: MonthAheadItem): string {
  const subject = item.category === "health" ? item.subtitle : possessiveName(item.subtitle);
  const timing = item.daysUntil < 0
    ? `${Math.abs(item.daysUntil)}d overdue`
    : item.daysUntil === 0
      ? "today"
      : item.daysUntil === 1
        ? "tomorrow"
        : `in ${item.daysUntil} days`;
  return `${subject} ${item.title} is ${timing}`;
}

function joinNatural(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function categoryLabel(category: DashboardItem["category"]): string {
  if (category === "vehicles") return "Vehicle";
  if (category === "properties") return "Properties";
  return "Health";
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
      if (raw) {
        try { setScreeningOptIns(JSON.parse(raw)); } catch {}
      }
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
    const next = { ...screeningOptIns, [title]: !screeningOptIns[title] };
    setScreeningOptIns(next);
    await AsyncStorage.setItem(SCREENING_NOTIF_KEY, JSON.stringify(next));
    Haptics.selectionAsync();
  }

  const { data: counts, isLoading: countsLoading, isError: isCountsError, isFetching: isCountsFetching, fetchStatus: countsFetchStatus, refetch: refetchCounts } = useQuery({
    queryKey: ["dashboard_counts", user?.id],
    queryFn: async () => {
      if (!user) return { vehicles: 0, properties: 0, health: 0 };
      const [veh, prop, health] = await Promise.all([
        supabase.from("vehicles").select("id", { count: "exact", head: true }).eq("user_id", user.id),
        supabase.from("properties").select("id", { count: "exact", head: true }).eq("user_id", user.id),
        supabase.from("health_appointments").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("retired_at", null),
      ]);
      if (veh.error) throw veh.error;
      if (prop.error) throw prop.error;
      if (health.error) throw health.error;
      // Health vertical includes family members + medications + appointments.
      // Counting only appointments under-represents Health users in the dashboard
      // header and incorrectly classifies users who added family or medications
      // as new-user (isNewUser = WelcomeView).
      const [fam, meds] = await Promise.all([
        supabase.from("family_members").select("id", { count: "exact", head: true }).eq("user_id", user.id),
        supabase.from("medications").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      ]);
      if (fam.error) throw fam.error;
      if (meds.error) throw meds.error;
      return {
        vehicles: veh.count ?? 0,
        properties: prop.count ?? 0,
        health: (health.count ?? 0) + (fam.count ?? 0) + (meds.count ?? 0),
      };
    },
    enabled: !!user,
  });

  const { data: dashboardItems, isLoading: dashLoading, isError: isDashError, isFetching: isDashFetching, fetchStatus: dashFetchStatus, refetch: refetchDash } = useQuery({
    queryKey: ["dashboard", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const items: DashboardItem[] = [];
      const [vehicleTasks, propertyTasks, healthAppts] = await Promise.all([
        supabase.from("user_vehicle_maintenance_tasks").select("*, vehicles(make, model, nickname, mileage, hours, tracking_mode, vehicle_type, average_miles_per_month, last_mileage_update, last_hours_update)").eq("user_id", user.id),
        supabase.from("property_maintenance_tasks").select("*, properties!inner(address, nickname)").eq("properties.user_id", user.id),
        supabase.from("health_appointments").select("*").eq("user_id", user.id).is("retired_at", null),
      ]);
      if (vehicleTasks.error) throw vehicleTasks.error;
      if (propertyTasks.error) throw propertyTasks.error;
      if (healthAppts.error) throw healthAppts.error;
      for (const t of vehicleTasks.data ?? []) {
        const v = (t as any).vehicles;
        if (!v) continue;
        const mode = resolveTrackingMode(v);
        const usageStatus = calcVehicleTaskStatus(t, v, mode);
        if (usageStatus !== "overdue" && usageStatus !== "due_soon") continue;
        const status: DashboardItem["status"] = usageStatus;
        items.push({
          id: t.id,
          title: t.name,
          subtitle: v.nickname ?? `${v.make} ${v.model}`,
          dueDate: t.next_due_date,
          status,
          category: "vehicles",
          entityId: t.vehicle_id,
        });
      }
      for (const t of propertyTasks.data ?? []) {
        const p = (t as any).properties;
        if (!p) continue;
        if (propertyTaskCalibrationState(t) === "estimated") continue;
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

  const { data: monthAheadItems, isLoading: monthLoading, isError: isMonthError, isFetching: isMonthFetching, fetchStatus: monthFetchStatus, refetch: refetchMonthAhead } = useQuery({
    queryKey: ["dashboard", user?.id, "month_ahead"],
    queryFn: async (): Promise<MonthAheadItem[]> => {
      if (!user) return [];
      const out: MonthAheadItem[] = [];
      const [vehicleTasks, propertyTasks, healthAppts] = await Promise.all([
        supabase.from("user_vehicle_maintenance_tasks").select("*, vehicles(make, model, nickname, mileage, hours, tracking_mode, vehicle_type, average_miles_per_month, last_mileage_update, last_hours_update)").eq("user_id", user.id),
        supabase.from("property_maintenance_tasks").select("*, properties!inner(address, nickname)").eq("properties.user_id", user.id),
        supabase.from("health_appointments").select("*").eq("user_id", user.id).is("retired_at", null),
      ]);
      if (vehicleTasks.error) throw vehicleTasks.error;
      if (propertyTasks.error) throw propertyTasks.error;
      if (healthAppts.error) throw healthAppts.error;

      const push = (
        id: string, title: string, subtitle: string, dueDate: string | null,
        daysUntil: number | null, category: DashboardItem["category"], entityId: string,
      ) => {
        if (daysUntil == null || daysUntil > 30) return;
        const status: DashboardItem["status"] = daysUntil < 0 ? "overdue" : "due_soon";
        out.push({ id, title, subtitle, dueDate, status, category, entityId, daysUntil });
      };

      for (const t of vehicleTasks.data ?? []) {
        if (t.status === "completed") continue;
        if (vehicleTaskCalibrationState(t) === "estimated") continue;
        const v = (t as { vehicles: JoinedVehicle | null }).vehicles;
        if (!v) continue;
        const days = taskDaysUntilDue(t, v);
        push(t.id, t.name, v.nickname ?? `${v.make} ${v.model}`, t.next_due_date, days, "vehicles", t.vehicle_id);
      }
      for (const t of propertyTasks.data ?? []) {
        if (t.is_completed) continue;
        if (propertyTaskCalibrationState(t) === "estimated") continue;
        const p = (t as { properties: JoinedProperty | null }).properties;
        if (!p) continue;
        const days = taskDaysUntilDue(t, null);
        push(t.id, t.task, p.nickname ?? p.address ?? "Property", t.next_due_date, days, "properties", t.property_id);
      }
      for (const a of healthAppts.data ?? []) {
        if (a.is_completed) continue;
        const days = taskDaysUntilDue(a, null);
        push(a.id, a.appointment_type, a.provider_name ?? "Health", a.next_due_date, days, "health", a.id);
      }

      return out.sort((x, y) => x.daysUntil - y.daysUntil || x.title.localeCompare(y.title));
    },
    enabled: !!user,
  });

  const { data: spending, isError: isSpendingError, isFetching: isSpendingFetching, refetch: refetchSpending } = useQuery({
    queryKey: ["dashboard_spending", user?.id],
    queryFn: async () => {
      if (!user) return {};
      const { data: veh, error: vehErr } = await supabase.from("vehicles").select("id").eq("user_id", user.id);
      if (vehErr) throw vehErr;
      if (!veh || veh.length === 0) return {};
      const ids = veh.map(v => v.id);
      const sixMonthsAgo = startOfMonth(subMonths(new Date(), 5)).toISOString().split("T")[0];
      const { data: logs, error: logsErr } = await supabase
        .from("maintenance_logs")
        .select("service_date, cost")
        .in("vehicle_id", ids)
        .gte("service_date", sixMonthsAgo)
        .not("cost", "is", null);
      if (logsErr) throw logsErr;
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

  const { data: mileageVehicles, isError: isMileageError, isFetching: isMileageFetching, refetch: refetchMileage } = useQuery({
    queryKey: ["mileage_vehicles", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, year, make, model, nickname, mileage, hours, vehicle_type, tracking_mode, updated_at, average_miles_per_month, last_mileage_update, last_hours_update")
        .eq("user_id", user.id);
      if (error) throw error;
      const rows = (data ?? []) as MileageVehicle[];
      return rows.filter(v => !isTimeOnly(v));
    },
    enabled: !!user,
  });

  const { data: healthProfile, isError: isHealthProfileError, isFetching: isHealthProfileFetching, refetch: refetchHealthProfile } = useQuery({
    queryKey: ["health_profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase.from("health_profiles").select("*").eq("user_id", user.id).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: familyMembers, isError: isFamilyMembersError, isFetching: isFamilyMembersFetching, refetch: refetchFamilyMembers } = useQuery({
    queryKey: ["family_members_count", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase.from("family_members").select("id").eq("user_id", user.id);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: totalTasksData, isError: isTotalTasksError, isFetching: isTotalTasksFetching, refetch: refetchTotalTasks } = useQuery({
    queryKey: ["total_tasks_count", user?.id],
    queryFn: async () => {
      if (!user) return 0;
      const [veh, prop, health] = await Promise.all([
        supabase.from("user_vehicle_maintenance_tasks").select("vehicles!inner(user_id)", { count: "exact", head: true }).eq("vehicles.user_id", user.id),
        supabase.from("property_maintenance_tasks").select("properties!inner(user_id)", { count: "exact", head: true }).eq("properties.user_id", user.id),
        supabase.from("health_appointments").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("retired_at", null),
      ]);
      if (veh.error) throw veh.error;
      if (prop.error) throw prop.error;
      if (health.error) throw health.error;
      return (veh.count ?? 0) + (prop.count ?? 0) + (health.count ?? 0);
    },
    enabled: !!user,
  });

  const { data: primaryAssetName } = useQuery({
    queryKey: ["primary_asset_name", user?.id, counts?.vehicles, counts?.properties, counts?.health],
    queryFn: async () => {
      if (!user || !counts) return null;
      const onlyVehicle = counts.vehicles > 0 && counts.properties === 0 && counts.health === 0;
      const onlyProperty = counts.properties > 0 && counts.vehicles === 0 && counts.health === 0;
      if (onlyVehicle) {
        const { data, error } = await supabase.from("vehicles").select("nickname, year, make, model").eq("user_id", user.id).limit(1).maybeSingle();
        if (error) throw error;
        if (!data) return null;
        const vehicleName = [data.year, data.make, data.model].filter(Boolean).join(" ");
        return data.nickname ?? (vehicleName.length > 0 ? vehicleName : null);
      }
      if (onlyProperty) {
        const { data, error } = await supabase.from("properties").select("nickname, address").eq("user_id", user.id).limit(1).maybeSingle();
        if (error) throw error;
        if (!data) return null;
        return data.nickname ?? data.address ?? null;
      }
      return null;
    },
    enabled: !!user && !!counts,
  });

  function refetch() {
    refetchCounts();
    refetchDash();
    refetchMonthAhead();
    refetchSpending();
    refetchMileage();
    refetchHealthProfile();
    refetchFamilyMembers();
    refetchTotalTasks();
  }

  const isOfflineNoData =
    (counts == null && countsFetchStatus === "paused") ||
    (dashboardItems == null && dashFetchStatus === "paused") ||
    (monthAheadItems == null && monthFetchStatus === "paused");
  const isLoading = !isOfflineNoData && (countsLoading || dashLoading || monthLoading);

  const hasDashboardError =
    !isLoading &&
    (isMonthError ||
      isCountsError ||
      isDashError ||
      isSpendingError ||
      isMileageError ||
      isHealthProfileError ||
      isFamilyMembersError ||
      isTotalTasksError);

  const isRetrying =
    isCountsFetching ||
    isDashFetching ||
    isMonthFetching ||
    isSpendingFetching ||
    isMileageFetching ||
    isHealthProfileFetching ||
    isFamilyMembersFetching ||
    isTotalTasksFetching;

  const isNewUser = !isLoading && !hasDashboardError && counts != null && counts.vehicles === 0 && counts.properties === 0 && counts.health === 0;
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
                <View style={[styles.badge, { backgroundColor: Colors.card }]}>
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
        ) : (hasDashboardError || isOfflineNoData) ? (
          <View style={styles.dashboardErrorCard}>
            <View style={styles.dashboardErrorIcon}>
              <Icon name="cloud-offline-outline" size={28} color={Colors.overdue} />
            </View>
            <Text style={styles.dashboardErrorTitle}>We couldn’t refresh your dashboard</Text>
            <Text style={styles.dashboardErrorBody}>
              Your saved vehicles, properties, and health items are still safe. Try again when your connection looks steady.
            </Text>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                refetch();
              }}
              disabled={isRetrying}
              style={({ pressed }) => [
                styles.dashboardErrorBtn,
                { opacity: isRetrying ? 0.5 : pressed ? 0.85 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={isRetrying ? "Retrying dashboard" : "Try loading dashboard again"}
            >
              {isRetrying ? (
                <ActivityIndicator size="small" color={Colors.background} />
              ) : (
                <Text style={styles.dashboardErrorBtnText}>Try again</Text>
              )}
            </Pressable>
          </View>
        ) : isNewUser ? (
          <WelcomeView />
        ) : (
          <>
            <Tooltip
              id={TOOLTIP_IDS.DASHBOARD_WELCOME}
              message="This is your command center. Everything that needs attention across vehicles, home, and health shows up here."
              icon="compass-outline"
            />
            <TrialBanner />
            {!budgetDismissed && !!budgetThreshold && budgetThreshold > 0 && monthlyCost > budgetThreshold && (
              <Pressable onPress={dismissBudgetBanner} style={styles.budgetBanner} accessibilityRole="button" accessibilityLabel="Dismiss budget alert">
                <Icon name="warning-outline" size={15} color={Colors.dueSoon} style={{ flexShrink: 0, marginTop: 1 }} />
                <Text style={styles.budgetBannerText} numberOfLines={3}>
                  {"Heads up: $"}{monthlyCost.toFixed(0)}{" estimated in maintenance this month (your alert is set to $"}{budgetThreshold.toFixed(0)}{")"}</Text>
                <Icon name="close" size={14} color={Colors.dueSoon} style={{ flexShrink: 0, marginTop: 1 }} />
              </Pressable>
            )}
            {/* type bridge: this is only undefined pre-load, which the loading skeleton gates; on fetch error the dashboard renders its error card instead of this one, so an empty list never shows on error */}
            <YourMonthAheadCard
              items={monthAheadItems ?? []}
              counts={counts ?? { vehicles: 0, properties: 0, health: 0 }}
              primaryAssetName={primaryAssetName ?? null}
            />

            {totalTasks > 0 && (
              <HealthScoreCard
                score={healthScore}
                overdue={overdueCnt}
                dueSoon={dueSoonCnt}
                onTrack={onTrackCnt}
              />
            )}

            {(mileageVehicles?.length ?? 0) > 0 && (
              <QuickMileageCard vehicles={mileageVehicles!} userId={user!.id} />
            )}

            <UpcomingTasksCard items={upcomingItems} />

            <SpendingChartCard spending={spending} />

            {screenings.length > 0 && (
              <Section title="Health screenings">
                {screenings.slice(0, 3).map((s, i) => (
                  <UiRow
                    key={i}
                    appearIndex={i}
                    title={s.title}
                    subtitle={s.description}
                    onPress={() => router.push("/add-appointment" as any)}
                  />
                ))}
              </Section>
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

type UsageInputsProps = {
  v: MileageVehicle;
  hideName?: boolean;
  inputs: Record<string, string>;
  saving: Record<string, boolean>;
  saved: Record<string, boolean>;
  errors: Record<string, string>;
  setInputs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  handleSave: (v: MileageVehicle, field: "mileage" | "hours") => void;
  fieldKey: (v: MileageVehicle, field: "mileage" | "hours") => string;
  getInput: (v: MileageVehicle, field: "mileage" | "hours") => string;
  isStale: (v: MileageVehicle) => boolean;
};

type UsageInputsBaseProps = Omit<UsageInputsProps, "v" | "hideName">;

function UsageInputRow({
  v, field, label, placeholder, keyboard, mode,
  inputs, saving, saved, errors,
  setInputs, setErrors, handleSave, fieldKey, getInput,
}: {
  v: MileageVehicle;
  field: "mileage" | "hours";
  label: string;
  placeholder: string;
  keyboard: "number-pad" | "decimal-pad";
  mode: ReturnType<typeof resolveTrackingMode>;
} & Omit<UsageInputsBaseProps, "isStale">) {
  const fk = fieldKey(v, field);
  const inputVal = getInput(v, field);
  const isSaving = saving[fk] ?? false;
  const isSaved = saved[fk] ?? false;
  const err = errors[fk];
  return (
    <View style={{ gap: 8 }}>
      {mode === "both" && (
        <Text style={{ ...Typography.caption, fontWeight: "500", color: Colors.textTertiary }}>{label}</Text>
      )}
      <View style={styles.qmInputRow}>
        <TextInput
          style={styles.qmInput}
          value={inputVal}
          onChangeText={t => {
            setInputs(i => ({ ...i, [fk]: t }));
            if (errors[fk]) setErrors(e => ({ ...e, [fk]: "" }));
          }}
          keyboardType={keyboard}
          returnKeyType="done"
          onSubmitEditing={() => handleSave(v, field)}
          selectTextOnFocus
          placeholder={placeholder}
          placeholderTextColor={Colors.textTertiary}
        />
        <Pressable
          style={[styles.qmSaveBtn, isSaved && { backgroundColor: Colors.good }]}
          onPress={() => { if (!isSaving && !isSaved) handleSave(v, field); }}
          disabled={isSaving}
        >
          {isSaved ? (
            <Icon name="checkmark" size={14} color={Colors.white} />
          ) : isSaving ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <Text style={styles.qmSaveBtnText}>Save</Text>
          )}
        </Pressable>
      </View>
      {!!err && <Text style={styles.qmError}>{err}</Text>}
    </View>
  );
}

function UsageInputs({
  v, hideName, inputs, saving, saved, errors,
  setInputs, setErrors, handleSave, fieldKey, getInput, isStale,
}: UsageInputsProps) {
  const mode = resolveTrackingMode(v);
  const vehicleName = v.nickname ?? [v.year, v.make, v.model].filter(Boolean).join(" ");
  const stale = isStale(v);

  const estNow = mode === "both" ? null : currentUsageValue(v);
  const mileagePh = (projectedMileage(v) ?? v.mileage)?.toLocaleString() ?? "miles";
  const hoursPh = (projectedHours(v) ?? v.hours)?.toLocaleString() ?? "hours";
  const nameBlock = !hideName && (
    <View style={styles.qmVehicleInfo}>
      <Text style={styles.qmVehicleName} numberOfLines={1}>{vehicleName}</Text>
      <Text style={[styles.qmVehicleAge, { color: stale ? Colors.dueSoon : Colors.good }]} numberOfLines={1}>
        {formatMileageAge(v.updated_at)}{estNow != null ? ` · Est. ${estNow.toLocaleString()} ${isHoursTracked(v) ? "hrs" : "mi"}` : ""}
      </Text>
    </View>
  );

  const rowProps = {
    v, inputs, saving, saved, errors,
    setInputs, setErrors, handleSave, fieldKey, getInput, mode,
  };

  if (mode === "hours") {
    return (
      <View style={styles.qmVehicleRow}>
        {nameBlock}
        <UsageInputRow {...rowProps} field="hours" label="Hours" placeholder={hoursPh} keyboard="decimal-pad" />
      </View>
    );
  }
  if (mode === "mileage") {
    return (
      <View style={styles.qmVehicleRow}>
        {nameBlock}
        <UsageInputRow {...rowProps} field="mileage" label="Mileage" placeholder={mileagePh} keyboard="number-pad" />
      </View>
    );
  }
  return (
    <View style={[styles.qmVehicleRow, { flexDirection: "column", alignItems: "stretch" }]}>
      {nameBlock}
      <UsageInputRow {...rowProps} field="mileage" label="Mileage" placeholder={mileagePh} keyboard="number-pad" />
      <UsageInputRow {...rowProps} field="hours" label="Hours" placeholder={hoursPh} keyboard="decimal-pad" />
    </View>
  );
}

function QuickMileageCard({ vehicles, userId }: { vehicles: MileageVehicle[]; userId: string }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

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

  function fieldKey(v: MileageVehicle, field: "mileage" | "hours") {
    const mode = resolveTrackingMode(v);
    return mode === "both" ? `${v.id}:${field}` : v.id;
  }

  function getInput(v: MileageVehicle, field: "mileage" | "hours"): string {
    const k = fieldKey(v, field);
    return inputs[k] ?? "";
  }

  function showUsageSavedToast() {
    if (toastTimerRef.current !== null) {
      clearTimeout(toastTimerRef.current);
    }
    setToastVisible(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    toastTimerRef.current = setTimeout(() => {
      setToastVisible(false);
      toastTimerRef.current = null;
    }, 1800);
  }

  async function handleSave(v: MileageVehicle, field: "mileage" | "hours") {
    const k = fieldKey(v, field);
    const input = getInput(v, field).replace(/,/g, "");
    if (field === "hours") {
      const newH = parseFloat(input);
      if (!input.trim() || isNaN(newH) || newH < 0) {
        setErrors(e => ({ ...e, [k]: "Please enter a valid hours value" }));
        return;
      }
      const currentReading = v.hours ?? 0;
      if (currentReading > 0 && newH < currentReading) {
        setErrors(e => ({ ...e, [k]: "Open Edit Vehicle to correct this reading" }));
        return;
      }
    } else {
      const newM = parseInt(input, 10);
      if (!input.trim() || isNaN(newM) || newM <= 0) {
        setErrors(e => ({ ...e, [k]: "Please enter a valid mileage" }));
        return;
      }
      const currentReading = v.mileage ?? 0;
      if (currentReading > 0 && newM < currentReading) {
        setErrors(e => ({ ...e, [k]: "Open Edit Vehicle to correct this reading" }));
        return;
      }
    }
    setErrors(e => ({ ...e, [k]: "" }));
    setSaving(s => ({ ...s, [k]: true }));
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const now = new Date().toISOString();
      if (field === "hours") {
        const newH = parseFloat(input);
        const { error: updateErr } = await supabase.from("vehicles").update({ hours: newH, last_hours_update: now, updated_at: now }).eq("id", v.id);
        if (updateErr) throw updateErr;
      } else {
        const newM = parseInt(input, 10);
        const { error: updateErr } = await supabase.from("vehicles").update({ mileage: newM, last_mileage_update: now, updated_at: now }).eq("id", v.id);
        if (updateErr) throw updateErr;
        const { error: histErr } = await supabase.from("vehicle_mileage_history").insert({ vehicle_id: v.id, user_id: userId, mileage: newM, recorded_at: now });
        if (histErr) throw histErr;
      }
      setSaved(s => ({ ...s, [k]: true }));
      setInputs(i => ({ ...i, [k]: "" }));
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["mileage_vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["vehicle"] });
      showUsageSavedToast();
      setTimeout(() => {
        setSaved(s => ({ ...s, [k]: false }));
      }, 1500);
    } catch {
      setErrors(e => ({ ...e, [k]: "Couldn't save — try again" }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSaving(s => ({ ...s, [k]: false }));
    }
  }

  const usageProps: UsageInputsBaseProps = {
    inputs, saving, saved, errors,
    setInputs, setErrors, handleSave, fieldKey, getInput, isStale,
  };

  const anyHours = vehicles.some(v => isHoursTrackedMode(resolveTrackingMode(v)));
  const anyMiles = vehicles.some(v => isMileageTrackedMode(resolveTrackingMode(v)));
  const cardTitle = anyHours && !anyMiles ? "Engine hours" : anyMiles && !anyHours ? "Mileage" : "Usage";

  if (vehicles.length === 1) {
    const v = vehicles[0];
    const vehicleName = v.nickname ?? [v.year, v.make, v.model].filter(Boolean).join(" ");
    const estNow = resolveTrackingMode(v) === "both" ? null : currentUsageValue(v);
    return (
      <>
        <View style={styles.qmCard}>
          <View style={styles.qmCardHeaderStatic}>
            <View style={{ flex: 1 }}>
              <Text style={styles.qmCardTitle}>{vehicleName}</Text>
              <Text style={styles.qmCardSub}>{resolveTrackingMode(v) === "both" ? "Update mileage & hours" : isHoursTracked(v) ? "Update hours" : "Update mileage"}{estNow != null ? ` · Est. now ${estNow.toLocaleString()} ${isHoursTracked(v) ? "hrs" : "mi"}` : ""}</Text>
            </View>
          </View>
          <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
            <UsageInputs {...usageProps} v={v} hideName />
          </View>
        </View>
        <SaveToast visible={toastVisible} message="Usage updated" />
      </>
    );
  }

  return (
    <>
      <View style={styles.qmCard}>
        <Pressable
          style={styles.qmCardHeader}
        onPress={() => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setExpanded(e => !e);
          primeHaptics();
        }}
        accessibilityRole="button"
        accessibilityLabel={expanded ? "Collapse usage updater" : "Expand usage updater"}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.qmCardTitle}>{cardTitle}</Text>
          <Text style={[styles.qmCardSub, { color: allUpToDate ? Colors.good : Colors.dueSoon }]}>
            {allUpToDate
              ? "All up to date"
              : `${staleCount} vehicle${staleCount !== 1 ? "s" : ""} need updating`}
          </Text>
        </View>
        <Icon
          name={expanded ? "chevron-up" : "chevron-down"}
          size={16}
          color={Colors.textTertiary}
        />
      </Pressable>

      {expanded && (
        <View style={styles.qmVehicleList}>
          {sortedVehicles.map((v, idx) => (
            <View key={v.id} style={idx < sortedVehicles.length - 1 ? styles.qmVehicleRowBorder : undefined}>
              <UsageInputs {...usageProps} v={v} />
            </View>
          ))}
        </View>
      )}
      </View>
      <SaveToast visible={toastVisible} message="Usage updated" />
    </>
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
        <View style={[styles.panelCard, { flex: 5, gap: 12 }]}>
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

        <View style={[styles.panelCard, { flex: 3, gap: 8 }]}>
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

function YourMonthAheadCard({
  items,
  counts,
  primaryAssetName,
}: {
  items: MonthAheadItem[];
  counts: { vehicles: number; properties: number; health: number };
  primaryAssetName: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  const onlyVehicle = counts.vehicles > 0 && counts.properties === 0 && counts.health === 0;
  const onlyProperty = counts.properties > 0 && counts.vehicles === 0 && counts.health === 0;
  const onlyHealth = counts.health > 0 && counts.vehicles === 0 && counts.properties === 0;
  const singleVerticalActive = onlyVehicle || onlyProperty || onlyHealth;

  const dismissKey = onlyVehicle
    ? VEHICLE_DISMISS_KEY
    : onlyProperty
      ? PROPERTY_DISMISS_KEY
      : onlyHealth
        ? HEALTH_DISMISS_KEY
        : null;

  useEffect(() => {
    if (!singleVerticalActive || !dismissKey) {
      setDismissed(null);
      return;
    }
    let cancelled = false;
    AsyncStorage.getItem(dismissKey)
      .then(val => {
        if (!cancelled) setDismissed(val === "true");
      })
      .catch(() => {
        if (!cancelled) setDismissed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [singleVerticalActive, dismissKey]);

  const heroItems = items.slice(0, 3);
  const detailItems = items.slice(0, 6);
  const categories = verticalCount(items);

  const hasAnyTracked = counts.vehicles > 0 || counts.properties > 0 || counts.health > 0;
  const hasMultipleVerticalsTracked =
    (counts.vehicles > 0 ? 1 : 0) +
      (counts.properties > 0 ? 1 : 0) +
      (counts.health > 0 ? 1 : 0) >= 2;

  const isMultiVertical = hasMultipleVerticalsTracked && items.length >= 1;

  // Hero is always present once the user has tracked anything. Three render branches below:
  // (1) multi-vertical with due items → narrative summary
  // (2) single-vertical → vertical-specific narrative (existing)
  // (3) all-clear → calm "Nothing due this month" state with cross-sell
  if (!hasAnyTracked) return null;

  function handlePress(item?: MonthAheadItem) {
    if (!item) {
      setExpanded(value => !value);
      Haptics.selectionAsync();
      return;
    }
    if (item.category === "vehicles") {
      const href: Href = `/vehicle/${item.entityId}` as Href;
      router.push(href);
    } else if (item.category === "properties") {
      const href: Href = `/property/${item.entityId}` as Href;
      router.push(href);
    } else {
      const href: Href = `/(tabs)/health` as Href;
      router.push(href);
    }
    Haptics.selectionAsync();
  }

  if (isMultiVertical) {
    const narrative = `This month: ${joinNatural(heroItems.map(monthAheadPhrase))}.`;
    return (
      <Pressable
        style={({ pressed }) => [styles.monthAheadCard, { opacity: pressed ? 0.92 : 1 }]}
        onPress={() => handlePress()}
        accessibilityRole="button"
        accessibilityLabel="Show this month ahead"
      >
        <View style={styles.monthAheadTopRow}>
          <View style={styles.monthAheadIconStack}>
            <View style={[styles.monthAheadIcon, { backgroundColor: Colors.card, marginRight: -8 }]}>
              <Icon name={CAT.vehicles.icon} size={15} color={Colors.textSecondary} />
            </View>
            <View style={[styles.monthAheadIcon, { backgroundColor: Colors.card, marginRight: -8 }]}>
              <Icon name={CAT.properties.icon} size={15} color={Colors.textSecondary} />
            </View>
            <View style={[styles.monthAheadIcon, { backgroundColor: Colors.card }]}>
              <Icon name={CAT.health.icon} size={15} color={Colors.textSecondary} />
            </View>
          </View>
          <Text style={styles.monthAheadEyebrow}>YOUR MONTH AHEAD</Text>
          <Icon name={expanded ? "chevron-up" : "chevron-down"} size={18} color={Colors.textTertiary} />
        </View>

        <Text style={styles.monthAheadTitle}>Everything coming up, in one place</Text>
        <Text style={styles.monthAheadNarrative}>{narrative}</Text>

        <View style={styles.monthAheadMetaRow}>
          <Text style={styles.monthAheadMeta}>{items.length} item{items.length !== 1 ? "s" : ""}</Text>
          <View style={styles.monthAheadDot} />
          <Text style={styles.monthAheadMeta}>{categories} areas</Text>
        </View>

        {expanded ? (
          <View style={styles.monthAheadDetails}>
            {detailItems.map(item => {
              const cat = CAT[item.category];
              return (
                <Pressable
                  key={`${item.category}-${item.id}`}
                  style={({ pressed }) => [styles.monthAheadDetailRow, { opacity: pressed ? 0.72 : 1 }]}
                  onPress={() => handlePress(item)}
                >
                  <View style={[styles.monthAheadDetailIcon, { backgroundColor: Colors.card }]}>
                    <Icon name={cat.icon} size={14} color={Colors.textSecondary} />
                  </View>
                  <View style={styles.monthAheadDetailText}>
                    <Text style={styles.monthAheadDetailTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.monthAheadDetailSub} numberOfLines={1}>{item.subtitle} · {categoryLabel(item.category)}</Text>
                  </View>
                  <Text style={[styles.monthAheadDue, { color: item.status === "overdue" ? Colors.overdue : Colors.dueSoon }]}>{formatDaysUntil(item.daysUntil)}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </Pressable>
    );
  }

  // All-clear: user tracks 2+ verticals but nothing is due this month.
  // Render a calm hero that confirms status and points to the next action.
  if (hasMultipleVerticalsTracked && items.length === 0) {
    return (
      <View style={styles.monthAheadCard}>
        <View style={styles.monthAheadTopRow}>
          <View style={styles.monthAheadIconStack}>
            <View style={[styles.monthAheadIcon, { backgroundColor: Colors.card, marginRight: -8 }]}>
              <Icon name={CAT.vehicles.icon} size={15} color={Colors.textSecondary} />
            </View>
            <View style={[styles.monthAheadIcon, { backgroundColor: Colors.card, marginRight: -8 }]}>
              <Icon name={CAT.properties.icon} size={15} color={Colors.textSecondary} />
            </View>
            <View style={[styles.monthAheadIcon, { backgroundColor: Colors.card }]}>
              <Icon name={CAT.health.icon} size={15} color={Colors.textSecondary} />
            </View>
          </View>
          <Text style={styles.monthAheadEyebrow}>YOUR MONTH AHEAD</Text>
        </View>
        <Text style={styles.monthAheadTitle}>You&apos;re all caught up</Text>
        <Text style={styles.monthAheadNarrative}>
          Nothing due this month across vehicles, home, or health. We&apos;ll let you know the moment something needs attention.
        </Text>
      </View>
    );
  }

  const activeCategory: "vehicles" | "properties" | "health" = onlyVehicle ? "vehicles" : onlyProperty ? "properties" : "health";
  const verticalItems = items.filter(i => i.category === activeCategory);
  const verticalHero = verticalItems.slice(0, 3);
  const verticalDetails = verticalItems.slice(0, 6);

  const resolvedVehicleName = primaryAssetName ?? verticalHero[0]?.subtitle ?? "vehicle";
  const vehicleDisplayName = resolvedVehicleName === "vehicle" ? "your vehicle" : `your ${resolvedVehicleName}`;
  const propertyDisplayName = primaryAssetName ?? "your home";

  const emptyText = onlyVehicle
    ? `Nothing due this month for ${vehicleDisplayName}.`
    : onlyProperty
      ? `Nothing due this month for ${propertyDisplayName}.`
      : "Nothing due this month in health.";

  const crossSellCopy = onlyVehicle
    ? `Tracking ${vehicleDisplayName} is a strong start. Add your property next so LifeMaintained can plan more of your month.`
    : onlyProperty
      ? "Your home is covered. Add your vehicle next so your month feels easier to see."
      : "Health reminders are in one place. Add your vehicle next to bring more of your maintenance into view.";

  const crossSellRoute = onlyVehicle ? CAT.properties.addRoute : CAT.vehicles.addRoute;
  const crossSellIconName: "home" | "car" = onlyVehicle ? "home" : "car";
  const crossSellIconColor = Colors.textSecondary;
  const crossSellIconBg = Colors.card;

  const activeIconName: "car" | "home" | "heart" = activeCategory === "vehicles" ? "car" : activeCategory === "properties" ? "home" : "heart";
  const activeIconColor = Colors.textSecondary;
  const activeIconBg = Colors.card;

  const narrative = verticalHero.length > 0
    ? `This month: ${joinNatural(verticalHero.map(monthAheadPhrase))}.`
    : emptyText;

  function handleCrossSellPress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDismissed(true);
    if (dismissKey) AsyncStorage.setItem(dismissKey, "true").catch(() => {});
    router.push(crossSellRoute);
  }

  function handleDismissPress() {
    Haptics.selectionAsync();
    setDismissed(true);
    if (dismissKey) AsyncStorage.setItem(dismissKey, "true").catch(() => {});
  }

  return (
    <View style={styles.monthAheadCard}>
      <Pressable
        onPress={() => handlePress()}
        accessibilityRole="button"
        accessibilityLabel="Show this month ahead"
      >
        <View style={styles.monthAheadTopRow}>
          <View style={styles.monthAheadIconStack}>
            <View style={[styles.singleVerticalIcon, { backgroundColor: activeIconBg }]}>
              <Icon name={activeIconName} size={15} color={activeIconColor} />
            </View>
          </View>
          <Text style={styles.monthAheadEyebrow}>YOUR MONTH AHEAD</Text>
          <Icon name={expanded ? "chevron-up" : "chevron-down"} size={18} color={Colors.textTertiary} />
        </View>

        <Text style={styles.monthAheadTitle}>Everything coming up</Text>
        <Text style={styles.monthAheadNarrative}>{narrative}</Text>

        {verticalItems.length > 0 && (
          <View style={styles.monthAheadMetaRow}>
            <Text style={styles.monthAheadMeta}>{verticalItems.length} item{verticalItems.length !== 1 ? "s" : ""}</Text>
          </View>
        )}

        {expanded && verticalDetails.length > 0 ? (
          <View style={styles.monthAheadDetails}>
            {verticalDetails.map(item => {
              const cat = CAT[item.category];
              return (
                <Pressable
                  key={`${item.category}-${item.id}`}
                  style={({ pressed }) => [styles.monthAheadDetailRow, { opacity: pressed ? 0.72 : 1 }]}
                  onPress={() => handlePress(item)}
                >
                  <View style={[styles.monthAheadDetailIcon, { backgroundColor: Colors.card }]}>
                    <Icon name={cat.icon} size={14} color={Colors.textSecondary} />
                  </View>
                  <View style={styles.monthAheadDetailText}>
                    <Text style={styles.monthAheadDetailTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.monthAheadDetailSub} numberOfLines={1}>{item.subtitle} · {categoryLabel(item.category)}</Text>
                  </View>
                  <Text style={[styles.monthAheadDue, { color: item.status === "overdue" ? Colors.overdue : Colors.dueSoon }]}>{formatDaysUntil(item.daysUntil)}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </Pressable>

      {dismissed === false && (
        <View>
          <View style={styles.crossSellDivider} />
          <Pressable
            style={({ pressed }) => [styles.crossSellRow, { opacity: pressed ? 0.72 : 1 }]}
            onPress={handleCrossSellPress}
            accessibilityRole="button"
            accessibilityLabel="Add next vertical"
          >
            <View style={[styles.crossSellIcon, { backgroundColor: crossSellIconBg }]}>
              <Icon name={crossSellIconName} size={15} color={crossSellIconColor} />
            </View>
            <Text style={styles.crossSellText}>{crossSellCopy}</Text>
            <Icon name="chevron-forward" size={16} color={Colors.textTertiary} />
          </Pressable>
          <Pressable
            style={styles.crossSellDismiss}
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            onPress={handleDismissPress}
            accessibilityRole="button"
            accessibilityLabel="Dismiss cross-sell"
          >
            <Icon name="close" size={16} color={Colors.textTertiary} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

function UpcomingTasksCard({ items }: { items: DashboardItem[] }) {
  function handlePress(item: DashboardItem) {
    if (item.category === "vehicles") router.push(`/vehicle/${item.entityId}` as any);
    else if (item.category === "properties") router.push(`/property/${item.entityId}` as any);
    else router.push("/(tabs)/health");
    Haptics.selectionAsync();
  }

  if (items.length === 0) return null;

  const visibleItems = items.slice(0, 4);
  const hasMore = items.length > 4;
  const firstNavItem = items.find(i => i.category === "vehicles" || i.category === "properties");
  const seeAllRoute: any = firstNavItem?.category === "vehicles" ? "/(tabs)/vehicles" : "/(tabs)/home-tab";

  return (
    <Section title="Needs attention">
        {visibleItems.map((item, idx) => {
          const statusColor = item.status === "overdue" ? Colors.overdue : Colors.dueSoon;
          return (
            <UiRow
              key={item.id}
              appearIndex={idx}
              title={item.title}
              subtitle={item.subtitle}
              chevron={false}
              onPress={() => handlePress(item)}
              trailing={
                <View style={styles.taskTrailing}>
                  <Text style={[styles.taskDue, { color: statusColor }]}>{formatDueDate(item.dueDate)}</Text>
                </View>
              }
              style={{ borderLeftWidth: 4, borderLeftColor: statusColor }}
            />
          );
        })}
        {hasMore && (
          <Pressable
            style={({ pressed }) => [styles.seeAllRow, { opacity: pressed ? 0.7 : 1 }]}
            onPress={() => { router.push(seeAllRoute); Haptics.selectionAsync(); }}
          >
            <Text style={styles.seeAllText}>{"See all "}{items.length}{" items →"}</Text>
          </Pressable>
        )}
    </Section>
  );
}

function HealthScoreCard({ score, overdue, dueSoon, onTrack }: { score: number; overdue: number; dueSoon: number; onTrack: number }) {
  const scoreColor = score >= 80 ? Colors.good : score >= 50 ? Colors.dueSoon : Colors.overdue;
  const r = 40;
  const cx = 48;
  const cy = 48;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - score / 100);
  const message =
    score >= 90 ? "Everything is on track" :
    score >= 70 ? "A few items need attention" :
    score >= 50 ? "Several items are overdue" :
    "Maintenance is falling behind";

  return (
    <View style={styles.scoreHero}>
      <View style={{ width: 96, height: 96 }}>
        <Svg width={96} height={96} style={{ transform: [{ rotate: "-90deg" }] }}>
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
          <Text style={{ ...Typography.largeTitle, color: scoreColor }}>
            {score}<Text style={{ ...Typography.footnote }}>%</Text>
          </Text>
        </View>
      </View>
      <Text style={styles.scoreTitle}>Maintenance Score</Text>
      <Text style={styles.scoreMessage}>{message}</Text>
      {score === 100 && (
        <Text style={{ ...Typography.footnote, fontWeight: "500", color: Colors.good, marginTop: 2 }}>
          You&apos;re all caught up!
        </Text>
      )}
      <Text style={styles.scoreDetail}>{score === 100 ? `${onTrack} on track` : [`${onTrack} on track`, dueSoon > 0 ? `${dueSoon} due soon` : null, overdue > 0 ? `${overdue} overdue` : null].filter(Boolean).join(" · ")}</Text>
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
  const activeMonths = months.filter((_, i) => amounts[i] > 0);
  const activeAmounts = amounts.filter(a => a > 0);

  return (
    <View style={{ gap: 8 }}>
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
            {activeMonths.map((m, i) => {
              const amount = activeAmounts[i];
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
    </View>
  );
}


function WelcomeView() {
  const cards = [
    {
      key: "vehicles" as const,
      icon: "car" as const,
      route: "/add-vehicle" as Href,
      color: Colors.vehicle,
      muted: Colors.vehicleMuted,
      title: "Start with your vehicle",
      body: "Never forget an oil change again. Takes 30 seconds to set up.",
      chips: ["Oil", "Tires", "Battery"],
    },
    {
      key: "properties" as const,
      icon: "home" as const,
      route: "/add-property" as Href,
      color: Colors.home,
      muted: Colors.homeMuted,
      title: "Add your property",
      body: "Your house runs on a schedule. We'll tell you what it is.",
      chips: ["HVAC", "Filters", "Seasonal"],
    },
    {
      key: "health" as const,
      icon: "heart" as const,
      route: "/add-family-member" as Href,
      color: Colors.health,
      muted: Colors.healthMuted,
      title: "Track family health",
      body: "Annual physicals, pet vet visits, and refills in one place.",
      chips: ["People", "Pets", "Refills"],
    },
  ];

  return (
    <View style={styles.welcomeWrap}>
      <View style={styles.welcomeHero}>
        <View style={styles.welcomeOrbit}>
          {cards.map((card, index) => {
            const orbitOffset = [styles.welcomeOrbitIcon0, styles.welcomeOrbitIcon1, styles.welcomeOrbitIcon2][index];
            return (
              <View key={card.key} style={[styles.welcomeOrbitIcon, orbitOffset, { backgroundColor: Colors.card }]}>
                <Icon name={card.icon} size={18} color={Colors.textSecondary} />
              </View>
            );
          })}
          <View style={styles.welcomeCenterMark}>
            <Icon name="sparkles" size={24} color={Colors.accent} />
          </View>
        </View>
        <Text style={styles.welcomeTitle}>Your maintenance command center</Text>
        <Text style={styles.welcomeBody}>Start with one thing. LifeMaintained connects the schedule across your vehicle, home, and health.</Text>
      </View>

      <View style={styles.emptyCardsStack}>
        {cards.map(card => (
          <Pressable
            key={card.key}
            style={({ pressed }) => [styles.emptyVisionCard, { borderColor: Colors.border, opacity: pressed ? 0.86 : 1 }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(card.route); }}
            accessibilityRole="button"
            accessibilityLabel={card.title}
          >
            <View style={[styles.emptyVisionIcon, { backgroundColor: Colors.card }]}>
              <Icon name={card.icon} size={22} color={Colors.textSecondary} />
            </View>
            <View style={styles.emptyVisionText}>
              <Text style={styles.emptyVisionTitle}>{card.title}</Text>
              <Text style={styles.emptyVisionBody}>{card.body}</Text>
              <View style={styles.emptyVisionChips}>
                {card.chips.map(chip => (
                  <Text key={chip} style={[styles.emptyVisionChip, { color: Colors.textSecondary, backgroundColor: Colors.card }]}>{chip}</Text>
                ))}
              </View>
            </View>
            <Icon name="chevron-forward" size={18} color={Colors.textTertiary} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  monthAheadCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  monthAheadTopRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  monthAheadIconStack: { flexDirection: "row", alignItems: "center" },
  monthAheadIcon: { width: 28, height: 28, borderRadius: Radius.pill, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: Colors.borderSubtle },
  monthAheadEyebrow: { ...Typography.caption, fontWeight: "700", flex: 1, color: Colors.textTertiary },
  monthAheadTitle: { ...Typography.title3, fontWeight: "700", color: Colors.text, marginBottom: 8 },
  monthAheadNarrative: { ...Typography.subheadline, color: Colors.textSecondary },
  monthAheadMetaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16 },
  monthAheadMeta: { ...Typography.caption, fontWeight: "600", color: Colors.textTertiary },
  monthAheadDot: { width: 4, height: 4, borderRadius: Radius.pill, backgroundColor: Colors.textTertiary, opacity: 0.7 },
  monthAheadDetails: { marginTop: 16, borderTopWidth: 1, borderTopColor: Colors.borderSubtle, paddingTop: 8, gap: 2 },
  monthAheadDetailRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  monthAheadDetailIcon: { width: 28, height: 28, borderRadius: Radius.pill, alignItems: "center", justifyContent: "center" },
  monthAheadDetailText: { flex: 1, gap: 1 },
  monthAheadDetailTitle: { ...Typography.footnote, fontWeight: "600", color: Colors.text },
  monthAheadDetailSub: { ...Typography.caption, color: Colors.textTertiary },
  monthAheadDue: { ...Typography.caption, fontWeight: "600", flexShrink: 0 },
  singleVerticalIcon: { width: 28, height: 28, borderRadius: Radius.pill, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: Colors.borderSubtle },
  crossSellDivider: { height: 1, backgroundColor: Colors.borderSubtle, marginTop: 16, marginBottom: 12 },
  crossSellRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4, paddingRight: 40 },
  crossSellIcon: { width: 28, height: 28, borderRadius: Radius.pill, alignItems: "center", justifyContent: "center" },
  crossSellText: { ...Typography.footnote, fontWeight: "500", flex: 1, flexShrink: 1, color: Colors.textSecondary },
  crossSellDismiss: { position: "absolute", top: 12, right: 12, padding: 4, zIndex: 2 },

  dashboardErrorCard: {
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: Radius.xl,
    paddingHorizontal: 24,
    paddingVertical: 32,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
  },
  dashboardErrorIcon: {
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.card,
    marginBottom: 4,
  },
  dashboardErrorTitle: {
    ...Typography.headline,
    fontWeight: "700",
    color: Colors.text,
    textAlign: "center",
  },
  dashboardErrorBody: {
    ...Typography.footnote,
    color: Colors.textSecondary,
    textAlign: "center",
  },
  dashboardErrorBtn: {
    marginTop: 12,
    backgroundColor: Colors.accent,
    borderRadius: Radius.pill,
    paddingHorizontal: 24,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  dashboardErrorBtnText: {
    ...Typography.subheadline,
    fontWeight: "600",
    color: Colors.background,
  },

  welcomeHero: { alignItems: "center", backgroundColor: Colors.card, borderRadius: Radius.xl, paddingHorizontal: 20, paddingVertical: 24, borderWidth: 1, borderColor: Colors.border, gap: 12 },
  welcomeOrbit: { width: 112, height: 112, borderRadius: Radius.pill, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  welcomeCenterMark: { width: 54, height: 54, borderRadius: Radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(232,147,58,0.14)", borderWidth: 1, borderColor: "rgba(232,147,58,0.32)" },
  welcomeOrbitIcon: { position: "absolute", width: 38, height: 38, borderRadius: Radius.pill, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: Colors.borderSubtle },
  welcomeOrbitIcon0: { top: 0, left: 37 },
  welcomeOrbitIcon1: { right: 2, bottom: 18 },
  welcomeOrbitIcon2: { left: 2, bottom: 18 },
  emptyCardsStack: { gap: 12 },
  emptyVisionCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: Colors.card, borderRadius: Radius.lg, padding: 16, borderWidth: 1 },
  emptyVisionIcon: { width: 44, height: 44, borderRadius: Radius.pill, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  emptyVisionText: { flex: 1, gap: 4 },
  emptyVisionTitle: { ...Typography.subheadline, fontWeight: "700", color: Colors.text },
  emptyVisionBody: { ...Typography.footnote, color: Colors.textSecondary },
  emptyVisionChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  emptyVisionChip: { ...Typography.caption, fontWeight: "600", overflow: "hidden", borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 4 },

  headerGradient: { paddingBottom: 20 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", paddingHorizontal: 20, paddingTop: 16 },
  headerTitle: { ...Typography.largeTitle, color: Colors.text },
  statusBadges: { flexDirection: "column", gap: 8, alignItems: "flex-end" },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.md },
  badgeDot: { width: 6, height: 6, borderRadius: Radius.pill },
  badgeText: { ...Typography.caption, fontWeight: "600" },
  content: { paddingHorizontal: 20, paddingTop: 4, gap: 24 },
  budgetBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "rgba(255, 214, 10, 0.10)",
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: "rgba(255, 214, 10, 0.30)",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  budgetBannerText: {
    ...Typography.footnote,
    fontWeight: "500",
    flex: 1,
    color: Colors.dueSoon,
  },

  panelCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: 16,
  },
  panelEmpty: { alignItems: "center", paddingVertical: 16, gap: 8 },
  panelEmptyText: { ...Typography.caption, color: Colors.textSecondary },

  sectionLabel: {
    ...Typography.caption,
    fontWeight: "600",
    color: Colors.textTertiary,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginTop: 24,
    marginBottom: 8,
  },

  taskTrailing: { alignItems: "flex-end", flexShrink: 0 },
  taskDue: { ...Typography.caption, fontWeight: "500", flexShrink: 0 },

  seeAllRow: { paddingVertical: 12, alignItems: "center" },
  seeAllText: { ...Typography.footnote, fontWeight: "500", color: Colors.accent },

  headerSummary: { ...Typography.footnote, color: Colors.textTertiary, marginTop: 4 },

  sectionTitle: { ...Typography.subheadline, fontWeight: "600", color: Colors.text },

  welcomeWrap: { gap: 16 },
  welcomeTitle: { ...Typography.subheadline, fontWeight: "600", color: Colors.text },
  welcomeBody: { ...Typography.footnote, color: Colors.textSecondary },
  emptyCardIcon: { width: 44, height: 44, borderRadius: Radius.pill, alignItems: "center", justifyContent: "center" },

  qmCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
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
    borderRadius: Radius.md,
    backgroundColor: Colors.card,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  qmCardTitle: {
    ...Typography.subheadline,
    fontWeight: "600",
    color: Colors.text,
  },
  qmCardSub: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  qmVehicleList: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  qmVehicleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
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
    ...Typography.footnote,
    fontWeight: "500",
    color: Colors.text,
  },
  qmVehicleAge: {
    ...Typography.caption,
  },
  qmInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  qmInput: {
    ...Typography.footnote,
    fontWeight: "500",
    width: 82,
    height: 34,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 8,
    color: Colors.text,
    textAlign: "right",
  },
  qmSaveBtn: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: Radius.md,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 52,
  },
  qmSaveBtnText: {
    ...Typography.caption,
    fontWeight: "600",
    color: Colors.white,
  },
  qmError: {
    ...Typography.caption,
    color: Colors.overdue,
  },

  sheetOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheetKAV: {
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: Colors.cardElevated,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  sheetHandleBar: {
    width: 36,
    height: 4,
    borderRadius: Radius.sm,
    backgroundColor: Colors.border,
    alignSelf: "center",
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  sheetIconWrap: {
    width: 32,
    height: 32,
    borderRadius: Radius.md,
    backgroundColor: Colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetTitle: {
    ...Typography.subheadline,
    fontWeight: "600",
    flex: 1,
    color: Colors.text,
  },
  sheetCloseBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetTextInput: {
    ...Typography.footnote,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: Colors.text,
    minHeight: 96,
    textAlignVertical: "top",
  },
  sheetProcessBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.accent,
    borderRadius: Radius.md,
    height: 46,
  },
  sheetProcessBtnText: {
    ...Typography.subheadline,
    fontWeight: "600",
    color: Colors.white,
  },
  sheetProcessing: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 24,
  },
  sheetProcessingText: {
    ...Typography.footnote,
    fontWeight: "500",
    color: Colors.textSecondary,
  },
  sheetErrorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sheetErrorText: {
    ...Typography.footnote,
    flex: 1,
    color: Colors.dueSoon,
  },

  confirmCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    gap: 12,
    marginBottom: 12,
  },
  confirmCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  confirmCatIcon: {
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  confirmAssetName: {
    ...Typography.footnote,
    fontWeight: "600",
    flex: 1,
    color: Colors.text,
  },
  confirmLowBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.card,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.sm,
  },
  confirmLowBadgeText: {
    ...Typography.caption,
    fontWeight: "600",
    color: Colors.dueSoon,
  },
  confirmFields: {
    gap: 8,
  },
  confirmActions: {
    flexDirection: "row",
    gap: 12,
    paddingTop: 2,
  },
  confirmDiscardBtn: {
    flex: 1,
    height: 40,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  confirmDiscardText: {
    ...Typography.footnote,
    fontWeight: "500",
    color: Colors.textSecondary,
  },
  confirmSaveBtn: {
    flex: 2,
    height: 40,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.accent,
  },
  confirmSaveBtnText: {
    ...Typography.footnote,
    fontWeight: "600",
    color: Colors.white,
  },
  confirmCardError: {
    ...Typography.caption,
    color: Colors.overdue,
  },

  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 36,
  },
  fieldLabel: {
    ...Typography.caption,
    fontWeight: "500",
    width: 66,
    color: Colors.textSecondary,
    flexShrink: 0,
  },
  fieldInputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.card,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 8,
    height: 36,
  },
  fieldInput: {
    ...Typography.footnote,
    flex: 1,
    color: Colors.text,
    height: 36,
  },
  fieldAffix: {
    ...Typography.caption,
    color: Colors.textTertiary,
    flexShrink: 0,
  },

  scoreHero: {
    alignItems: "center",
    paddingVertical: 16,
    gap: 8,
  },
  scoreTitle: { ...Typography.subheadline, fontWeight: "600", color: Colors.text, textAlign: "center" },
  scoreMessage: { ...Typography.footnote, color: Colors.textSecondary, textAlign: "center" },
  scoreDetail: { ...Typography.caption, color: Colors.textTertiary, textAlign: "center" },

  spendingTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  spendingThisMonth: { ...Typography.footnote, color: Colors.textSecondary },
  spendingAmount: { ...Typography.headline, fontWeight: "700", color: Colors.text },
  spendingEmpty: { ...Typography.footnote, color: Colors.textTertiary, textAlign: "center", paddingVertical: 12 },
  spendingBars: { gap: 8 },
  spendingBarRow: { gap: 4 },
  spendingBarTrack: { height: 16, backgroundColor: Colors.borderSubtle, borderRadius: Radius.sm, overflow: "hidden" },
  spendingBarFill: { height: 16, backgroundColor: Colors.accent, borderRadius: Radius.sm },
  spendingBarLabel: { ...Typography.caption, color: Colors.textTertiary },

  catCard: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    alignItems: "center",
  },

});
