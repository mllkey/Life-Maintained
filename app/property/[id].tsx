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
import { parseISO, isBefore, addDays, format } from "date-fns";

function getStatus(nextDueDate: string | null, lastCompletedAt: string | null): "overdue" | "due_soon" | "good" {
  const now = new Date();
  const soon = addDays(now, 30);

  if (nextDueDate) {
    const due = parseISO(nextDueDate);
    if (isBefore(due, now)) return "overdue";
    if (isBefore(due, soon)) return "due_soon";
  }

  // A task with no completion record is never "all caught up"
  if (!lastCompletedAt) return "due_soon";

  return "good";
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
      "3_months": 3, "6_months": 6, "12_months": 12,
      "24_months": 24, "36_months": 36, "60_months": 60,
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
    if (isDeleting) return;
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
            try {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              await supabase.from("property_maintenance_tasks").delete().eq("property_id", id!);
              await supabase.from("maintenance_logs").delete().eq("property_id", id!);
              await supabase.from("properties").delete().eq("id", id!);
              queryClient.invalidateQueries({ queryKey: ["properties"] });
              queryClient.invalidateQueries({ queryKey: ["dashboard"] });
              queryClient.invalidateQueries({ queryKey: ["dashboard_counts"] });
              router.back();
            } catch (err: any) {
              setIsDeleting(false);
              Alert.alert("Delete Failed", err?.message ?? "Something went wrong. Please try again.");
            }
          },
        },
      ]
    );
  }

  const isLoading = loadingProperty || loadingTasks;
  const propertyName = property ? (property.nickname ?? property.address ?? "Property") : "Property";

  const groupedHistory = useMemo(() => {
    if (!logs || logs.length === 0) return [];
    const map = new Map<string, any[]>();
    for (const log of logs) {
      const key = (log.service_name ?? "Service").trim();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(log);
    }
    return Array.from(map.entries()).map(([name, entries]) => {
      const sorted = [...entries].sort((a, b) => {
        if (!a.service_date) return 1;
        if (!b.service_date) return -1;
        return b.service_date.localeCompare(a.service_date);
      });
      const last = sorted[0];
      const hasCost = sorted.some(e => e.cost != null);
      const totalCost = hasCost ? sorted.reduce((s, e) => s + (e.cost ?? 0), 0) : null;
      return {
        name,
        entries: sorted,
        lastDate: last?.service_date ?? null,
        lastCost: last?.cost ?? null,
        lastProvider: last?.provider_name ?? null,
        totalCost,
        count: sorted.length,
      };
    }).sort((a, b) => (b.lastDate ?? "").localeCompare(a.lastDate ?? ""));
  }, [logs]);

  const historyStats = useMemo(() => {
    if (!logs || logs.length === 0) return { totalSpent: 0, visitCount: 0 };
    return {
      totalSpent: logs.reduce((s: number, l: any) => s + (l.cost ?? 0), 0),
      visitCount: logs.length,
    };
  }, [logs]);

  const overdueTasks = tasks?.filter(t => getStatus(t.next_due_date, t.last_completed_at) === "overdue") ?? [];
  const dueSoonTasks = tasks?.filter(t => getStatus(t.next_due_date, t.last_completed_at) === "due_soon") ?? [];
  const goodTasks = tasks?.filter(t => getStatus(t.next_due_date, t.last_completed_at) === "good") ?? [];
  const allTasks = [...overdueTasks, ...dueSoonTasks, ...goodTasks];

  const typeLabel: Record<string, string> = {
    house: "Single Family Home", condo: "Condo", apartment: "Apartment",
    townhouse: "Townhouse", commercial: "Commercial Building",
    vacation: "Vacation Home", other: "Property",
  };
  const propType = property ? (typeLabel[property.property_type ?? "other"] ?? "Property") : "";
  const metaParts: string[] = [];
  if (propType) metaParts.push(propType);
  if (property?.year_built) metaParts.push(`Built ${property.year_built}`);
  const metaLine = metaParts.join(" · ");

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={6}>
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.propertyName} numberOfLines={1}>{propertyName}</Text>
          {metaLine ? <Text style={styles.propertyMeta} numberOfLines={1}>{metaLine}</Text> : null}
        </View>
        <Pressable
          style={({ pressed }) => [styles.deleteBtn, { opacity: pressed ? 0.7 : 1 }]}
          onPress={handleDelete}
          disabled={isDeleting}
          hitSlop={4}
        >
          <Ionicons name="trash-outline" size={17} color={Colors.overdue} />
        </Pressable>
      </View>

      {isLoading ? (
        <ActivityIndicator color={Colors.accent} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={Colors.accent} />}
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        >
          <Pressable
            style={({ pressed }) => [styles.addTaskBtn, { opacity: pressed ? 0.8 : 1 }]}
            onPress={() => router.push(`/add-property-task/${id}` as any)}
          >
            <Ionicons name="add" size={18} color={Colors.textInverse} />
            <Text style={styles.addTaskBtnText}>Add Task</Text>
          </Pressable>

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
                  <Text style={styles.emptyStateText}>No maintenance tasks yet</Text>
                </View>
              ) : (
                <>
                  {overdueTasks.length > 0 && (
                    <>
                      <Text style={styles.sectionLabel}>ACTION NEEDED ({overdueTasks.length})</Text>
                      <View style={styles.taskCard}>
                        {overdueTasks.map((task, i) => (
                          <TaskRow key={task.id} task={task} onComplete={markComplete} isLast={i === overdueTasks.length - 1} />
                        ))}
                      </View>
                    </>
                  )}
                  {dueSoonTasks.length > 0 && (
                    <>
                      <Text style={styles.sectionLabel}>UPCOMING ({dueSoonTasks.length})</Text>
                      <View style={styles.taskCard}>
                        {dueSoonTasks.map((task, i) => (
                          <TaskRow key={task.id} task={task} onComplete={markComplete} isLast={i === dueSoonTasks.length - 1} />
                        ))}
                      </View>
                    </>
                  )}
                  {goodTasks.length > 0 && (
                    <>
                      <Text style={styles.sectionLabel}>UP TO DATE ({goodTasks.length})</Text>
                      <View style={styles.taskCard}>
                        {goodTasks.map((task, i) => (
                          <TaskRow key={task.id} task={task} onComplete={markComplete} isLast={i === goodTasks.length - 1} />
                        ))}
                      </View>
                    </>
                  )}
                </>
              )}
            </View>
          ) : (
            <View style={styles.tasksArea}>
              {groupedHistory.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="document-outline" size={32} color={Colors.textTertiary} />
                  <Text style={styles.emptyStateTitle}>No service records yet</Text>
                  <Text style={styles.emptyStateText}>Service history will appear here after tasks are logged.</Text>
                </View>
              ) : (
                <>
                  <View style={styles.historySummaryBar}>
                    <View style={styles.historySummaryStat}>
                      <Text style={styles.historySummaryValue}>
                        ${historyStats.totalSpent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Text>
                      <Text style={styles.historySummaryLabel}>total spent</Text>
                    </View>
                    <View style={styles.historySummaryDivider} />
                    <View style={styles.historySummaryStat}>
                      <Text style={styles.historySummaryValue}>{historyStats.visitCount}</Text>
                      <Text style={styles.historySummaryLabel}>
                        {historyStats.visitCount === 1 ? "service visit" : "service visits"}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.historyGroupList}>
                    {groupedHistory.map(group => (
                      <Pressable
                        key={group.name}
                        style={({ pressed }) => [styles.historyGroupCard, { opacity: pressed ? 0.8 : 1 }]}
                        onPress={() => {
                          Haptics.selectionAsync();
                          router.push(`/property-task-history/${id}?task=${encodeURIComponent(group.name)}` as any);
                        }}
                      >
                        <View style={styles.historyGroupCardLeft}>
                          <Text style={styles.historyGroupCardName}>{group.name}</Text>
                          {group.lastDate && (
                            <Text style={styles.historyGroupCardMeta}>
                              Last done: {format(parseISO(group.lastDate), "MMM d, yyyy")}
                            </Text>
                          )}
                          {group.lastProvider && (
                            <Text style={styles.historyGroupCardProvider} numberOfLines={1}>
                              {group.lastProvider}
                            </Text>
                          )}
                          <View style={styles.historyGroupCardFooter}>
                            <Text style={styles.historyGroupCardCount}>
                              {group.count === 1 ? "1 service" : `${group.count} services`}
                            </Text>
                            {group.totalCost != null && (
                              <Text style={styles.historyGroupCardTotal}>
                                ${group.totalCost.toFixed(2)} total
                              </Text>
                            )}
                          </View>
                        </View>
                        <View style={styles.historyGroupCardRight}>
                          {group.lastCost != null && (
                            <Text style={styles.historyGroupCardCost}>${group.lastCost.toFixed(2)}</Text>
                          )}
                          <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
                        </View>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function TaskRow({ task, onComplete, isLast }: { task: any; onComplete: (id: string, interval: string | null) => void; isLast: boolean }) {
  const status = getStatus(task.next_due_date, task.last_completed_at);
  const barColor = status === "overdue" ? Colors.overdue : status === "due_soon" ? Colors.dueSoon : Colors.good;
  const isCompleted = status === "good";
  const [showCompletedInfo, setShowCompletedInfo] = useState(false);

  let dueText: string;
  if (isCompleted && task.last_completed_at) {
    dueText = `Completed ${format(parseISO(task.last_completed_at), "MMM d, yyyy")}`;
  } else if (task.next_due_date) {
    dueText = `Due ${format(parseISO(task.next_due_date), "MMM d, yyyy")}`;
  } else {
    dueText = "No date set";
  }

  function handleCheckPress() {
    if (isCompleted) {
      setShowCompletedInfo(true);
      setTimeout(() => setShowCompletedInfo(false), 2500);
    } else {
      onComplete(task.id, task.interval);
    }
  }

  return (
    <View style={[styles.taskRow, !isLast && styles.taskRowDivider]}>
      <View style={[styles.taskBar, { backgroundColor: isCompleted ? barColor + "70" : barColor }]} />
      <View style={styles.taskRowContent}>
        <Text style={[styles.taskRowName, isCompleted && styles.taskRowNameDone]} numberOfLines={2}>
          {task.task}
        </Text>
        <Text style={[styles.taskRowDue, isCompleted && styles.taskRowDueDone]}>{dueText}</Text>
        {showCompletedInfo && (
          <Text style={styles.taskRowCompletedInfo}>
            Already completed. To undo, delete the entry from the History tab.
          </Text>
        )}
      </View>
      <Pressable
        style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
        onPress={handleCheckPress}
        hitSlop={8}
      >
        <Ionicons
          name={isCompleted ? "checkmark-circle" : "ellipse-outline"}
          size={22}
          color={isCompleted ? Colors.good : Colors.textTertiary}
        />
      </Pressable>
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
  headerCenter: { flex: 1, gap: 3 },
  propertyName: { fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.text, letterSpacing: -0.3 },
  propertyMeta: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  deleteBtn: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: Colors.overdueMuted,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },

  scroll: { paddingHorizontal: 20, paddingTop: 16, gap: 16 },

  addTaskBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.accent,
    borderRadius: 14,
    height: 48,
  },
  addTaskBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },

  tabs: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: Colors.accent },
  tabText: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.textTertiary },
  tabTextActive: { color: Colors.text },

  tasksArea: { gap: 10 },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  taskCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  taskRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
  },
  taskBar: { width: 4, height: 28, borderRadius: 2, flexShrink: 0 },
  taskRowContent: { flex: 1, gap: 3 },
  taskRowName: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.text },
  taskRowNameDone: { fontFamily: "Inter_400Regular", color: Colors.textTertiary, fontSize: 14 },
  taskRowDue: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  taskRowDueDone: { color: Colors.textTertiary },
  taskRowCompletedInfo: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, marginTop: 4 },

  emptyState: { alignItems: "center", paddingVertical: 40, gap: 8 },
  emptyStateTitle: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  emptyStateText: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textTertiary, textAlign: "center" },

  historySummaryBar: {
    flexDirection: "row",
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    alignItems: "center",
    justifyContent: "space-around",
  },
  historySummaryStat: { alignItems: "center", gap: 3 },
  historySummaryValue: { fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.text },
  historySummaryLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  historySummaryDivider: { width: 1, height: 36, backgroundColor: Colors.border },

  historyGroupList: { gap: 10 },
  historyGroupCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    minHeight: 44,
    gap: 12,
  },
  historyGroupCardLeft: { flex: 1, gap: 3 },
  historyGroupCardName: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.text, lineHeight: 21 },
  historyGroupCardMeta: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  historyGroupCardProvider: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  historyGroupCardFooter: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  historyGroupCardCount: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  historyGroupCardTotal: { fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.home },
  historyGroupCardRight: { alignItems: "flex-end", gap: 6, flexShrink: 0 },
  historyGroupCardCost: { fontSize: 17, fontFamily: "Inter_700Bold", color: Colors.home },
});
