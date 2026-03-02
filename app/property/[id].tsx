import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import * as Haptics from "expo-haptics";
import { parseISO, isBefore, addDays, differenceInDays, format } from "date-fns";

function getStatus(date: string | null) {
  if (!date) return "good";
  const d = parseISO(date);
  if (isBefore(d, new Date())) return "overdue";
  if (isBefore(d, addDays(new Date(), 30))) return "due_soon";
  return "good";
}

export default function PropertyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

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
      const { data } = await supabase.from("property_maintenance_tasks").select("*").eq("property_id", id!).order("next_due_date", { ascending: true });
      return data ?? [];
    },
    enabled: !!id,
  });

  const { data: logs } = useQuery({
    queryKey: ["property_logs", id],
    queryFn: async () => {
      const { data } = await supabase.from("maintenance_logs").select("*").eq("property_id", id!).order("service_date", { ascending: false });
      return data ?? [];
    },
    enabled: !!id,
  });

  const [activeTab, setActiveTab] = useState<"tasks" | "history">("tasks");

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
  }

  const isLoading = loadingProperty || loadingTasks;
  const propertyName = property ? (property.nickname ?? property.address ?? "Property") : "Property";
  const overdue = tasks?.filter(t => getStatus(t.next_due_date) === "overdue") ?? [];
  const dueSoon = tasks?.filter(t => getStatus(t.next_due_date) === "due_soon") ?? [];
  const good = tasks?.filter(t => getStatus(t.next_due_date) === "good") ?? [];

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{propertyName}</Text>
        <Pressable style={styles.addBtn} onPress={() => router.push(`/add-property-task/${id}` as any)}>
          <Ionicons name="add" size={20} color={Colors.home} />
        </Pressable>
      </View>

      {isLoading ? <ActivityIndicator color={Colors.accent} style={{ marginTop: 60 }} /> : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={Colors.accent} />}
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        >
          <View style={styles.propCard}>
            <View style={styles.propCardTop}>
              <View style={styles.propIcon}>
                <Ionicons name="home-outline" size={28} color={Colors.home} />
              </View>
              <View style={styles.propInfo}>
                {property?.nickname && <Text style={styles.propName}>{property.nickname}</Text>}
                {property?.address && <Text style={[styles.propAddress, !property.nickname && styles.propName]}>{property.address}</Text>}
              </View>
            </View>
            <View style={styles.propMeta}>
              {property?.property_type && <MetaChip icon="pricetag-outline" label={property.property_type} />}
              {property?.year_built && <MetaChip icon="calendar-outline" label={`Built ${property.year_built}`} />}
              {property?.square_footage && <MetaChip icon="resize-outline" label={`${property.square_footage.toLocaleString()} sqft`} />}
            </View>
            <View style={styles.summaryRow}>
              {overdue.length > 0 && <SummaryBadge count={overdue.length} label="overdue" color={Colors.overdue} />}
              {dueSoon.length > 0 && <SummaryBadge count={dueSoon.length} label="due soon" color={Colors.dueSoon} />}
              {overdue.length === 0 && dueSoon.length === 0 && tasks && tasks.length > 0 && (
                <SummaryBadge count={tasks.length} label="all good" color={Colors.good} />
              )}
            </View>
          </View>

          <View style={styles.tabs}>
            {(["tasks", "history"] as const).map(tab => (
              <Pressable key={tab} style={[styles.tab, activeTab === tab && styles.tabActive]} onPress={() => { Haptics.selectionAsync(); setActiveTab(tab); }}>
                <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab === "tasks" ? "Maintenance Tasks" : "Service History"}</Text>
              </Pressable>
            ))}
          </View>

          {activeTab === "tasks" ? (
            <View style={styles.tasksArea}>
              {tasks?.length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons name="list-outline" size={36} color={Colors.textTertiary} />
                  <Text style={styles.emptyText}>No tasks yet</Text>
                  <Pressable style={({ pressed }) => [styles.addTaskBtn, { opacity: pressed ? 0.8 : 1 }]} onPress={() => router.push(`/add-property-task/${id}` as any)}>
                    <Ionicons name="add" size={16} color={Colors.textInverse} />
                    <Text style={styles.addTaskBtnText}>Add Task</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  {overdue.length > 0 && <TaskGroup title="Overdue" color={Colors.overdue} tasks={overdue} onComplete={markComplete} />}
                  {dueSoon.length > 0 && <TaskGroup title="Due Soon" color={Colors.dueSoon} tasks={dueSoon} onComplete={markComplete} />}
                  {good.length > 0 && <TaskGroup title="Up to Date" color={Colors.good} tasks={good} onComplete={markComplete} />}
                </>
              )}
            </View>
          ) : (
            <View style={styles.tasksArea}>
              {logs?.length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons name="document-outline" size={36} color={Colors.textTertiary} />
                  <Text style={styles.emptyText}>No service records yet</Text>
                </View>
              ) : (
                logs?.map(log => (
                  <View key={log.id} style={styles.logCard}>
                    <View style={styles.logTop}>
                      <Text style={styles.logTask}>{log.service_name ?? "Service"}</Text>
                      {log.cost != null && <Text style={styles.logCost}>${log.cost.toFixed(2)}</Text>}
                    </View>
                    <View style={styles.logMeta}>
                      {log.service_date && <Text style={styles.logDate}>{format(parseISO(log.service_date), "MMM d, yyyy")}</Text>}
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

function MetaChip({ icon, label }: { icon: any; label: string }) {
  return (
    <View style={styles.metaChip}>
      <Ionicons name={icon} size={12} color={Colors.textTertiary} />
      <Text style={styles.metaChipText}>{label}</Text>
    </View>
  );
}

function SummaryBadge({ count, label, color }: { count: number; label: string; color: string }) {
  return (
    <View style={[styles.summaryBadge, { backgroundColor: color + "22" }]}>
      <Text style={[styles.summaryBadgeText, { color }]}>{count} {label}</Text>
    </View>
  );
}

function TaskGroup({ title, color, tasks, onComplete }: { title: string; color: string; tasks: any[]; onComplete: (id: string, interval: string | null) => void }) {
  return (
    <View style={styles.taskGroup}>
      <View style={styles.taskGroupHeader}>
        <View style={[styles.taskGroupDot, { backgroundColor: color }]} />
        <Text style={[styles.taskGroupTitle, { color }]}>{title}</Text>
      </View>
      {tasks.map(task => {
        const statusColor = color;
        const daysLeft = task.next_due_date ? differenceInDays(parseISO(task.next_due_date), new Date()) : null;
        return (
          <View key={task.id} style={styles.taskCard}>
            <View style={styles.taskLeft}>
              <Text style={styles.taskName}>{task.task}</Text>
              <View style={styles.taskMeta}>
                {task.next_due_date && (
                  <Text style={[styles.taskDue, { color: statusColor }]}>
                    {daysLeft !== null && daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : daysLeft === 0 ? "Today" : daysLeft != null ? `${daysLeft}d` : ""}
                  </Text>
                )}
                {task.category && <Text style={styles.taskCat}>{task.category}</Text>}
                {task.estimated_cost && <Text style={styles.taskCost}>~${task.estimated_cost}</Text>}
              </View>
            </View>
            <Pressable style={({ pressed }) => [styles.doneBtn, { opacity: pressed ? 0.7 : 1 }]} onPress={() => onComplete(task.id, task.interval)}>
              <Ionicons name="checkmark" size={18} color={Colors.good} />
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  backBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text, textAlign: "center" },
  addBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center", backgroundColor: Colors.homeMuted, borderRadius: 10 },
  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 16 },
  propCard: { backgroundColor: Colors.card, borderRadius: 16, padding: 16, gap: 10, borderWidth: 1, borderColor: Colors.border },
  propCardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  propIcon: { width: 52, height: 52, borderRadius: 14, backgroundColor: Colors.homeMuted, alignItems: "center", justifyContent: "center" },
  propInfo: { flex: 1 },
  propName: { fontSize: 18, fontFamily: "Inter_600SemiBold", color: Colors.text },
  propAddress: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  propMeta: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.surface, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  metaChipText: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary, textTransform: "capitalize" },
  summaryRow: { flexDirection: "row", gap: 8 },
  summaryBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  summaryBadgeText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  tabs: { flexDirection: "row", backgroundColor: Colors.card, borderRadius: 12, padding: 4, borderWidth: 1, borderColor: Colors.border },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  tabActive: { backgroundColor: Colors.homeMuted },
  tabText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  tabTextActive: { color: Colors.home, fontFamily: "Inter_600SemiBold" },
  tasksArea: { gap: 12 },
  taskGroup: { gap: 8 },
  taskGroupHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  taskGroupDot: { width: 6, height: 6, borderRadius: 3 },
  taskGroupTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8 },
  taskCard: { flexDirection: "row", alignItems: "center", backgroundColor: Colors.card, borderRadius: 12, padding: 12, gap: 12, borderWidth: 1, borderColor: Colors.border },
  taskLeft: { flex: 1 },
  taskName: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.text },
  taskMeta: { flexDirection: "row", gap: 8, marginTop: 3 },
  taskDue: { fontSize: 12, fontFamily: "Inter_500Medium" },
  taskCat: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  taskCost: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  doneBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.goodMuted, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", paddingVertical: 32, gap: 8 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  addTaskBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: Colors.home, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10, marginTop: 4 },
  addTaskBtnText: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.textInverse },
  logCard: { backgroundColor: Colors.card, borderRadius: 12, padding: 14, gap: 8, borderWidth: 1, borderColor: Colors.border },
  logTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  logTask: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.text, flex: 1 },
  logCost: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.accent },
  logMeta: { flexDirection: "row", gap: 10 },
  logDate: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  logProvider: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  logNotes: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, fontStyle: "italic" },
});
