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
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import { parseISO, isBefore, addDays, addMonths, format } from "date-fns";
import { SaveToast } from "@/components/SaveToast";

function getStatus(nextDueDate: string | null, lastCompletedAt: string | null): "overdue" | "due_soon" | "good" {
  const now = new Date();
  const soon = addDays(now, 30);
  if (nextDueDate) {
    const due = parseISO(nextDueDate);
    if (isBefore(due, now)) return "overdue";
    if (isBefore(due, soon)) return "due_soon";
  }
  if (!lastCompletedAt) return "due_soon";
  return "good";
}

const INTERVAL_MONTHS: Record<string, number> = {
  "Monthly": 1, "Quarterly": 3, "Bi-Annually": 6, "Annually": 12,
  "Every 2 Years": 24, "Every 5 Years": 60, "As Needed": 12,
  "3_months": 3, "6_months": 6, "12_months": 12,
  "24_months": 24, "36_months": 36, "60_months": 60,
};

export default function PropertyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"tasks" | "history">("tasks");
  const [actionNeededExpanded, setActionNeededExpanded] = useState(true);
  const [upToDateExpanded, setUpToDateExpanded] = useState(false);

  const [markCompleteTask, setMarkCompleteTask] = useState<any | null>(null);
  const [completeDate, setCompleteDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [completeCost, setCompleteCost] = useState("");
  const [completeProvider, setCompleteProvider] = useState("");
  const [completeNotes, setCompleteNotes] = useState("");
  const [completeDiy, setCompleteDiy] = useState(false);
  const [isSavingComplete, setIsSavingComplete] = useState(false);

  const [toastMsg, setToastMsg] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [toastIsError, setToastIsError] = useState(false);

  function showToast(msg: string, isError = false) {
    setToastMsg(msg);
    setToastIsError(isError);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2800);
  }

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

  const { data: logs, refetch: refetchLogs } = useQuery({
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

  function handleOpenMarkComplete(task: any) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMarkCompleteTask(task);
    setCompleteDate(format(new Date(), "yyyy-MM-dd"));
    setCompleteCost("");
    setCompleteProvider("");
    setCompleteNotes("");
    setCompleteDiy(false);
    setIsSavingComplete(false);
  }

  function handleCloseMarkComplete() {
    setMarkCompleteTask(null);
  }

  async function handleSaveMarkComplete() {
    if (!markCompleteTask || !user) return;
    const task = markCompleteTask;
    setIsSavingComplete(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const months = INTERVAL_MONTHS[task.interval] ?? 12;
    const nextDate = format(addMonths(parseISO(completeDate), months), "yyyy-MM-dd");
    const now = new Date().toISOString();
    const completedAt = new Date(completeDate + "T12:00:00").toISOString();

    queryClient.setQueryData(["property_tasks", id], (old: any[] | undefined) => {
      if (!old) return old;
      return old.map(t =>
        t.id === task.id
          ? { ...t, last_completed_at: completedAt, next_due_date: nextDate, updated_at: now }
          : t,
      );
    });

    handleCloseMarkComplete();

    try {
      const costNum = completeCost.trim() ? parseFloat(completeCost.replace(/[^0-9.]/g, "")) : null;

      const [taskRes, logRes] = await Promise.all([
        supabase
          .from("property_maintenance_tasks")
          .update({ last_completed_at: completedAt, next_due_date: nextDate, updated_at: now })
          .eq("id", task.id),
        supabase.from("maintenance_logs").insert({
          user_id: user.id,
          vehicle_id: null,
          property_id: id,
          service_name: task.task,
          service_date: completeDate,
          cost: costNum,
          mileage: null,
          provider_name: completeProvider.trim() || null,
          provider_contact: null,
          receipt_url: null,
          notes: completeNotes.trim() || null,
          did_it_myself: completeDiy,
        }),
      ]);

      if (taskRes.error || logRes.error) throw taskRes.error ?? logRes.error;

      queryClient.invalidateQueries({ queryKey: ["property_tasks", id] });
      queryClient.invalidateQueries({ queryKey: ["property_logs", id] });
      queryClient.invalidateQueries({ queryKey: ["property_task_counts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });

      showToast(`${task.task} marked complete!`);
    } catch {
      queryClient.invalidateQueries({ queryKey: ["property_tasks", id] });
      showToast("Failed to save. Please try again.", true);
    } finally {
      setIsSavingComplete(false);
    }
  }

  function handleDelete() {
    const userId = user?.id;
    Alert.alert(
      "Delete Property",
      "This will permanently delete this property and all its tasks. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

            for (const key of [["properties"], ["properties", userId]] as const) {
              queryClient.setQueryData(key, (old: any) => {
                if (!old) return old;
                if (Array.isArray(old)) return old.filter((v: any) => v.id !== id);
                if (old.data && Array.isArray(old.data)) {
                  return { ...old, data: old.data.filter((v: any) => v.id !== id) };
                }
                return old;
              });
            }

            router.replace("/(tabs)/home-tab");

            (async () => {
              try {
                await supabase.from("property_maintenance_tasks").delete().eq("property_id", id!);
                await supabase.from("maintenance_logs").delete().eq("property_id", id!);
                await supabase.from("properties").delete().eq("id", id!);
                queryClient.invalidateQueries({ queryKey: ["properties"] });
                queryClient.invalidateQueries({ queryKey: ["properties", userId] });
                queryClient.invalidateQueries({ queryKey: ["dashboard"] });
                queryClient.invalidateQueries({ queryKey: ["dashboard_counts"] });
              } catch (err: any) {
                console.warn("[DELETE] Background delete error:", err?.message ?? err);
                queryClient.invalidateQueries({ queryKey: ["properties"] });
                queryClient.invalidateQueries({ queryKey: ["properties", userId] });
              }
            })();
          },
        },
      ],
    );
  }

  const isLoading = loadingProperty || loadingTasks;
  const propertyName = property ? (property.nickname ?? property.address ?? "Property") : "Property";

  const overdueTasks = useMemo(
    () => tasks?.filter(t => getStatus(t.next_due_date, t.last_completed_at) === "overdue") ?? [],
    [tasks],
  );
  const dueSoonTasks = useMemo(
    () => tasks?.filter(t => getStatus(t.next_due_date, t.last_completed_at) === "due_soon") ?? [],
    [tasks],
  );
  const goodTasks = useMemo(
    () => tasks?.filter(t => getStatus(t.next_due_date, t.last_completed_at) === "good") ?? [],
    [tasks],
  );
  const actionNeededTasks = useMemo(() => [...overdueTasks, ...dueSoonTasks], [overdueTasks, dueSoonTasks]);

  const groupedHistory = useMemo(() => {
    if (!logs || logs.length === 0) return [];
    const map = new Map<string, any[]>();
    for (const log of logs) {
      const key = (log.service_name ?? "Service").trim();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(log);
    }
    return Array.from(map.entries())
      .map(([name, entries]) => {
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
      })
      .sort((a, b) => (b.lastDate ?? "").localeCompare(a.lastDate ?? ""));
  }, [logs]);

  const historyStats = useMemo(() => {
    if (!logs || logs.length === 0) return { totalSpent: 0, visitCount: 0 };
    return {
      totalSpent: logs.reduce((s: number, l: any) => s + (l.cost ?? 0), 0),
      visitCount: logs.length,
    };
  }, [logs]);

  const typeLabel: Record<string, string> = {
    house: "Single Family Home",
    condo: "Condo",
    apartment: "Apartment",
    townhouse: "Townhouse",
    commercial: "Commercial Building",
    vacation: "Vacation Home",
    other: "Property",
  };
  const propType = property ? (typeLabel[property.property_type ?? "other"] ?? "Property") : "";
  const metaParts: string[] = [];
  if (propType) metaParts.push(propType);
  if (property?.year_built) metaParts.push(`Built ${property.year_built}`);
  const metaLine = metaParts.join(" · ");

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const yesterdayStr = format(addDays(new Date(), -1), "yyyy-MM-dd");

  function formatDateLabel(dateStr: string) {
    if (dateStr === todayStr) return `Today  ·  ${format(parseISO(dateStr), "MMM d")}`;
    if (dateStr === yesterdayStr) return `Yesterday  ·  ${format(parseISO(dateStr), "MMM d")}`;
    return format(parseISO(dateStr), "MMM d, yyyy");
  }

  function adjustDate(days: number) {
    const current = parseISO(completeDate);
    const next = addDays(current, days);
    setCompleteDate(format(next, "yyyy-MM-dd"));
  }

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
          stickyHeaderIndices={[0]}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={() => { refetch(); refetchLogs(); }}
              tintColor={Colors.accent}
            />
          }
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        >
          <View style={{ backgroundColor: Colors.background }}>
            <View style={styles.tabs}>
              {(["tasks", "history"] as const).map(tab => (
                <Pressable
                  key={tab}
                  style={[styles.tab]}
                  onPress={() => { Haptics.selectionAsync(); setActiveTab(tab); }}
                >
                  <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                    {tab === "tasks"
                      ? (actionNeededTasks.length > 0 ? `Tasks (${actionNeededTasks.length})` : "Tasks")
                      : "History"}
                  </Text>
                  {activeTab === tab && <View style={styles.tabUnderline} />}
                </Pressable>
              ))}
            </View>
          </View>

          {activeTab === "tasks" ? (
            <View style={styles.tasksArea}>
              <Pressable
                style={({ pressed }) => [styles.addTaskBtn, { opacity: pressed ? 0.8 : 1 }]}
                onPress={() => router.push(`/add-property-task/${id}` as any)}
              >
                <Ionicons name="add" size={18} color={Colors.textInverse} />
                <Text style={styles.addTaskBtnText}>Add Task</Text>
              </Pressable>

              {(tasks?.length ?? 0) === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="home-outline" size={36} color={Colors.textTertiary} />
                  <Text style={styles.emptyStateTitle}>No maintenance tasks yet</Text>
                  <Text style={styles.emptyStateText}>
                    Add your first task to start tracking home maintenance
                  </Text>
                </View>
              ) : (
                <>
                  {actionNeededTasks.length > 0 && (
                    <TaskSection
                      title={`Action Needed (${actionNeededTasks.length})`}
                      titleColor={Colors.overdue}
                      expanded={actionNeededExpanded}
                      onToggle={() => { Haptics.selectionAsync(); setActionNeededExpanded(v => !v); }}
                      tasks={actionNeededTasks}
                      onMarkComplete={handleOpenMarkComplete}
                    />
                  )}
                  {goodTasks.length > 0 && (
                    <TaskSection
                      title={`Up to Date (${goodTasks.length})`}
                      titleColor={Colors.good}
                      expanded={upToDateExpanded}
                      onToggle={() => { Haptics.selectionAsync(); setUpToDateExpanded(v => !v); }}
                      tasks={goodTasks}
                      onMarkComplete={handleOpenMarkComplete}
                    />
                  )}
                </>
              )}
            </View>
          ) : (
            <View style={styles.tasksArea}>
              {groupedHistory.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="document-outline" size={36} color={Colors.textTertiary} />
                  <Text style={styles.emptyStateTitle}>No service records yet</Text>
                  <Text style={styles.emptyStateText}>
                    Service history will appear here after you complete tasks
                  </Text>
                </View>
              ) : (
                <>
                  <View style={styles.historySummaryBar}>
                    <View style={styles.historySummaryStat}>
                      <Text style={styles.historySummaryValue}>
                        ${historyStats.totalSpent.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </Text>
                      <Text style={styles.historySummaryLabel}>total spent</Text>
                    </View>
                    <View style={styles.historySummaryDivider} />
                    <View style={styles.historySummaryStat}>
                      <Text style={styles.historySummaryValue}>{historyStats.visitCount}</Text>
                      <Text style={styles.historySummaryLabel}>
                        {historyStats.visitCount === 1 ? "service" : "services"}
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

      <SaveToast visible={toastVisible} message={toastMsg} isError={toastIsError} />

      <Modal
        visible={markCompleteTask != null}
        transparent
        animationType="slide"
        onRequestClose={handleCloseMarkComplete}
      >
        <KeyboardAvoidingView
          style={styles.sheetOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <Pressable style={styles.sheetBackdrop} onPress={handleCloseMarkComplete} />
          <View style={[styles.sheetContainer, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>
              {markCompleteTask?.task ?? "Mark Complete"}
            </Text>

            <ScrollView
              style={styles.sheetScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.sheetFields}>
                <View style={styles.sheetField}>
                  <Text style={styles.sheetFieldLabel}>Date Completed</Text>
                  <View style={styles.dateStepper}>
                    <Pressable
                      style={({ pressed }) => [styles.dateStepBtn, { opacity: pressed ? 0.7 : 1 }]}
                      onPress={() => adjustDate(-1)}
                      hitSlop={8}
                    >
                      <Ionicons name="chevron-back" size={18} color={Colors.text} />
                    </Pressable>
                    <Text style={styles.dateStepValue}>{formatDateLabel(completeDate)}</Text>
                    <Pressable
                      style={({ pressed }) => [styles.dateStepBtn, { opacity: pressed ? 0.7 : 1 }]}
                      onPress={() => adjustDate(1)}
                      disabled={completeDate >= todayStr}
                      hitSlop={8}
                    >
                      <Ionicons
                        name="chevron-forward"
                        size={18}
                        color={completeDate >= todayStr ? Colors.textTertiary : Colors.text}
                      />
                    </Pressable>
                  </View>
                  <View style={styles.dateQuickRow}>
                    <Pressable
                      onPress={() => setCompleteDate(todayStr)}
                      style={[styles.dateQuickBtn, completeDate === todayStr && styles.dateQuickBtnActive]}
                    >
                      <Text style={[styles.dateQuickText, completeDate === todayStr && styles.dateQuickTextActive]}>
                        Today
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setCompleteDate(yesterdayStr)}
                      style={[styles.dateQuickBtn, completeDate === yesterdayStr && styles.dateQuickBtnActive]}
                    >
                      <Text style={[styles.dateQuickText, completeDate === yesterdayStr && styles.dateQuickTextActive]}>
                        Yesterday
                      </Text>
                    </Pressable>
                  </View>
                </View>

                <View style={styles.sheetField}>
                  <Text style={styles.sheetFieldLabel}>
                    Cost  <Text style={styles.sheetFieldOptional}>(optional)</Text>
                  </Text>
                  <TextInput
                    style={styles.sheetInput}
                    value={completeCost}
                    onChangeText={setCompleteCost}
                    keyboardType="decimal-pad"
                    placeholder="e.g. 150.00"
                    placeholderTextColor={Colors.textTertiary}
                  />
                </View>

                <View style={styles.sheetField}>
                  <Text style={styles.sheetFieldLabel}>
                    Provider  <Text style={styles.sheetFieldOptional}>(optional)</Text>
                  </Text>
                  <TextInput
                    style={styles.sheetInput}
                    value={completeProvider}
                    onChangeText={setCompleteProvider}
                    placeholder="e.g. ABC Heating & Cooling"
                    placeholderTextColor={Colors.textTertiary}
                  />
                </View>

                <View style={styles.sheetField}>
                  <Text style={styles.sheetFieldLabel}>
                    Notes  <Text style={styles.sheetFieldOptional}>(optional)</Text>
                  </Text>
                  <TextInput
                    style={[styles.sheetInput, styles.sheetInputMultiline]}
                    value={completeNotes}
                    onChangeText={setCompleteNotes}
                    placeholder="e.g. Replaced 4-inch filter, MERV 13"
                    placeholderTextColor={Colors.textTertiary}
                    multiline
                    numberOfLines={2}
                  />
                </View>

                <Pressable
                  onPress={() => setCompleteDiy(!completeDiy)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 }}
                >
                  <View style={{
                    width: 24, height: 24, borderRadius: 6, borderWidth: 2,
                    borderColor: completeDiy ? Colors.home : Colors.border,
                    backgroundColor: completeDiy ? Colors.home : "transparent",
                    alignItems: "center", justifyContent: "center",
                  }}>
                    {completeDiy && <Ionicons name="checkmark" size={16} color="#0C111B" />}
                  </View>
                  <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.text }}>
                    I did this myself
                  </Text>
                </Pressable>
              </View>
            </ScrollView>

            <View style={styles.sheetActions}>
              <Pressable
                style={({ pressed }) => [styles.sheetCancelBtn, { opacity: pressed ? 0.8 : 1 }]}
                onPress={handleCloseMarkComplete}
              >
                <Text style={styles.sheetCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.sheetSaveBtn, { opacity: pressed || isSavingComplete ? 0.8 : 1 }]}
                onPress={handleSaveMarkComplete}
                disabled={isSavingComplete}
              >
                {isSavingComplete ? (
                  <ActivityIndicator size="small" color={Colors.textInverse} />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={16} color={Colors.textInverse} />
                    <Text style={styles.sheetSaveText}>Mark Complete</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function TaskSection({
  title,
  titleColor,
  expanded,
  onToggle,
  tasks,
  onMarkComplete,
}: {
  title: string;
  titleColor?: string;
  expanded: boolean;
  onToggle: () => void;
  tasks: any[];
  onMarkComplete: (task: any) => void;
}) {
  return (
    <View style={styles.taskSection}>
      <Pressable style={styles.taskSectionHeader} onPress={onToggle} hitSlop={6}>
        <Text style={[styles.sectionLabel, titleColor ? { color: titleColor } : {}]}>
          {title.toUpperCase()}
        </Text>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={14} color={Colors.textTertiary} />
      </Pressable>
      {expanded && (
        <View style={styles.taskCard}>
          {tasks.map((task, i) => (
            <TaskRow
              key={task.id}
              task={task}
              onMarkComplete={onMarkComplete}
              isLast={i === tasks.length - 1}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function TaskRow({
  task,
  onMarkComplete,
  isLast,
}: {
  task: any;
  onMarkComplete: (task: any) => void;
  isLast: boolean;
}) {
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

  function handlePress() {
    if (isCompleted) {
      setShowCompletedInfo(true);
      setTimeout(() => setShowCompletedInfo(false), 2500);
    } else {
      onMarkComplete(task);
    }
  }

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.taskRow,
        !isLast && styles.taskRowDivider,
        !isCompleted && pressed && { opacity: 0.7 },
      ]}
    >
      <View style={[styles.taskBar, { backgroundColor: isCompleted ? barColor + "70" : barColor }]} />
      <View style={styles.taskRowContent}>
        <Text style={[styles.taskRowName, isCompleted && styles.taskRowNameDone]} numberOfLines={2}>
          {task.task}
        </Text>
        <Text style={[styles.taskRowDue, isCompleted && styles.taskRowDueDone]}>{dueText}</Text>
        {showCompletedInfo && (
          <Text style={styles.taskRowCompletedInfo}>
            Already completed. Check the History tab for details.
          </Text>
        )}
      </View>
      {!isCompleted && (
        <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
      )}
    </Pressable>
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

  tabs: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: Colors.border },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center", position: "relative" as const },
  tabText: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.textTertiary },
  tabTextActive: { color: Colors.text, fontFamily: "Inter_600SemiBold" },
  tabUnderline: {
    position: "absolute" as const,
    bottom: -1,
    left: "20%",
    right: "20%",
    height: 2,
    backgroundColor: Colors.accent,
    borderRadius: 1,
  },

  tasksArea: { gap: 12 },
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

  taskSection: { gap: 0 },
  taskSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
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
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  taskRowDivider: { borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  taskBar: { width: 4, height: 28, borderRadius: 2, flexShrink: 0 },
  taskRowContent: { flex: 1, gap: 3 },
  taskRowName: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.text },
  taskRowNameDone: { fontFamily: "Inter_400Regular", color: Colors.textTertiary, fontSize: 14 },
  taskRowDue: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  taskRowDueDone: { color: Colors.textTertiary },
  taskRowCompletedInfo: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    marginTop: 4,
  },

  emptyState: { alignItems: "center", paddingVertical: 40, gap: 8 },
  emptyStateTitle: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  emptyStateText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textTertiary,
    textAlign: "center",
    paddingHorizontal: 20,
  },

  historySummaryBar: {
    flexDirection: "row",
    backgroundColor: Colors.card,
    borderRadius: 14,
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
    borderRadius: 14,
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

  sheetOverlay: { flex: 1, justifyContent: "flex-end" },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)" },
  sheetContainer: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: Colors.border,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: "center",
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
    marginBottom: 20,
    textAlign: "center",
  },
  sheetScroll: { maxHeight: 400 },
  sheetFields: { gap: 16 },
  sheetField: { gap: 6 },
  sheetFieldLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  sheetFieldOptional: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.textTertiary,
    textTransform: "none",
    letterSpacing: 0,
  },
  sheetInput: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sheetInputMultiline: { minHeight: 64, textAlignVertical: "top" },
  dateStepper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  dateStepBtn: { width: 44, height: 46, alignItems: "center", justifyContent: "center" },
  dateStepValue: {
    flex: 1,
    textAlign: "center",
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    color: Colors.text,
  },
  dateQuickRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  dateQuickBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
  },
  dateQuickBtnActive: { backgroundColor: Colors.homeMuted, borderColor: Colors.home },
  dateQuickText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  dateQuickTextActive: { color: Colors.home, fontFamily: "Inter_600SemiBold" },
  sheetActions: { flexDirection: "row", gap: 10, marginTop: 24 },
  sheetCancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 13,
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sheetCancelText: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  sheetSaveBtn: {
    flex: 2,
    paddingVertical: 13,
    borderRadius: 13,
    backgroundColor: Colors.home,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  sheetSaveText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
});
