import React, { useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { LinearGradient } from "expo-linear-gradient";
import { differenceInDays, parseISO, isAfter, isBefore, addDays } from "date-fns";

type DashboardItem = {
  id: string;
  title: string;
  subtitle: string;
  dueDate: string | null;
  status: "overdue" | "due_soon" | "good";
  category: "vehicle" | "home" | "health";
  entityId: string;
  entityName: string;
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
  if (days < 0) return `${Math.abs(days)} days overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days < 30) return `Due in ${days} days`;
  const months = Math.floor(days / 30);
  return `Due in ${months} month${months > 1 ? "s" : ""}`;
}

function getAgeScreenings(dob: string | null, sex: string | null): { title: string; description: string }[] {
  if (!dob) return [];
  const birthDate = parseISO(dob);
  const today = new Date();
  const age = today.getFullYear() - birthDate.getFullYear();
  const screenings: { title: string; description: string }[] = [];

  if (age >= 45) screenings.push({ title: "Colonoscopy", description: "Recommended every 10 years from age 45" });
  if (age >= 18) screenings.push({ title: "Annual Physical", description: "Yearly checkup with your primary care provider" });
  if (sex === "female" && age >= 40) screenings.push({ title: "Mammogram", description: "Recommended annually from age 40" });
  if (sex === "male" && age >= 50) screenings.push({ title: "Prostate Screening", description: "PSA test recommended from age 50" });
  if (age >= 20) screenings.push({ title: "Skin Check", description: "Annual full-body skin examination" });
  if (age >= 18) screenings.push({ title: "Eye Exam", description: "Comprehensive eye exam every 1-2 years" });

  return screenings;
}

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const { data: dashboardItems, isLoading, refetch } = useQuery({
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
          items.push({
            id: t.id,
            title: t.task,
            subtitle: v.nickname ?? `${v.make} ${v.model}`,
            dueDate: t.next_due_date,
            status,
            category: "vehicle",
            entityId: t.vehicle_id,
            entityName: v.nickname ?? `${v.make} ${v.model}`,
          });
        }
      }

      for (const t of propertyTasks.data ?? []) {
        const p = (t as any).properties;
        if (!p) continue;
        const status = getStatus(t.next_due_date);
        if (status !== "good") {
          items.push({
            id: t.id,
            title: t.task,
            subtitle: p.nickname ?? p.address ?? "Property",
            dueDate: t.next_due_date,
            status,
            category: "home",
            entityId: t.property_id,
            entityName: p.nickname ?? p.address ?? "Property",
          });
        }
      }

      for (const a of healthAppts.data ?? []) {
        const status = getStatus(a.next_due_date);
        if (status !== "good") {
          items.push({
            id: a.id,
            title: a.appointment_type,
            subtitle: a.provider_name ?? "Health",
            dueDate: a.next_due_date,
            status,
            category: "health",
            entityId: a.id,
            entityName: "Health",
          });
        }
      }

      return items.sort((a, b) => {
        const order = { overdue: 0, due_soon: 1, good: 2 };
        return order[a.status] - order[b.status];
      });
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

  const overdue = dashboardItems?.filter(i => i.status === "overdue") ?? [];
  const dueSoon = dashboardItems?.filter(i => i.status === "due_soon") ?? [];
  const screenings = healthProfile ? getAgeScreenings(healthProfile.date_of_birth, healthProfile.sex_at_birth) : [];

  const webTopPad = Platform.OS === "web" ? 67 : 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: Colors.background }}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={isLoading}
          onRefresh={refetch}
          tintColor={Colors.accent}
        />
      }
    >
      <LinearGradient
        colors={["rgba(0,201,167,0.10)", "transparent"]}
        style={[styles.headerGradient, { paddingTop: webTopPad }]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Good {getGreeting()}</Text>
            <Text style={styles.headerTitle}>Dashboard</Text>
          </View>
          <View style={styles.statusBadges}>
            <StatusBadge count={overdue.length} color={Colors.overdue} />
            <StatusBadge count={dueSoon.length} color={Colors.dueSoon} />
          </View>
        </View>
      </LinearGradient>

      <View style={[styles.content, { paddingBottom: insets.bottom + 100 + (Platform.OS === "web" ? 34 : 0) }]}>
        {isLoading ? (
          <ActivityIndicator color={Colors.accent} style={{ marginTop: 40 }} />
        ) : (
          <>
            {overdue.length === 0 && dueSoon.length === 0 ? (
              <EmptyDashboard />
            ) : (
              <>
                {overdue.length > 0 && (
                  <Section title="Overdue" count={overdue.length} statusColor={Colors.overdue}>
                    {overdue.map(item => <DashboardCard key={item.id} item={item} />)}
                  </Section>
                )}
                {dueSoon.length > 0 && (
                  <Section title="Due Soon" count={dueSoon.length} statusColor={Colors.dueSoon}>
                    {dueSoon.map(item => <DashboardCard key={item.id} item={item} />)}
                  </Section>
                )}
              </>
            )}

            {screenings.length > 0 && (
              <View style={styles.screeningSection}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Health Screenings</Text>
                  <View style={styles.screeningBadge}>
                    <Ionicons name="medical-outline" size={12} color={Colors.health} />
                    <Text style={[styles.screeningBadgeText]}>Age-based</Text>
                  </View>
                </View>
                {screenings.slice(0, 3).map((s, i) => (
                  <Pressable
                    key={i}
                    style={({ pressed }) => [styles.screeningCard, { opacity: pressed ? 0.8 : 1 }]}
                    onPress={() => router.push("/add-appointment")}
                  >
                    <View style={styles.screeningIcon}>
                      <Ionicons name="heart-outline" size={18} color={Colors.health} />
                    </View>
                    <View style={styles.screeningContent}>
                      <Text style={styles.screeningTitle}>{s.title}</Text>
                      <Text style={styles.screeningDesc}>{s.description}</Text>
                    </View>
                    <Ionicons name="add-circle-outline" size={20} color={Colors.health} />
                  </Pressable>
                ))}
              </View>
            )}

            <QuickActions />
          </>
        )}
      </View>
    </ScrollView>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

function StatusBadge({ count, color }: { count: number; color: string }) {
  if (count === 0) return null;
  return (
    <View style={[styles.badge, { backgroundColor: color + "22" }]}>
      <Text style={[styles.badgeText, { color }]}>{count}</Text>
    </View>
  );
}

function Section({ title, count, statusColor, children }: {
  title: string;
  count: number;
  statusColor: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <View style={[styles.sectionDot, { backgroundColor: statusColor }]} />
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        <Text style={[styles.sectionCount, { color: statusColor }]}>{count}</Text>
      </View>
      {children}
    </View>
  );
}

function DashboardCard({ item }: { item: DashboardItem }) {
  const statusColors = {
    overdue: { bg: Colors.overdueMuted, border: Colors.overdue, text: Colors.overdue },
    due_soon: { bg: Colors.dueSoonMuted, border: Colors.dueSoon, text: Colors.dueSoon },
    good: { bg: Colors.goodMuted, border: Colors.good, text: Colors.good },
  };
  const colors = statusColors[item.status];
  const catColors = { vehicle: Colors.vehicle, home: Colors.home, health: Colors.health };
  const catIcons = { vehicle: "car-outline" as const, home: "home-outline" as const, health: "heart-outline" as const };

  function handlePress() {
    if (item.category === "vehicle") router.push(`/vehicle/${item.entityId}` as any);
    else if (item.category === "home") router.push(`/property/${item.entityId}` as any);
    else router.push("/(tabs)/health");
  }

  return (
    <Pressable
      style={({ pressed }) => [styles.dashCard, { borderLeftColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
      onPress={handlePress}
    >
      <View style={[styles.dashCardIcon, { backgroundColor: catColors[item.category] + "18" }]}>
        <Ionicons name={catIcons[item.category]} size={18} color={catColors[item.category]} />
      </View>
      <View style={styles.dashCardContent}>
        <Text style={styles.dashCardTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.dashCardSubtitle} numberOfLines={1}>{item.subtitle}</Text>
      </View>
      <View style={[styles.duePill, { backgroundColor: colors.bg }]}>
        <Text style={[styles.duePillText, { color: colors.text }]}>
          {formatDueDate(item.dueDate)}
        </Text>
      </View>
    </Pressable>
  );
}

function EmptyDashboard() {
  return (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIcon}>
        <Ionicons name="checkmark-circle-outline" size={48} color={Colors.good} />
      </View>
      <Text style={styles.emptyTitle}>Everything's up to date</Text>
      <Text style={styles.emptySubtitle}>No overdue or upcoming items. Add vehicles, properties, or health appointments to start tracking.</Text>
    </View>
  );
}

function QuickActions() {
  const actions = [
    { label: "Add Vehicle", icon: "car-outline" as const, color: Colors.vehicle, route: "/add-vehicle" as any },
    { label: "Add Property", icon: "home-outline" as const, color: Colors.home, route: "/add-property" as any },
    { label: "Add Appointment", icon: "heart-outline" as const, color: Colors.health, route: "/add-appointment" as any },
  ];

  return (
    <View style={styles.quickActions}>
      <Text style={styles.sectionTitle}>Quick Add</Text>
      <View style={styles.quickActionsRow}>
        {actions.map(a => (
          <Pressable
            key={a.label}
            style={({ pressed }) => [styles.quickAction, { opacity: pressed ? 0.8 : 1 }]}
            onPress={() => router.push(a.route)}
          >
            <View style={[styles.quickActionIcon, { backgroundColor: a.color + "18" }]}>
              <Ionicons name={a.icon} size={22} color={a.color} />
            </View>
            <Text style={styles.quickActionLabel}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerGradient: { paddingBottom: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", paddingHorizontal: 20, paddingTop: 16 },
  greeting: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textTransform: "capitalize" },
  headerTitle: { fontSize: 30, fontFamily: "Inter_700Bold", color: Colors.text, letterSpacing: -0.5 },
  statusBadges: { flexDirection: "row", gap: 6, alignItems: "center" },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  badgeText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 24 },
  section: { gap: 10 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionDot: { width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.text },
  sectionCount: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  dashCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    borderLeftWidth: 3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dashCardIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  dashCardContent: { flex: 1, gap: 2 },
  dashCardTitle: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.text },
  dashCardSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  duePill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, maxWidth: 130 },
  duePillText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  emptyContainer: { alignItems: "center", paddingVertical: 40, gap: 12 },
  emptyIcon: { width: 80, height: 80, borderRadius: 24, backgroundColor: Colors.goodMuted, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 20, fontFamily: "Inter_600SemiBold", color: Colors.text },
  emptySubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center", lineHeight: 22 },
  screeningSection: { gap: 10 },
  screeningBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.healthMuted, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  screeningBadgeText: { fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.health },
  screeningCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  screeningIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.healthMuted, alignItems: "center", justifyContent: "center" },
  screeningContent: { flex: 1, gap: 2 },
  screeningTitle: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.text },
  screeningDesc: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  quickActions: { gap: 12 },
  quickActionsRow: { flexDirection: "row", gap: 12 },
  quickAction: { flex: 1, alignItems: "center", gap: 8, backgroundColor: Colors.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: Colors.border },
  quickActionIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  quickActionLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.textSecondary, textAlign: "center" },
});
