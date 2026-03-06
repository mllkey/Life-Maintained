import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  RefreshControl,
  Platform,
} from "react-native";
import { usePulse, S, Row, Col } from "@/components/Skeleton";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
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
  const webTopPad = Platform.OS === "web" ? 67 : 0;
  const { monthlyCost, budgetThreshold } = useBudgetAlert();

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
        supabase.from("vehicle_maintenance_tasks").select("*, vehicles(make, model, nickname)").eq("vehicles.user_id", user.id),
        supabase.from("property_maintenance_tasks").select("*, properties(address, nickname)").eq("properties.user_id", user.id),
        supabase.from("health_appointments").select("*").eq("user_id", user.id),
      ]);
      for (const t of vehicleTasks.data ?? []) {
        const v = (t as any).vehicles;
        if (!v) continue;
        const status = getStatus(t.next_due_date);
        if (status !== "good") {
          items.push({ id: t.id, title: t.task, subtitle: v.nickname ?? `${v.make} ${v.model}`, dueDate: t.next_due_date, status, category: "vehicles", entityId: t.vehicle_id });
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

  function refetch() {
    refetchCounts();
    refetchDash();
    refetchSpending();
  }

  const isLoading = countsLoading || dashLoading;
  const isNewUser = !isLoading && counts != null && counts.vehicles === 0 && counts.properties === 0 && counts.health === 0;
  const screenings = healthProfile ? getAgeScreenings(healthProfile.date_of_birth, healthProfile.sex_at_birth) : [];
  const upcomingItems = dashboardItems?.slice(0, 6) ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
    <ScrollView
      style={{ flex: 1 }}
      showsVerticalScrollIndicator={false}
      contentInsetAdjustmentBehavior="never"
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={Colors.accent} />}
    >
      <LinearGradient
        colors={["rgba(0,201,167,0.10)", "transparent"]}
        style={[styles.headerGradient, { paddingTop: insets.top + webTopPad + 16 }]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>{getGreeting()}</Text>
            <Text style={styles.headerTitle}>Dashboard</Text>
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
            <CategoryCardsRow counts={counts ?? { vehicles: 0, properties: 0, health: 0 }} />

            <View style={styles.twoCol}>
              <UpcomingTasksCard items={upcomingItems} />
              <SpendingCard spending={spending ?? {}} />
            </View>

            {screenings.length > 0 && (familyMembers?.length ?? 0) > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Health Screenings</Text>
                  <View style={styles.screeningBadge}>
                    <Ionicons name="medical-outline" size={11} color={Colors.health} />
                    <Text style={styles.screeningBadgeText}>Age-based</Text>
                  </View>
                </View>
                {screenings.slice(0, 3).map((s, i) => (
                  <View key={i} style={styles.screeningCard}>
                    <View style={styles.screeningIcon}>
                      <Ionicons name="heart-outline" size={17} color={Colors.health} />
                    </View>
                    <Pressable style={styles.screeningContent} onPress={() => router.push("/add-appointment" as any)}>
                      <Text style={styles.screeningTitle}>{s.title}</Text>
                      <Text style={styles.screeningDesc}>{s.description}</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.screeningNotifBtn, screeningOptIns[s.title] && styles.screeningNotifBtnActive]}
                      onPress={() => toggleScreeningOptIn(s.title)}
                      hitSlop={8}
                    >
                      <Ionicons
                        name={screeningOptIns[s.title] ? "notifications" : "notifications-outline"}
                        size={16}
                        color={screeningOptIns[s.title] ? Colors.health : Colors.textTertiary}
                      />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </View>
    </ScrollView>
    </View>
  );
}

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

function CategoryCardsRow({ counts }: { counts: { vehicles: number; properties: number; health: number } }) {
  const cats: (keyof typeof CAT)[] = ["vehicles", "properties", "health"];
  return (
    <View style={styles.catRow}>
      {cats.map(key => {
        const cat = CAT[key];
        const count = counts[key];
        return (
          <Pressable
            key={key}
            style={({ pressed }) => [styles.catCard, { opacity: pressed ? 0.85 : 1 }]}
            onPress={() => { Haptics.selectionAsync(); router.push(cat.tab); }}
          >
            <View style={[styles.catIconWrap, { backgroundColor: cat.muted }]}>
              <Ionicons name={cat.icon} size={22} color={cat.color} />
            </View>
            <Text style={[styles.catCount, { color: cat.color }]}>{count}</Text>
            <Text style={styles.catLabel}>{cat.label}</Text>
          </Pressable>
        );
      })}
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

  return (
    <View style={[styles.panelCard, { flex: 5 }]}>
      <View style={styles.panelHeader}>
        <Text style={styles.panelTitle}>Upcoming</Text>
        {items.length > 0 && (
          <View style={[styles.panelBadge, { backgroundColor: items.some(i => i.status === "overdue") ? Colors.overdueMuted : Colors.dueSoonMuted }]}>
            <Text style={[styles.panelBadgeText, { color: items.some(i => i.status === "overdue") ? Colors.overdue : Colors.dueSoon }]}>
              {items.length}
            </Text>
          </View>
        )}
      </View>
      {items.length === 0 ? (
        <View style={styles.panelEmpty}>
          <Ionicons name="checkmark-circle-outline" size={24} color={Colors.good} />
          <Text style={styles.panelEmptyText}>All good</Text>
        </View>
      ) : (
        <View style={styles.taskList}>
          {items.map((item, idx) => {
            const statusColor = item.status === "overdue" ? Colors.overdue : Colors.dueSoon;
            const catColor = CAT[item.category].color;
            return (
              <Pressable
                key={item.id}
                style={({ pressed }) => [
                  styles.taskRow,
                  idx < items.length - 1 && styles.taskRowBorder,
                  { opacity: pressed ? 0.75 : 1 },
                ]}
                onPress={() => handlePress(item)}
              >
                <View style={[styles.taskDot, { backgroundColor: statusColor }]} />
                <View style={styles.taskInfo}>
                  <Text style={styles.taskTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.taskSub} numberOfLines={1}>{item.subtitle}</Text>
                </View>
                <Text style={[styles.taskDue, { color: statusColor }]}>{formatDueDate(item.dueDate)}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

function SpendingCard({ spending }: { spending: Record<string, number> }) {
  const months = useMemo(() => {
    const result: { key: string; label: string; amount: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = subMonths(new Date(), i);
      const key = format(d, "yyyy-MM");
      result.push({ key, label: format(d, "MMM"), amount: spending[key] ?? 0 });
    }
    return result;
  }, [spending]);

  const maxAmount = Math.max(...months.map(m => m.amount), 1);
  const totalSpent = months.reduce((sum, m) => sum + m.amount, 0);

  return (
    <View style={[styles.panelCard, { flex: 3 }]}>
      <View style={styles.panelHeader}>
        <Text style={styles.panelTitle}>Spending</Text>
      </View>
      <Text style={styles.spendTotal}>${totalSpent.toFixed(0)}</Text>
      <Text style={styles.spendLabel}>6 months</Text>
      <View style={styles.chartArea}>
        {months.map(m => {
          const barH = maxAmount > 0 ? Math.round((m.amount / maxAmount) * 48) : 0;
          return (
            <View key={m.key} style={styles.chartBarWrap}>
              <View style={[styles.chartBar, { height: Math.max(barH, m.amount > 0 ? 3 : 0), backgroundColor: barH > 0 ? Colors.blue : Colors.border }]} />
              <Text style={styles.chartLabel}>{m.label.charAt(0)}</Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.spendSubLabel}>Vehicle maintenance</Text>
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
  content: { paddingHorizontal: 16, paddingTop: 4, gap: 20 },
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

  catRow: { flexDirection: "row", gap: 10 },
  catCard: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 14,
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    minHeight: 110,
    justifyContent: "center",
  },
  catIconWrap: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  catCount: { fontSize: 24, fontFamily: "Inter_700Bold", lineHeight: 28 },
  catLabel: { fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.textSecondary, textAlign: "center" },

  twoCol: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  panelCard: { backgroundColor: Colors.card, borderRadius: 16, padding: 14, gap: 2, borderWidth: 1, borderColor: Colors.border },
  panelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  panelTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.text },
  panelBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7 },
  panelBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  panelEmpty: { alignItems: "center", paddingVertical: 16, gap: 6 },
  panelEmptyText: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary },

  taskList: { gap: 0 },
  taskRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9, minHeight: 44 },
  taskRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  taskDot: { width: 7, height: 7, borderRadius: 3.5, flexShrink: 0 },
  taskInfo: { flex: 1, gap: 1 },
  taskTitle: { fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.text, lineHeight: 16 },
  taskSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textTertiary, lineHeight: 14 },
  taskDue: { fontSize: 11, fontFamily: "Inter_600SemiBold", flexShrink: 0 },

  spendTotal: { fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.text, lineHeight: 26 },
  spendLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textTertiary, marginBottom: 10 },
  chartArea: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: 56, marginTop: 4 },
  chartBarWrap: { flex: 1, alignItems: "center", justifyContent: "flex-end", gap: 3 },
  chartBar: { width: "100%", borderRadius: 3 },
  chartLabel: { fontSize: 9, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  spendSubLabel: { fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.textTertiary, marginTop: 6 },

  section: { gap: 10 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.text },
  screeningBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.healthMuted, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  screeningBadgeText: { fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.health },
  screeningCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: Colors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.border },
  screeningIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.healthMuted, alignItems: "center", justifyContent: "center" },
  screeningContent: { flex: 1, gap: 2 },
  screeningTitle: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.text },
  screeningDesc: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  screeningNotifBtn: { width: 44, height: 44, borderRadius: 10, backgroundColor: Colors.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: Colors.border },
  screeningNotifBtnActive: { backgroundColor: Colors.healthMuted, borderColor: Colors.health + "44" },

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
});
