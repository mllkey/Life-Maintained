import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Share,
  Platform,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import * as Haptics from "expo-haptics";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";
import { parseISO, isBefore, addDays, format, differenceInDays } from "date-fns";

function getStatus(date: string | null) {
  if (!date) return "good";
  const d = parseISO(date);
  if (isBefore(d, new Date())) return "overdue";
  if (isBefore(d, addDays(new Date(), 30))) return "due_soon";
  return "good";
}

export default function VehicleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"tasks" | "history">("tasks");
  const [isExporting, setIsExporting] = useState(false);

  const { data: vehicle, isLoading: loadingVehicle } = useQuery({
    queryKey: ["vehicle", id],
    queryFn: async () => {
      const { data } = await supabase.from("vehicles").select("*").eq("id", id).single();
      return data;
    },
  });

  const { data: tasks, isLoading: loadingTasks, refetch } = useQuery({
    queryKey: ["vehicle_tasks", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("vehicle_maintenance_tasks")
        .select("*")
        .eq("vehicle_id", id)
        .order("next_due_date", { ascending: true });
      return data ?? [];
    },
  });

  const { data: logs } = useQuery({
    queryKey: ["maintenance_logs", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("maintenance_logs")
        .select("*")
        .eq("vehicle_id", id)
        .order("service_date", { ascending: false });
      return data ?? [];
    },
  });

  async function markComplete(taskId: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const task = tasks?.find(t => t.id === taskId);
    if (!task) return;

    let nextDate: string | null = null;
    if (task.interval) {
      const next = new Date();
      next.setDate(next.getDate() + task.interval);
      nextDate = next.toISOString().split("T")[0];
    }

    await supabase.from("vehicle_maintenance_tasks").update({
      last_completed_at: new Date().toISOString(),
      next_due_date: nextDate,
      last_service_mileage: vehicle?.mileage,
      updated_at: new Date().toISOString(),
    }).eq("id", taskId);

    queryClient.invalidateQueries({ queryKey: ["vehicle_tasks", id] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  }

  function buildCsv(logsData: any[]) {
    const header = "Date,Service,Mileage,Cost,Provider,Notes";
    const rows = logsData.map(log => {
      const date = log.service_date ?? "";
      const task = (log.service_name ?? "").replace(/,/g, ";");
      const mileage = log.mileage ?? "";
      const cost = log.cost != null ? `$${log.cost.toFixed(2)}` : "";
      const provider = (log.provider_name ?? "").replace(/,/g, ";");
      const notes = (log.notes ?? "").replace(/,/g, ";").replace(/\n/g, " ");
      return `${date},${task},${mileage},${cost},${provider},${notes}`;
    });
    return [header, ...rows].join("\n");
  }

  function buildHtml(logsData: any[], vehicleData: any) {
    const name = vehicleData?.nickname ?? `${vehicleData?.year} ${vehicleData?.make} ${vehicleData?.model}`;
    const rows = logsData.map(log => `
      <tr>
        <td>${log.service_date ? format(parseISO(log.service_date), "MMM d, yyyy") : "—"}</td>
        <td>${log.service_name ?? "Service"}</td>
        <td>${log.mileage != null ? log.mileage.toLocaleString() + " mi" : "—"}</td>
        <td>${log.cost != null ? "$" + log.cost.toFixed(2) : "—"}</td>
        <td>${log.provider_name ?? "—"}</td>
        <td>${log.notes ?? ""}</td>
      </tr>`).join("");

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Service History</title>
    <style>
      body { font-family: -apple-system, Helvetica, sans-serif; padding: 32px; color: #111; }
      h1 { font-size: 22px; margin-bottom: 4px; }
      .sub { color: #666; font-size: 14px; margin-bottom: 24px; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th { background: #f0f0f0; text-align: left; padding: 8px 10px; border-bottom: 2px solid #ddd; }
      td { padding: 8px 10px; border-bottom: 1px solid #eee; vertical-align: top; }
      tr:nth-child(even) td { background: #fafafa; }
      .footer { margin-top: 24px; font-size: 12px; color: #999; }
    </style></head><body>
    <h1>Service History — ${name}</h1>
    <div class="sub">Exported from LifeMaintained · ${format(new Date(), "MMMM d, yyyy")}</div>
    <table>
      <thead><tr><th>Date</th><th>Service</th><th>Mileage</th><th>Cost</th><th>Provider</th><th>Notes</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="footer">Generated by LifeMaintained · lifemaintained.app</div>
    </body></html>`;
  }

  async function exportHistory(format: "pdf" | "csv") {
    if (!logs || logs.length === 0) {
      Alert.alert("No Records", "There are no service records to export.");
      return;
    }
    setIsExporting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      if (format === "pdf") {
        const html = buildHtml(logs, vehicle);
        const { uri } = await Print.printToFileAsync({ html });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
        } else {
          Alert.alert("PDF Saved", `Saved to: ${uri}`);
        }
      } else {
        const csv = buildCsv(logs);
        const vehicleName = vehicle?.nickname ?? `${vehicle?.year}_${vehicle?.make}_${vehicle?.model}`;
        const fileName = `${vehicleName.replace(/\s+/g, "_")}_service_history.csv`;
        const fileUri = FileSystem.documentDirectory + fileName;
        await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri, { mimeType: "text/csv", UTI: "public.comma-separated-values-text" });
        } else {
          Alert.alert("CSV Saved", `Saved to: ${fileUri}`);
        }
      }
    } catch (e: any) {
      Alert.alert("Export Failed", e.message ?? "Something went wrong");
    } finally {
      setIsExporting(false);
    }
  }

  function handleExport() {
    Alert.alert("Export Service History", "Choose a format for resale documentation", [
      { text: "PDF", onPress: () => exportHistory("pdf") },
      { text: "CSV", onPress: () => exportHistory("csv") },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  const isLoading = loadingVehicle || loadingTasks;
  const vehicleName = vehicle ? (vehicle.nickname ?? `${vehicle.year} ${vehicle.make} ${vehicle.model}`) : "Vehicle";

  const overdue = tasks?.filter(t => getStatus(t.next_due_date) === "overdue") ?? [];
  const dueSoon = tasks?.filter(t => getStatus(t.next_due_date) === "due_soon") ?? [];
  const good = tasks?.filter(t => getStatus(t.next_due_date) === "good") ?? [];

  const groupedHistory = useMemo(() => {
    if (!logs || logs.length === 0) return [];
    const map = new Map<string, any[]>();
    for (const log of logs) {
      const key = (log.service_name ?? "Other Service").trim();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(log);
    }
    const groups = Array.from(map.entries()).map(([name, entries]) => {
      const sorted = [...entries].sort((a, b) => {
        if (!a.service_date) return 1;
        if (!b.service_date) return -1;
        return b.service_date.localeCompare(a.service_date);
      });
      const hasCost = sorted.some(e => e.cost != null);
      const totalCost = hasCost ? sorted.reduce((sum, e) => sum + (e.cost ?? 0), 0) : null;
      return { name, entries: sorted, totalCost, count: sorted.length };
    });
    return groups.sort((a, b) => {
      const aDate = a.entries[0]?.service_date ?? "";
      const bDate = b.entries[0]?.service_date ?? "";
      return bDate.localeCompare(aDate);
    });
  }, [logs]);

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={6}>
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{vehicleName}</Text>
          {vehicle?.trim && (
            <Text style={styles.headerTrim} numberOfLines={1}>{vehicle.trim}</Text>
          )}
          {vehicle?.mileage != null && (
            <View style={styles.headerMileageRow}>
              <Ionicons name="speedometer-outline" size={11} color={Colors.textTertiary} />
              <Text style={styles.headerMileage}>{vehicle.mileage.toLocaleString()} mi</Text>
            </View>
          )}
        </View>
        <Pressable
          style={({ pressed }) => [styles.logBtn, { opacity: pressed ? 0.8 : 1 }]}
          onPress={() => router.push(`/log-service/${id}` as any)}
        >
          <Ionicons name="construct-outline" size={14} color={Colors.vehicle} />
          <Text style={styles.logBtnText}>Log Service</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <ActivityIndicator color={Colors.accent} style={{ marginTop: 60 }} />
      ) : vehicle ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={Colors.accent} />}
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        >
          <View style={styles.vehicleCard}>
            <View style={styles.vehicleCardLeft}>
              <View style={styles.vehicleIconBig}>
                <Ionicons name="car-outline" size={32} color={Colors.vehicle} />
              </View>
              <View>
                <Text style={styles.vehicleFullName}>{vehicle.year} {vehicle.make} {vehicle.model}</Text>
                {vehicle.trim && <Text style={styles.vehicleTrim}>{vehicle.trim}</Text>}
              </View>
            </View>
            <View style={styles.vehicleStats}>
              {vehicle.mileage != null && (
                <View style={styles.statBox}>
                  <Text style={styles.statValue}>{vehicle.mileage.toLocaleString()}</Text>
                  <Text style={styles.statLabel}>miles</Text>
                </View>
              )}
              <View style={styles.statBox}>
                <Text style={[styles.statValue, { color: overdue.length > 0 ? Colors.overdue : dueSoon.length > 0 ? Colors.dueSoon : Colors.good }]}>
                  {overdue.length + dueSoon.length}
                </Text>
                <Text style={styles.statLabel}>need attention</Text>
              </View>
            </View>

            <View style={styles.vehicleActions}>
              <Pressable
                style={({ pressed }) => [styles.vehicleActionBtn, { opacity: pressed ? 0.8 : 1 }]}
                onPress={() => router.push(`/update-mileage/${id}` as any)}
              >
                <Ionicons name="speedometer-outline" size={14} color={Colors.textSecondary} />
                <Text style={styles.vehicleActionText}>Update Mileage</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.vehicleActionBtnAccent, { opacity: pressed ? 0.8 : 1 }]}
                onPress={() => router.push(`/log-service/${id}` as any)}
              >
                <Ionicons name="construct-outline" size={14} color={Colors.textInverse} />
                <Text style={styles.vehicleActionTextAccent}>Log Service</Text>
              </Pressable>
            </View>
          </View>

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
            <View style={styles.tasksContainer}>
              {tasks?.length === 0 ? (
                <View style={styles.emptyTasks}>
                  <Ionicons name="checkmark-circle-outline" size={36} color={Colors.good} />
                  <Text style={styles.emptyTasksText}>No maintenance tasks yet</Text>
                </View>
              ) : (
                <>
                  {overdue.length > 0 && <TaskGroup title="Overdue" color={Colors.overdue} tasks={overdue} onComplete={markComplete} vehicle={vehicle} />}
                  {dueSoon.length > 0 && <TaskGroup title="Due Soon" color={Colors.dueSoon} tasks={dueSoon} onComplete={markComplete} vehicle={vehicle} />}
                  {good.length > 0 && <TaskGroup title="Up to Date" color={Colors.good} tasks={good} onComplete={markComplete} vehicle={vehicle} />}
                </>
              )}
            </View>
          ) : (
            <View style={styles.historyContainer}>
              {groupedHistory.length === 0 ? (
                <View style={styles.emptyTasks}>
                  <Ionicons name="document-outline" size={36} color={Colors.textTertiary} />
                  <Text style={styles.emptyTasksText}>No service records yet</Text>
                  <Text style={styles.emptyTasksSubtext}>Tap the + button to log your first service</Text>
                </View>
              ) : (
                <>
                  {groupedHistory.map(group => (
                    <ServiceHistoryGroup key={group.name} group={group} />
                  ))}
                  <Pressable
                    style={({ pressed }) => [styles.exportBtn, { opacity: pressed ? 0.8 : 1 }]}
                    onPress={handleExport}
                    disabled={isExporting}
                  >
                    {isExporting ? (
                      <ActivityIndicator size="small" color={Colors.textInverse} />
                    ) : (
                      <>
                        <Ionicons name="share-outline" size={16} color={Colors.textInverse} />
                        <Text style={styles.exportBtnText}>Export History</Text>
                      </>
                    )}
                  </Pressable>
                </>
              )}
            </View>
          )}
        </ScrollView>
      ) : null}
    </View>
  );
}

function TaskGroup({ title, color, tasks, onComplete, vehicle }: {
  title: string;
  color: string;
  tasks: any[];
  onComplete: (id: string) => void;
  vehicle: any;
}) {
  return (
    <View style={styles.taskGroup}>
      <View style={styles.taskGroupHeader}>
        <View style={[styles.taskGroupDot, { backgroundColor: color }]} />
        <Text style={[styles.taskGroupTitle, { color }]}>{title}</Text>
      </View>
      {tasks.map(task => {
        const status = getStatus(task.next_due_date);
        const statusColor = status === "overdue" ? Colors.overdue : status === "due_soon" ? Colors.dueSoon : Colors.good;
        const daysLeft = task.next_due_date ? differenceInDays(parseISO(task.next_due_date), new Date()) : null;
        return (
          <View key={task.id} style={styles.taskCard}>
            <View style={styles.taskCardLeft}>
              <Text style={styles.taskName}>{task.task}</Text>
              <View style={styles.taskMeta}>
                {task.next_due_date && (
                  <Text style={[styles.taskDue, { color: statusColor }]}>
                    {daysLeft !== null && daysLeft < 0
                      ? `${Math.abs(daysLeft)} days overdue`
                      : daysLeft === 0 ? "Due today"
                      : daysLeft != null ? `In ${daysLeft} days`
                      : format(parseISO(task.next_due_date), "MMM d, yyyy")}
                  </Text>
                )}
                {task.mileage_interval && vehicle?.mileage != null && (
                  <Text style={styles.taskInterval}>{task.mileage_interval.toLocaleString()} mi interval</Text>
                )}
                {task.estimated_cost && (
                  <Text style={styles.taskCost}>~${task.estimated_cost}</Text>
                )}
              </View>
            </View>
            <Pressable
              style={({ pressed }) => [styles.completeBtn, { opacity: pressed ? 0.7 : 1 }]}
              onPress={() => onComplete(task.id)}
            >
              <Ionicons name="checkmark" size={18} color={Colors.good} />
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

function ServiceHistoryGroup({ group }: { group: { name: string; entries: any[]; totalCost: number | null; count: number } }) {
  const subtitle = [
    group.count === 1 ? "1 service" : `${group.count} services`,
    group.totalCost != null ? `$${group.totalCost.toFixed(2)} total` : null,
  ].filter(Boolean).join("  ·  ");

  return (
    <View style={styles.historyGroup}>
      <View style={styles.historyGroupHeader}>
        <View style={styles.historyGroupHeaderLeft}>
          <Text style={styles.historyGroupName}>{group.name}</Text>
          <Text style={styles.historyGroupMeta}>{subtitle}</Text>
        </View>
      </View>
      <View style={styles.historyGroupCards}>
        {group.entries.map((log, idx) => (
          <ServiceLogCard key={log.id} log={log} isLast={idx === group.entries.length - 1} />
        ))}
      </View>
    </View>
  );
}

function ServiceLogCard({ log, isLast }: { log: any; isLast: boolean }) {
  const formattedDate = log.service_date
    ? format(parseISO(log.service_date), "MMMM d, yyyy")
    : null;
  const formattedMileage = log.mileage != null
    ? `${log.mileage.toLocaleString()} miles`
    : null;

  return (
    <View style={[styles.serviceCard, !isLast && styles.serviceCardBorder]}>
      <View style={styles.serviceCardTop}>
        <Text style={styles.serviceCardName} numberOfLines={2}>{log.service_name ?? "Service"}</Text>
        <View style={styles.serviceCardTopRight}>
          {log.receipt_url && (
            <Ionicons name="receipt-outline" size={14} color={Colors.textTertiary} style={{ marginRight: 6 }} />
          )}
          {log.cost != null && (
            <Text style={styles.serviceCardCost}>${log.cost.toFixed(2)}</Text>
          )}
        </View>
      </View>

      <View style={styles.serviceCardMetaRow}>
        {formattedDate && (
          <View style={styles.serviceCardMetaPill}>
            <Ionicons name="calendar-outline" size={11} color={Colors.textTertiary} />
            <Text style={styles.serviceCardMetaText}>{formattedDate}</Text>
          </View>
        )}
        {formattedMileage && (
          <View style={styles.serviceCardMetaPill}>
            <Ionicons name="speedometer-outline" size={11} color={Colors.textTertiary} />
            <Text style={styles.serviceCardMetaText}>{formattedMileage}</Text>
          </View>
        )}
      </View>

      {log.provider_name && (
        <View style={styles.serviceCardProviderRow}>
          <Ionicons name="storefront-outline" size={12} color={Colors.textSecondary} />
          <Text style={styles.serviceCardProvider}>{log.provider_name}</Text>
        </View>
      )}

      {log.notes ? (
        <Text style={styles.serviceCardNotes} numberOfLines={3}>{log.notes}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 8,
  },
  backBtn: { width: 40, height: 44, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  headerCenter: { flex: 1, alignItems: "center", gap: 1 },
  headerTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.text, textAlign: "center" },
  headerTrim: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center" },
  headerMileageRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 1 },
  headerMileage: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  logBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: Colors.vehicleMuted,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 36,
    flexShrink: 0,
  },
  logBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.vehicle },
  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 16 },
  vehicleCard: { backgroundColor: Colors.card, borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: Colors.border },
  vehicleCardLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  vehicleIconBig: { width: 56, height: 56, borderRadius: 16, backgroundColor: Colors.vehicleMuted, alignItems: "center", justifyContent: "center" },
  vehicleFullName: { fontSize: 18, fontFamily: "Inter_600SemiBold", color: Colors.text },
  vehicleTrim: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  vehicleStats: { flexDirection: "row", gap: 12 },
  statBox: { flex: 1, backgroundColor: Colors.surface, borderRadius: 12, padding: 12, alignItems: "center" },
  statValue: { fontSize: 20, fontFamily: "Inter_700Bold", color: Colors.text },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  vehicleActions: { flexDirection: "row", gap: 8 },
  vehicleActionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: Colors.surface, borderRadius: 10, paddingVertical: 9, borderWidth: 1, borderColor: Colors.border },
  vehicleActionText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  vehicleActionBtnAccent: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: Colors.vehicle, borderRadius: 10, paddingVertical: 9 },
  vehicleActionTextAccent: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textInverse },
  tabs: { flexDirection: "row", backgroundColor: Colors.card, borderRadius: 12, padding: 4, borderWidth: 1, borderColor: Colors.border },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  tabActive: { backgroundColor: Colors.vehicleMuted },
  tabText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  tabTextActive: { color: Colors.vehicle, fontFamily: "Inter_600SemiBold" },
  tasksContainer: { gap: 12 },
  taskGroup: { gap: 8 },
  taskGroupHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  taskGroupDot: { width: 6, height: 6, borderRadius: 3 },
  taskGroupTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8 },
  taskCard: { flexDirection: "row", alignItems: "center", backgroundColor: Colors.card, borderRadius: 12, padding: 12, gap: 12, borderWidth: 1, borderColor: Colors.border },
  taskCardLeft: { flex: 1 },
  taskName: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.text },
  taskMeta: { flexDirection: "row", gap: 8, marginTop: 3, flexWrap: "wrap" },
  taskDue: { fontSize: 12, fontFamily: "Inter_500Medium" },
  taskInterval: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  taskCost: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  completeBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.goodMuted, alignItems: "center", justifyContent: "center" },
  emptyTasks: { alignItems: "center", paddingVertical: 32, gap: 8 },
  emptyTasksText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  exportBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.vehicle,
    borderRadius: 12,
    paddingVertical: 11,
  },
  exportBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  emptyTasksSubtext: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textTertiary, textAlign: "center" },
  historyContainer: { gap: 20 },
  historyGroup: { gap: 0 },
  historyGroupHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    marginBottom: 2,
  },
  historyGroupHeaderLeft: { gap: 2 },
  historyGroupName: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.text },
  historyGroupMeta: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  historyGroupCards: { backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, overflow: "hidden" },
  serviceCard: { paddingHorizontal: 16, paddingVertical: 14, gap: 7 },
  serviceCardBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  serviceCardTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  serviceCardTopRight: { flexDirection: "row", alignItems: "center", flexShrink: 0 },
  serviceCardName: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text, flex: 1, lineHeight: 22 },
  serviceCardCost: { fontSize: 17, fontFamily: "Inter_700Bold", color: Colors.vehicle },
  serviceCardMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  serviceCardMetaPill: { flexDirection: "row", alignItems: "center", gap: 4 },
  serviceCardMetaText: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  serviceCardProviderRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 1 },
  serviceCardProvider: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  serviceCardNotes: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textTertiary, lineHeight: 18, marginTop: 2, fontStyle: "italic" },
});
