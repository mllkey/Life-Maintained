import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import * as Haptics from "expo-haptics";
import { parseISO, isBefore, addDays, differenceInDays, format } from "date-fns";

function getStatus(date: string | null): "overdue" | "due_soon" | "good" {
  if (!date) return "good";
  const d = parseISO(date);
  if (isBefore(d, new Date())) return "overdue";
  if (isBefore(d, addDays(new Date(), 30))) return "due_soon";
  return "good";
}

function formatDaysLabel(date: string | null, status: "overdue" | "due_soon" | "good"): string {
  if (!date) return "No due date";
  const days = differenceInDays(parseISO(date), new Date());
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 30) return `In ${days}d`;
  return format(parseISO(date), "MMM d");
}

export default function PropertyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"tasks" | "history">("tasks");
  const [isDeleting, setIsDeleting] = useState(false);

  const { data: property, isLoading: loadingProperty } = useQuery({
    queryKey: ["property", id],
    queryFn: async () => {
      const { data } = await supabase.from("properties").select("*").eq("id", id).single();
      return data;
    },
  });

  const { data: tasks, isLoading: loadingTasks, refetch } = useQuery({
    queryKey: ["property_tasks", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("property_maintenance_tasks")
        .select("*")
        .eq("property_id", id!)
        .order("next_due_date", { ascending: true });
      return data ?? [];
    },
    enabled: !!id,
  });

  const { data: logs } = useQuery({
    queryKey: ["property_logs", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("maintenance_logs")
        .select("*")
        .eq("property_id", id!)
        .order("service_date", { ascending: false });
      return data ?? [];
    },
    enabled: !!id,
  });

  async function markComplete(taskId: string, taskInterval: string | null) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const months: Record<string, number> = {
      "Monthly": 1, "Quarterly": 3, "Bi-Annually": 6, "Annually": 12,
      "Every 2 Years": 24, "Every 5 Years": 60, "As Needed": 12,
    };
    let nextDate: string | null = null;
    if (taskInterval) {
      const next = new Date();
      next.setMonth(next.getMonth() + (months[taskInterval] ?? 12));
      nextDate = next.toISOString().split("T")[0];
    }
    await supabase.from("property_maintenance_tasks").update({
      last_completed_at: new Date().toISOString(),
      next_due_date: nextDate,
      updated_at: new Date().toISOString(),
    }).eq("id", taskId);
    queryClient.invalidateQueries({ queryKey: ["property_tasks", id] });
    queryClient.invalidateQueries({ queryKey: ["property_task_counts"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  function handleDelete() {
    Alert.alert(
      "Delete Property",
      "This will permanently delete this property and all its tasks. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setIsDeleting(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            await supabase.from("property_maintenance_tasks").delete().eq("property_id", id!);
            await supabase.from("properties").delete().eq("id", id!);
            queryClient.invalidateQueries({ queryKey: ["properties"] });
            queryClient.invalidateQueries({ queryKey: ["dashboard"] });
            queryClient.invalidateQueries({ queryKey: ["dashboard_counts"] });
            router.back();
          },
        },
      ]
    );
  }

  const isLoading = loadingProperty || loadingTasks;
  const propertyName = property ? (property.nickname ?? property.address ?? "Property") : "Property";

  const estimatedAnnualCost = useMemo(() => {
    if (!tasks || tasks.length === 0) {
      if (property?.square_footage) return Math.round(property.square_footage * 0.01 * 100);
      return null;
    }
    const sum = tasks.reduce((acc: number, t: any) => acc + (t.estimated_cost ?? 0), 0);
    if (sum > 0) return sum;
    if (property?.square_footage) return Math.round(property.square_footage * 0.01 * 100);
    return null;
  }, [tasks, property]);

  const overdueTasks = tasks?.filter(t => getStatus(t.next_due_date) === "overdue") ?? [];
  const dueSoonTasks = tasks?.filter(t => getStatus(t.next_due_date) === "due_soon") ?? [];
  const goodTasks = tasks?.filter(t => getStatus(t.next_due_date) === "good") ?? [];
  const allTasks = [...overdueTasks, ...dueSoonTasks, ...goodTasks];

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={6}>
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{propertyName}</Text>
          {property?.address && property?.nickname && (
            <Text style={styles.headerSub} numberOfLines={1}>{property.address}</Text>
          )}
          {(property?.year_built || property?.square_footage) && (
            <View style={styles.headerMetaRow}>
              {property?.year_built && (
                <Text style={styles.headerMeta}>Built {property.year_built}</Text>
              )}
              {property?.year_built && property?.square_footage && (
                <Text style={styles.headerMetaDot}>·</Text>
              )}
              {property?.square_footage && (
                <Text style={styles.headerMeta}>{property.square_footage.toLocaleString()} sqft</Text>
              )}
            </View>
          )}
        </View>
        <View style={styles.headerActions}>
          <Pressable
            style={({ pressed }) => [styles.deleteBtn, { opacity: pressed ? 0.7 : 1 }]}
            onPress={handleDelete}
            disabled={isDeleting}
            hitSlop={4}
          >
            <Ionicons name="trash-outline" size={17} color={Colors.overdue} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.addTaskBtn, { opacity: pressed ? 0.8 : 1 }]}
            onPress={() => router.push(`/add-property-task/${id}` as any)}
          >
            <Ionicons name="add" size={14} color={Colors.home} />
            <Text style={styles.addTaskBtnText}>Add Task</Text>
          </Pressable>
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator color={Colors.accent} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={Colors.accent} />}
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        >
          {estimatedAnnualCost != null && (
            <View style={styles.costBanner}>
              <View style={styles.costBannerLeft}>
                <Ionicons name="wallet-outline" size={20} color={Colors.home} />
                <View style={styles.costBannerText}>
                  <Text style={styles.costBannerLabel}>Est. Annual Maintenance</Text>
                  <Text style={styles.costBannerAmount}>
                    ${estimatedAnnualCost.toLocaleString()}
                    <Text style={styles.costBannerSuffix}>/year</Text>
                  </Text>
                </View>
              </View>
              <View style={styles.costBannerBadge}>
                <Text style={styles.costBannerBadgeText}>
                  {tasks && tasks.length > 0 ? "From tasks" : "1% rule est."}
                </Text>
              </View>
            </View>
          )}

          <View style={styles.tabs}>
            {(["tasks", "history"] as const).map(tab => (
              <Pressable
                key={tab}
                style={[styles.tab, activeTab === tab && styles.tabActive]}
                onPress={() => { Haptics.selectionAsync(); setActiveTab(tab); }}
              >
                <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                  {tab === "tasks" ? "Maintenance Tasks" : "Service History"}
                </Text>
              </Pressable>
            ))}
          </View>

          {activeTab === "tasks" ? (
            <View style={styles.tasksArea}>
              {allTasks.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="list-outline" size={32} color={Colors.textTertiary} />
                  <Text style={styles.emptyStateTitle}>No tasks yet</Text>
                  <Text style={styles.emptyStateText}>Add maintenance tasks to track HVAC, roof, gutters, and more.</Text>
                  <Pressable
                    style={({ pressed }) => [styles.emptyAddBtn, { opacity: pressed ? 0.8 : 1 }]}
                    onPress={() => router.push(`/add-property-task/${id}` as any)}
                  >
                    <Ionicons name="add" size={16} color={Colors.textInverse} />
                    <Text style={styles.emptyAddBtnText}>Add Task</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  {(overdueTasks.length > 0 || dueSoonTasks.length > 0) && (
                    <View style={styles.sectionHeader}>
                      {overdueTasks.length > 0 && (
                        <View style={[styles.sectionBadge, { backgroundColor: Colors.overdueMuted }]}>
                          <Text style={[styles.sectionBadgeText, { color: Colors.overdue }]}>
                            {overdueTasks.length} overdue
                          </Text>
                        </View>
                      )}
                      {dueSoonTasks.length > 0 && (
                        <View style={[styles.sectionBadge, { backgroundColor: Colors.dueSoonMuted }]}>
                          <Text style={[styles.sectionBadgeText, { color: Colors.dueSoon }]}>
                            {dueSoonTasks.length} due soon
                          </Text>
                        </View>
                      )}
                      {overdueTasks.length === 0 && dueSoonTasks.length === 0 && (
                        <View style={[styles.sectionBadge, { backgroundColor: Colors.goodMuted }]}>
                          <Ionicons name="checkmark-circle" size={12} color={Colors.good} />
                          <Text style={[styles.sectionBadgeText, { color: Colors.good }]}>All caught up</Text>
                        </View>
                      )}
                    </View>
                  )}
                  {overdueTasks.length === 0 && dueSoonTasks.length === 0 && allTasks.length > 0 && (
                    <View style={styles.sectionHeader}>
                      <View style={[styles.sectionBadge, { backgroundColor: Colors.goodMuted }]}>
                        <Ionicons name="checkmark-circle" size={12} color={Colors.good} />
                        <Text style={[styles.sectionBadgeText, { color: Colors.good }]}>All caught up</Text>
                      </View>
                    </View>
                  )}
                  <View style={styles.taskGrid}>
                    {allTasks.map(task => (
                      <TaskGridCell key={task.id} task={task} onComplete={markComplete} />
                    ))}
                  </View>
                </>
              )}
            </View>
          ) : (
            <View style={styles.tasksArea}>
              {(logs?.length ?? 0) === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="document-outline" size={32} color={Colors.textTertiary} />
                  <Text style={styles.emptyStateTitle}>No service records yet</Text>
                  <Text style={styles.emptyStateText}>Service history will appear here after tasks are logged.</Text>
                </View>
              ) : (
                logs?.map(log => (
                  <View key={log.id} style={styles.logCard}>
                    <View style={styles.logTop}>
                      <Text style={styles.logTask}>{log.service_name ?? "Service"}</Text>
                      {log.cost != null && <Text style={styles.logCost}>${log.cost.toFixed(2)}</Text>}
                    </View>
                    <View style={styles.logMeta}>
                      {log.service_date && (
                        <Text style={styles.logDate}>{format(parseISO(log.service_date), "MMM d, yyyy")}</Text>
                      )}
                      {log.provider_name && <Text style={styles.logProvider}>{log.provider_name}</Text>}
                    </View>
                    {log.notes && <Text style={styles.logNotes}>{log.notes}</Text>}
                  </View>
                ))
              )}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function TaskGridCell({ task, onComplete }: { task: any; onComplete: (id: string, interval: string | null) => void }) {
  const status = getStatus(task.next_due_date);
  const statusColor = status === "overdue" ? Colors.overdue : status === "due_soon" ? Colors.dueSoon : Colors.good;
  const statusBg = status === "overdue" ? Colors.overdueMuted : status === "due_soon" ? Colors.dueSoonMuted : Colors.goodMuted;
  const dueLabel = formatDaysLabel(task.next_due_date, status);

  return (
    <View style={[styles.gridCell, { borderTopColor: statusColor }]}>
      <View style={styles.gridCellTop}>
        <Text style={styles.gridCellName} numberOfLines={3}>{task.task}</Text>
      </View>
      <View style={styles.gridCellBottom}>
        {task.next_due_date ? (
          <View style={[styles.gridDuePill, { backgroundColor: statusBg }]}>
            <Text style={[styles.gridDueText, { color: statusColor }]}>{dueLabel}</Text>
          </View>
        ) : (
          <View style={[styles.gridDuePill, { backgroundColor: Colors.surface }]}>
            <Text style={[styles.gridDueText, { color: Colors.textTertiary }]}>No date</Text>
          </View>
        )}
        <Pressable
          style={({ pressed }) => [styles.gridDoneBtn, { opacity: pressed ? 0.7 : 1, backgroundColor: statusBg }]}
          onPress={() => onComplete(task.id, task.interval)}
          hitSlop={4}
        >
          <Ionicons name="checkmark" size={16} color={statusColor} />
        </Pressable>
      </View>
      {task.category && (
        <Text style={styles.gridCellCat} numberOfLines={1}>{task.category}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 8,
  },
  backBtn: { width: 40, height: 44, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  headerCenter: { flex: 1, alignItems: "center", gap: 1 },
  headerTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.text, textAlign: "center" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center" },
  headerMetaRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 1 },
  headerMeta: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  headerMetaDot: { fontSize: 11, color: Colors.textTertiary },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 },
  deleteBtn: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: Colors.overdueMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  addTaskBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.homeMuted,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 34,
  },
  addTaskBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.home },

  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 16 },

  costBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.homeMuted,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.home + "30",
  },
  costBannerLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  costBannerText: { gap: 1 },
  costBannerLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.home + "CC" },
  costBannerAmount: { fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.home },
  costBannerSuffix: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.home + "99" },
  costBannerBadge: {
    backgroundColor: Colors.home + "20",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  costBannerBadgeText: { fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.home },

  tabs: {
    flexDirection: "row",
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  tabActive: { backgroundColor: Colors.homeMuted },
  tabText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  tabTextActive: { color: Colors.home, fontFamily: "Inter_600SemiBold" },

  tasksArea: { gap: 12 },

  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 9,
  },
  sectionBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  taskGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  gridCell: {
    width: "48%",
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    borderTopWidth: 3,
    justifyContent: "space-between",
    minHeight: 110,
  },
  gridCellTop: { flex: 1 },
  gridCellName: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.text, lineHeight: 19 },
  gridCellCat: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textTertiary, textTransform: "capitalize" },
  gridCellBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  gridDuePill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7, flex: 1 },
  gridDueText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  gridDoneBtn: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },

  emptyState: { alignItems: "center", paddingVertical: 32, gap: 8 },
  emptyStateTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.text },
  emptyStateText: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center", lineHeight: 19 },
  emptyAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.home,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 4,
    minHeight: 44,
  },
  emptyAddBtnText: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.textInverse },

  logCard: { backgroundColor: Colors.card, borderRadius: 12, padding: 14, gap: 8, borderWidth: 1, borderColor: Colors.border },
  logTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  logTask: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.text, flex: 1 },
  logCost: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.home },
  logMeta: { flexDirection: "row", gap: 10 },
  logDate: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  logProvider: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  logNotes: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textTertiary, fontStyle: "italic" },
});
