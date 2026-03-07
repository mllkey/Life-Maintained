import React, { useState, useMemo, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  TextInput,
  KeyboardAvoidingView,
} from "react-native";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import * as Haptics from "expo-haptics";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";
import { parseISO, isBefore, addDays, addMonths, format, differenceInDays } from "date-fns";
import { useAuth } from "@/context/AuthContext";
import Paywall from "@/components/Paywall";
import { hasPersonalOrAbove } from "@/lib/subscription";
import { SaveToast } from "@/components/SaveToast";

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  engine:     { bg: Colors.blueMuted,      text: Colors.blue },
  brakes:     { bg: Colors.overdueMuted,   text: Colors.overdue },
  fluids:     { bg: Colors.accentMuted,    text: Colors.accent },
  electrical: { bg: Colors.dueSoonMuted,   text: Colors.dueSoon },
  tires:      { bg: Colors.surface,        text: Colors.textSecondary },
  body:       { bg: Colors.goodMuted,      text: Colors.good },
  drivetrain: { bg: Colors.vehicleMuted,   text: Colors.vehicle },
};

const STATUS_BORDER: Record<string, string> = {
  upcoming:  Colors.border,
  due_soon:  Colors.dueSoon,
  overdue:   Colors.overdue,
  completed: Colors.good,
};

function calcStatus(
  task: any,
  vehicleMileage: number,
): "overdue" | "due_soon" | "upcoming" | "completed" {
  if (task.status === "completed") return "completed";
  const today = new Date();
  const dueDate = task.next_due_date ? parseISO(task.next_due_date) : null;
  const dueMiles: number | null = task.next_due_miles ?? null;
  if (
    (dueMiles != null && vehicleMileage >= dueMiles) ||
    (dueDate != null && dueDate <= today)
  ) return "overdue";
  if (
    (dueMiles != null && dueMiles - vehicleMileage <= 500) ||
    (dueDate != null && differenceInDays(dueDate, today) <= 30)
  ) return "due_soon";
  return "upcoming";
}

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
  const { profile, user } = useAuth();
  const [activeTab, setActiveTab] = useState<"tasks" | "schedule" | "history">("tasks");
  const [isExporting, setIsExporting] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [isDeletingVehicle, setIsDeletingVehicle] = useState(false);
  const [scheduleRefreshing, setScheduleRefreshing] = useState(false);
  const [actionNeededExpanded, setActionNeededExpanded] = useState(true);
  const [upcomingExpanded, setUpcomingExpanded] = useState(true);
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [generatingSchedule, setGeneratingSchedule] = useState(false);
  const [scheduleToast, setScheduleToast] = useState("");
  const [showScheduleToast, setShowScheduleToast] = useState(false);
  const lastStatusHashRef = useRef("");

  const [markCompleteTask, setMarkCompleteTask] = useState<any | null>(null);
  const [completeMileage, setCompleteMileage] = useState("");
  const [completeDate, setCompleteDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [completeNotes, setCompleteNotes] = useState("");
  const [isSavingComplete, setIsSavingComplete] = useState(false);

  const { data: vehicle, isLoading: loadingVehicle } = useQuery({
    queryKey: ["vehicle", id],
    queryFn: async () => {
      const { data } = await supabase.from("vehicles").select("*").eq("id", id).single();
      return data;
    },
  });

  const { data: tasks, isLoading: loadingTasks, refetch: refetchTasks } = useQuery({
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

  const {
    data: scheduleTasks,
    isLoading: loadingSchedule,
    error: scheduleError,
    refetch: refetchSchedule,
  } = useQuery({
    queryKey: ["user_vehicle_maintenance_tasks", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_vehicle_maintenance_tasks")
        .select("*")
        .eq("vehicle_id", id)
        .eq("user_id", user!.id)
        .order("next_due_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user && !!id,
  });

  const { data: logs, refetch: refetchLogs } = useQuery({
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

  const processedScheduleTasks = useMemo(() => {
    if (!scheduleTasks || !vehicle) return scheduleTasks ?? [];
    const vehicleMileage = vehicle.mileage ?? 0;
    return scheduleTasks.map(t => ({
      ...t,
      status: calcStatus(t, vehicleMileage),
    }));
  }, [scheduleTasks, vehicle]);

  useFocusEffect(
    useCallback(() => {
      refetchSchedule();
    }, [refetchSchedule]),
  );

  React.useEffect(() => {
    if (!processedScheduleTasks || !scheduleTasks || processedScheduleTasks.length === 0) return;
    const changed = processedScheduleTasks.filter((pt, i) => {
      const orig = scheduleTasks[i];
      return orig && pt.status !== orig.status;
    });
    if (changed.length === 0) return;
    const hash = changed.map(t => `${t.id}:${t.status}`).join(",");
    if (lastStatusHashRef.current === hash) return;
    lastStatusHashRef.current = hash;
    Promise.all(
      changed.map(t =>
        supabase
          .from("user_vehicle_maintenance_tasks")
          .update({ status: t.status, updated_at: new Date().toISOString() })
          .eq("id", t.id),
      ),
    );
  }, [processedScheduleTasks, scheduleTasks]);

  const actionNeededTasks = useMemo(
    () => processedScheduleTasks.filter(t => t.status === "overdue" || t.status === "due_soon")
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "overdue" ? -1 : 1;
        const aMiles = a.next_due_miles ?? Infinity;
        const bMiles = b.next_due_miles ?? Infinity;
        return aMiles - bMiles;
      }),
    [processedScheduleTasks],
  );

  const upcomingTasks = useMemo(
    () => processedScheduleTasks.filter(t => t.status === "upcoming")
      .sort((a, b) => {
        const aMiles = a.next_due_miles ?? Infinity;
        const bMiles = b.next_due_miles ?? Infinity;
        if (aMiles !== bMiles) return aMiles - bMiles;
        const aDate = a.next_due_date ?? "9999";
        const bDate = b.next_due_date ?? "9999";
        return aDate.localeCompare(bDate);
      }),
    [processedScheduleTasks],
  );

  const completedTasks = useMemo(
    () => processedScheduleTasks.filter(t => t.status === "completed").slice(0, 10),
    [processedScheduleTasks],
  );

  async function generateSchedule() {
    if (!vehicle || !user) return;
    setGeneratingSchedule(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const { error } = await supabase.functions.invoke("generate-maintenance-schedule", {
        body: {
          vehicle_id: id,
          make: vehicle.make,
          year: parseInt(vehicle.year),
          current_mileage: vehicle.mileage ?? 0,
          vehicle_type: "gas",
          is_awd: false,
        },
      });
      if (error) {
        const httpStatus = ((error as unknown as Record<string, unknown>)?.context as Record<string, unknown>)?.status as number | undefined;
        if (httpStatus !== 409) {
          showToast("Failed to generate schedule. Please try again.");
          return;
        }
      }
      await refetchSchedule();
    } catch {
      showToast("Failed to generate schedule. Please try again.");
    } finally {
      setGeneratingSchedule(false);
    }
  }

  function showToast(msg: string) {
    setScheduleToast(msg);
    setShowScheduleToast(true);
    setTimeout(() => setShowScheduleToast(false), 2800);
  }

  function formatDateLabel(dateStr: string) {
    const today = format(new Date(), "yyyy-MM-dd");
    const yesterday = format(addDays(new Date(), -1), "yyyy-MM-dd");
    if (dateStr === today) return `Today  ·  ${format(parseISO(dateStr), "MMM d")}`;
    if (dateStr === yesterday) return `Yesterday  ·  ${format(parseISO(dateStr), "MMM d")}`;
    return format(parseISO(dateStr), "MMM d, yyyy");
  }

  function handleOpenMarkComplete(task: any) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMarkCompleteTask(task);
    setCompleteMileage(vehicle?.mileage != null ? String(vehicle.mileage) : "");
    setCompleteDate(format(new Date(), "yyyy-MM-dd"));
    setCompleteNotes("");
    setIsSavingComplete(false);
  }

  function handleCloseMarkComplete() {
    setMarkCompleteTask(null);
    setCompleteMileage("");
    setCompleteNotes("");
    setIsSavingComplete(false);
  }

  async function handleSaveMarkComplete() {
    if (!markCompleteTask) return;
    const mileageNum = parseInt(completeMileage, 10);
    if (!completeMileage.trim() || isNaN(mileageNum) || mileageNum < 0) {
      showToast("Please enter a valid mileage.");
      return;
    }
    const task = markCompleteTask;
    setIsSavingComplete(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const newNextDueMiles = task.interval_miles != null
      ? mileageNum + task.interval_miles
      : null;
    const newNextDueDate = task.interval_months != null
      ? format(addMonths(parseISO(completeDate), task.interval_months), "yyyy-MM-dd")
      : null;
    const now = new Date().toISOString();

    const updatedTask = {
      ...task,
      last_completed_date: completeDate,
      last_completed_miles: mileageNum,
      next_due_miles: newNextDueMiles,
      next_due_date: newNextDueDate,
      status: "upcoming",
      updated_at: now,
    };

    queryClient.setQueryData(["user_vehicle_maintenance_tasks", id], (old: any[] | undefined) => {
      if (!old) return old;
      return old.map(t => t.id === task.id ? updatedTask : t);
    });

    handleCloseMarkComplete();

    try {
      const [taskRes, vehicleRes, logRes] = await Promise.all([
        supabase.from("user_vehicle_maintenance_tasks").update({
          last_completed_date: completeDate,
          last_completed_miles: mileageNum,
          next_due_miles: newNextDueMiles,
          next_due_date: newNextDueDate,
          status: "upcoming",
          updated_at: now,
        }).eq("id", task.id),
        supabase.from("vehicles").update({ mileage: mileageNum }).eq("id", id!),
        supabase.from("maintenance_logs").insert({
          user_id: user!.id,
          vehicle_id: id,
          property_id: null,
          service_name: task.name,
          service_date: completeDate,
          cost: null,
          mileage: mileageNum,
          provider_name: null,
          provider_contact: null,
          receipt_url: null,
          notes: completeNotes.trim() || null,
        }),
      ]);

      if (taskRes.error || vehicleRes.error) throw taskRes.error ?? vehicleRes.error;
      if (logRes.error) console.warn("[maintenance_logs insert] Failed:", logRes.error.message);

      queryClient.invalidateQueries({ queryKey: ["vehicle", id] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["maintenance_logs", id] });

      let toastMsg = `${task.name} marked complete!`;
      if (newNextDueMiles != null) {
        toastMsg += ` Next due at ${newNextDueMiles.toLocaleString()} mi.`;
      } else if (newNextDueDate != null) {
        toastMsg += ` Next due ${format(parseISO(newNextDueDate), "MMM d, yyyy")}.`;
      }
      showToast(toastMsg);
    } catch (e) {
      queryClient.invalidateQueries({ queryKey: ["user_vehicle_maintenance_tasks", id] });
      showToast("Failed to save. Please try again.");
    }
  }

  async function handleRefreshAll() {
    setScheduleRefreshing(true);
    await Promise.all([refetchTasks(), refetchSchedule(), refetchLogs()]);
    setScheduleRefreshing(false);
  }

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
        <td>${log.service_date ? format(parseISO(log.service_date), "MMM d, yyyy") : "-"}</td>
        <td>${log.service_name ?? "Service"}</td>
        <td>${log.mileage != null ? log.mileage.toLocaleString() + " mi" : "-"}</td>
        <td>${log.cost != null ? "$" + log.cost.toFixed(2) : "-"}</td>
        <td>${log.provider_name ?? "-"}</td>
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
    <h1>Service History: ${name}</h1>
    <div class="sub">Exported from LifeMaintained · ${format(new Date(), "MMMM d, yyyy")}</div>
    <table>
      <thead><tr><th>Date</th><th>Service</th><th>Mileage</th><th>Cost</th><th>Provider</th><th>Notes</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="footer">Generated by LifeMaintained · lifemaintained.app</div>
    </body></html>`;
  }

  async function exportHistory(fmt: "pdf" | "csv") {
    if (!logs || logs.length === 0) {
      Alert.alert("No Records", "There are no service records to export.");
      return;
    }
    setIsExporting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      if (fmt === "pdf") {
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

  function handleDeleteVehicle() {
    console.log('DELETE: handler started');
    if (!vehicle || isDeletingVehicle) return;
    const name = vehicle.nickname ?? `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
    Alert.alert(
      "Delete this vehicle?",
      `This will permanently delete all maintenance tasks and service history for ${name}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            console.log('DELETE: user confirmed');
            if (isDeletingVehicle) return;
            setIsDeletingVehicle(true);
            try {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              console.log('DELETE: calling supabase');
              const r1 = await supabase.from("vehicle_maintenance_tasks").delete().eq("vehicle_id", id!);
              console.log('DELETE: supabase returned', { data: r1.data, error: r1.error });
              const r2 = await supabase.from("user_vehicle_maintenance_tasks").delete().eq("vehicle_id", id!);
              console.log('DELETE: supabase returned', { data: r2.data, error: r2.error });
              const r3 = await supabase.from("maintenance_logs").delete().eq("vehicle_id", id!);
              console.log('DELETE: supabase returned', { data: r3.data, error: r3.error });
              const r4 = await supabase.from("vehicle_mileage_history").delete().eq("vehicle_id", id!);
              console.log('DELETE: supabase returned', { data: r4.data, error: r4.error });
              const r5 = await supabase.from("vehicles").delete().eq("id", id!);
              console.log('DELETE: supabase returned', { data: r5.data, error: r5.error });
              console.log('DELETE: navigating away');
              router.back();
              queryClient.invalidateQueries({ queryKey: ["vehicles"] });
              queryClient.invalidateQueries({ queryKey: ["dashboard"] });
            } catch (err: any) {
              console.log('DELETE: error caught', err);
              setIsDeletingVehicle(false);
              Alert.alert("Delete Failed", err?.message ?? "Something went wrong. Please try again.");
            }
          },
        },
      ],
    );
  }

  function handleExport() {
    if (!hasPersonalOrAbove(profile)) {
      setShowPaywall(true);
      return;
    }
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
      const lastEntry = sorted[0];
      return {
        name,
        entries: sorted,
        totalCost,
        count: sorted.length,
        lastDate: lastEntry?.service_date ?? null,
        lastCost: lastEntry?.cost ?? null,
        lastProvider: lastEntry?.provider_name ?? null,
      };
    });
    return groups.sort((a, b) => {
      const aDate = a.entries[0]?.service_date ?? "";
      const bDate = b.entries[0]?.service_date ?? "";
      return bDate.localeCompare(aDate);
    });
  }, [logs]);

  const historyStats = useMemo(() => {
    if (!logs || logs.length === 0) return { totalSpent: 0, visitCount: 0, milesDriven: null };
    const withMileage = logs.filter(l => l.mileage != null).map(l => l.mileage as number);
    const milesDriven = withMileage.length >= 2
      ? Math.max(...withMileage) - Math.min(...withMileage)
      : null;
    return {
      totalSpent: logs.reduce((s, l) => s + (l.cost ?? 0), 0),
      visitCount: logs.length,
      milesDriven,
    };
  }, [logs]);

  const scheduleAttentionCount = actionNeededTasks.length;

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
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
        <View style={styles.headerActions}>
          <Pressable
            style={({ pressed }) => [styles.deleteVehicleBtn, { opacity: pressed ? 0.7 : 1 }]}
            onPress={handleDeleteVehicle}
            hitSlop={4}
          >
            <Ionicons name="trash-outline" size={16} color={Colors.overdue} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.logBtn, { opacity: pressed ? 0.8 : 1 }]}
            onPress={() => router.push(`/log-service/${id}` as any)}
          >
            <Ionicons name="construct-outline" size={14} color={Colors.vehicle} />
            <Text style={styles.logBtnText}>Log Service</Text>
          </Pressable>
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator color={Colors.accent} style={{ marginTop: 60 }} />
      ) : vehicle ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={scheduleRefreshing}
              onRefresh={handleRefreshAll}
              tintColor={Colors.accent}
            />
          }
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
            {(["tasks", "schedule", "history"] as const).map(tab => (
              <Pressable
                key={tab}
                style={[styles.tab, activeTab === tab && styles.tabActive]}
                onPress={() => { Haptics.selectionAsync(); setActiveTab(tab); }}
              >
                <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                  {tab === "tasks" ? "Tasks" : tab === "schedule" ? (
                    scheduleAttentionCount > 0 ? `Schedule (${scheduleAttentionCount})` : "Schedule"
                  ) : "History"}
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
          ) : activeTab === "schedule" ? (
            <View style={styles.scheduleContainer}>
              {loadingSchedule ? (
                <ScheduleSkeleton />
              ) : scheduleError ? (
                <View style={styles.scheduleError}>
                  <Ionicons name="alert-circle-outline" size={32} color={Colors.overdue} />
                  <Text style={styles.scheduleErrorText}>Failed to load maintenance schedule</Text>
                  <Pressable
                    style={({ pressed }) => [styles.retryBtn, { opacity: pressed ? 0.8 : 1 }]}
                    onPress={() => refetchSchedule()}
                  >
                    <Text style={styles.retryBtnText}>Try Again</Text>
                  </Pressable>
                </View>
              ) : processedScheduleTasks.length === 0 ? (
                <View style={styles.scheduleEmpty}>
                  <View style={styles.scheduleEmptyIcon}>
                    <Ionicons name="calendar-outline" size={36} color={Colors.textTertiary} />
                  </View>
                  <Text style={styles.scheduleEmptyTitle}>No maintenance schedule yet</Text>
                  <Text style={styles.scheduleEmptySubtitle}>
                    Generate a schedule based on your vehicle's make and mileage
                  </Text>
                  <Pressable
                    style={({ pressed }) => [styles.generateBtn, { opacity: pressed ? 0.85 : 1 }]}
                    onPress={generateSchedule}
                    disabled={generatingSchedule}
                  >
                    {generatingSchedule ? (
                      <ActivityIndicator size="small" color={Colors.textInverse} />
                    ) : (
                      <>
                        <Ionicons name="sparkles-outline" size={15} color={Colors.textInverse} />
                        <Text style={styles.generateBtnText}>Generate Schedule</Text>
                      </>
                    )}
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.customTaskBtn, { opacity: pressed ? 0.8 : 1 }]}
                    onPress={() => showToast("Coming soon")}
                  >
                    <Ionicons name="add" size={15} color={Colors.textSecondary} />
                    <Text style={styles.customTaskBtnText}>Add Custom Task</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  {actionNeededTasks.length > 0 && (
                    <ScheduleSection
                      title={`Action Needed (${actionNeededTasks.length})`}
                      titleColor={Colors.overdue}
                      expanded={actionNeededExpanded}
                      onToggle={() => { Haptics.selectionAsync(); setActionNeededExpanded(v => !v); }}
                      tasks={actionNeededTasks}
                      vehicle={vehicle}
                      onMarkComplete={handleOpenMarkComplete}
                    />
                  )}
                  <ScheduleSection
                    title="Upcoming"
                    expanded={upcomingExpanded}
                    onToggle={() => { Haptics.selectionAsync(); setUpcomingExpanded(v => !v); }}
                    tasks={upcomingTasks}
                    vehicle={vehicle}
                    emptyMessage="No upcoming tasks"
                    onMarkComplete={handleOpenMarkComplete}
                  />
                  {completedTasks.length > 0 && (
                    <ScheduleSection
                      title="Completed"
                      titleColor={Colors.good}
                      expanded={completedExpanded}
                      onToggle={() => { Haptics.selectionAsync(); setCompletedExpanded(v => !v); }}
                      tasks={completedTasks}
                      vehicle={vehicle}
                      onMarkComplete={handleOpenMarkComplete}
                    />
                  )}
                </>
              )}
            </View>
          ) : (
            <View style={styles.historyContainer}>
              {groupedHistory.length === 0 ? (
                <View style={styles.emptyTasks}>
                  <Ionicons name="document-outline" size={36} color={Colors.textTertiary} />
                  <Text style={styles.emptyTasksText}>No service records yet</Text>
                  <Text style={styles.emptyTasksSubtext}>Tap Log Service to add your first record</Text>
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
                      <Text style={styles.historySummaryLabel}>{historyStats.visitCount === 1 ? "service visit" : "service visits"}</Text>
                    </View>
                    {historyStats.milesDriven != null && (
                      <>
                        <View style={styles.historySummaryDivider} />
                        <View style={styles.historySummaryStat}>
                          <Text style={styles.historySummaryValue}>{historyStats.milesDriven.toLocaleString()}</Text>
                          <Text style={[styles.historySummaryLabel, { textAlign: "center" }]}>miles driven{"\n"}(logged period)</Text>
                        </View>
                      </>
                    )}
                  </View>

                  <View style={styles.historyGroupList}>
                    {groupedHistory.map(group => (
                      <Pressable
                        key={group.name}
                        style={({ pressed }) => [styles.historyGroupCard, { opacity: pressed ? 0.8 : 1 }]}
                        onPress={() => {
                          Haptics.selectionAsync();
                          router.push(`/vehicle-task-history/${id}?task=${encodeURIComponent(group.name)}` as any);
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

      <SaveToast visible={showScheduleToast} message={scheduleToast} />

      <MarkCompleteSheet
        visible={markCompleteTask != null}
        task={markCompleteTask}
        mileage={completeMileage}
        onMileageChange={setCompleteMileage}
        date={completeDate}
        onDateChange={setCompleteDate}
        notes={completeNotes}
        onNotesChange={setCompleteNotes}
        onSave={handleSaveMarkComplete}
        onClose={handleCloseMarkComplete}
        isSaving={isSavingComplete}
        formatDateLabel={formatDateLabel}
        insets={insets}
      />

      {showPaywall && (
        <Modal visible animationType="slide" onRequestClose={() => setShowPaywall(false)}>
          <Paywall
            canDismiss
            subtitle="Upgrade to export your service history"
            onDismiss={() => setShowPaywall(false)}
          />
        </Modal>
      )}
    </View>
  );
}

function ScheduleSkeleton() {
  return (
    <View style={styles.skeletonContainer}>
      {[1, 2, 3, 4].map(i => (
        <View key={i} style={styles.skeletonCard}>
          <View style={styles.skeletonLine} />
          <View style={[styles.skeletonLine, { width: "60%", marginTop: 8 }]} />
        </View>
      ))}
    </View>
  );
}

function ScheduleSection({
  title,
  titleColor,
  expanded,
  onToggle,
  tasks,
  vehicle,
  emptyMessage,
  onMarkComplete,
}: {
  title: string;
  titleColor?: string;
  expanded: boolean;
  onToggle: () => void;
  tasks: any[];
  vehicle: any;
  emptyMessage?: string;
  onMarkComplete: (task: any) => void;
}) {
  return (
    <View style={styles.scheduleSection}>
      <Pressable style={styles.scheduleSectionHeader} onPress={onToggle} hitSlop={6}>
        <Text style={[styles.scheduleSectionTitle, titleColor ? { color: titleColor } : {}]}>
          {title}
        </Text>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={16}
          color={titleColor ?? Colors.textSecondary}
        />
      </Pressable>
      {expanded && (
        <View style={styles.scheduleSectionContent}>
          {tasks.length === 0 && emptyMessage ? (
            <Text style={styles.scheduleSectionEmpty}>{emptyMessage}</Text>
          ) : (
            tasks.map(task => (
              <ScheduleTaskCard
                key={task.id}
                task={task}
                vehicle={vehicle}
                onMarkComplete={onMarkComplete}
              />
            ))
          )}
        </View>
      )}
    </View>
  );
}

function ScheduleTaskCard({ task, vehicle, onMarkComplete }: {
  task: any;
  vehicle: any;
  onMarkComplete: (task: any) => void;
}) {
  const borderColor = STATUS_BORDER[task.status] ?? Colors.border;
  const catColors = CATEGORY_COLORS[task.category?.toLowerCase()] ?? { bg: Colors.surface, text: Colors.textSecondary };
  const isCritical = task.priority === "critical";
  const isOptional = task.priority === "optional";
  const isCompleted = task.status === "completed";

  const dueLines: string[] = [];
  if (task.next_due_miles != null) {
    dueLines.push(`Due at ${task.next_due_miles.toLocaleString()} mi`);
  }
  if (task.next_due_date != null) {
    dueLines.push(`Due by ${format(parseISO(task.next_due_date), "MMM d, yyyy")}`);
  }
  if (dueLines.length === 0 && !isCompleted) {
    dueLines.push("No schedule set.");
  }
  if (isCompleted && task.last_completed_date) {
    dueLines.push(`Done ${format(parseISO(task.last_completed_date), "MMM d, yyyy")}`);
  }

  return (
    <View style={[styles.scheduleCard, { borderLeftColor: borderColor }]}>
      <View style={styles.scheduleCardInner}>
        <View style={styles.scheduleCardBody}>
          <View style={styles.scheduleCardTop}>
            <Text
              style={[
                styles.scheduleCardName,
                isOptional && { color: Colors.textSecondary },
                isCompleted && { color: Colors.textTertiary },
              ]}
              numberOfLines={2}
            >
              {task.name}
            </Text>
            {isCritical && !isCompleted && (
              <View style={styles.criticalDot}>
                <Text style={styles.criticalDotText}>!</Text>
              </View>
            )}
          </View>
          <View style={styles.scheduleCardRow}>
            {task.category ? (
              <View style={[styles.categoryBadge, { backgroundColor: catColors.bg }]}>
                <Text style={[styles.categoryBadgeText, { color: catColors.text }]}>
                  {task.category.charAt(0).toUpperCase() + task.category.slice(1)}
                </Text>
              </View>
            ) : null}
            <View style={styles.dueInfo}>
              {dueLines.map((line, i) => (
                <Text
                  key={i}
                  style={[
                    styles.scheduleCardDue,
                    isOptional && { color: Colors.textTertiary },
                    isCompleted && { color: Colors.textTertiary },
                  ]}
                >
                  {line}
                </Text>
              ))}
            </View>
          </View>
        </View>
        {!isCompleted && (
          <Pressable
            onPress={() => onMarkComplete(task)}
            style={({ pressed }) => [styles.scheduleCompleteBtn, { opacity: pressed ? 0.7 : 1 }]}
            hitSlop={8}
          >
            <Ionicons name="checkmark-circle-outline" size={26} color={Colors.good} />
          </Pressable>
        )}
        {isCompleted && (
          <Ionicons name="checkmark-circle" size={22} color={Colors.good} style={{ opacity: 0.5 }} />
        )}
      </View>
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

function MarkCompleteSheet({
  visible,
  task,
  mileage,
  onMileageChange,
  date,
  onDateChange,
  notes,
  onNotesChange,
  onSave,
  onClose,
  isSaving,
  formatDateLabel,
  insets,
}: {
  visible: boolean;
  task: any | null;
  mileage: string;
  onMileageChange: (v: string) => void;
  date: string;
  onDateChange: (v: string) => void;
  notes: string;
  onNotesChange: (v: string) => void;
  onSave: () => void;
  onClose: () => void;
  isSaving: boolean;
  formatDateLabel: (d: string) => string;
  insets: { bottom: number };
}) {
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const yesterdayStr = format(addDays(new Date(), -1), "yyyy-MM-dd");

  function adjustDate(days: number) {
    const current = parseISO(date);
    const next = addDays(current, days);
    onDateChange(format(next, "yyyy-MM-dd"));
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.sheetOverlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <View style={[styles.sheetContainer, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>
            {task?.name ?? "Mark Complete"}
          </Text>

          <View style={styles.sheetFields}>
            <View style={styles.sheetField}>
              <Text style={styles.sheetFieldLabel}>Current Mileage</Text>
              <TextInput
                style={styles.sheetInput}
                value={mileage}
                onChangeText={onMileageChange}
                keyboardType="number-pad"
                placeholder="e.g. 52,000"
                placeholderTextColor={Colors.textTertiary}
                returnKeyType="done"
              />
            </View>

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
                <Text style={styles.dateStepValue}>{formatDateLabel(date)}</Text>
                <Pressable
                  style={({ pressed }) => [styles.dateStepBtn, { opacity: pressed ? 0.7 : 1 }]}
                  onPress={() => adjustDate(1)}
                  disabled={date >= todayStr}
                  hitSlop={8}
                >
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={date >= todayStr ? Colors.textTertiary : Colors.text}
                  />
                </Pressable>
              </View>
              <View style={styles.dateQuickRow}>
                <Pressable
                  onPress={() => onDateChange(todayStr)}
                  style={[styles.dateQuickBtn, date === todayStr && styles.dateQuickBtnActive]}
                >
                  <Text style={[styles.dateQuickText, date === todayStr && styles.dateQuickTextActive]}>
                    Today
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => onDateChange(yesterdayStr)}
                  style={[styles.dateQuickBtn, date === yesterdayStr && styles.dateQuickBtnActive]}
                >
                  <Text style={[styles.dateQuickText, date === yesterdayStr && styles.dateQuickTextActive]}>
                    Yesterday
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.sheetField}>
              <Text style={styles.sheetFieldLabel}>Notes  <Text style={styles.sheetFieldOptional}>(optional)</Text></Text>
              <TextInput
                style={[styles.sheetInput, styles.sheetInputMultiline]}
                value={notes}
                onChangeText={onNotesChange}
                placeholder="e.g. Used Mobil 1 5W-30"
                placeholderTextColor={Colors.textTertiary}
                multiline
                numberOfLines={2}
                returnKeyType="done"
              />
            </View>
          </View>

          <View style={styles.sheetActions}>
            <Pressable
              style={({ pressed }) => [styles.sheetCancelBtn, { opacity: pressed ? 0.8 : 1 }]}
              onPress={onClose}
            >
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.sheetSaveBtn,
                { opacity: pressed || isSaving ? 0.8 : 1 },
              ]}
              onPress={onSave}
              disabled={isSaving}
            >
              {isSaving ? (
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
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 },
  deleteVehicleBtn: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: Colors.overdueMuted, alignItems: "center", justifyContent: "center",
  },
  logBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
    backgroundColor: Colors.vehicleMuted, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8, minHeight: 36, flexShrink: 0,
  },
  logBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.vehicle },
  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 16 },
  vehicleCard: {
    backgroundColor: Colors.card, borderRadius: 16, padding: 16, gap: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  vehicleCardLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  vehicleIconBig: {
    width: 56, height: 56, borderRadius: 16, backgroundColor: Colors.vehicleMuted,
    alignItems: "center", justifyContent: "center",
  },
  vehicleFullName: { fontSize: 18, fontFamily: "Inter_600SemiBold", color: Colors.text },
  vehicleTrim: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  vehicleStats: { flexDirection: "row", gap: 12 },
  statBox: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: 12,
    padding: 12, alignItems: "center",
  },
  statValue: { fontSize: 20, fontFamily: "Inter_700Bold", color: Colors.text },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  vehicleActions: { flexDirection: "row", gap: 8 },
  vehicleActionBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
    backgroundColor: Colors.surface, borderRadius: 10, paddingVertical: 9,
    borderWidth: 1, borderColor: Colors.border,
  },
  vehicleActionText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  vehicleActionBtnAccent: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
    backgroundColor: Colors.vehicle, borderRadius: 10, paddingVertical: 9,
  },
  vehicleActionTextAccent: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textInverse },
  tabs: {
    flexDirection: "row", backgroundColor: Colors.card, borderRadius: 12,
    padding: 4, borderWidth: 1, borderColor: Colors.border,
  },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  tabActive: { backgroundColor: Colors.vehicleMuted },
  tabText: { fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  tabTextActive: { color: Colors.vehicle, fontFamily: "Inter_600SemiBold" },
  tasksContainer: { gap: 12 },
  taskGroup: { gap: 8 },
  taskGroupHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  taskGroupDot: { width: 6, height: 6, borderRadius: 3 },
  taskGroupTitle: {
    fontSize: 12, fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase", letterSpacing: 0.8,
  },
  taskCard: {
    flexDirection: "row", alignItems: "center", backgroundColor: Colors.card,
    borderRadius: 12, padding: 12, gap: 12, borderWidth: 1, borderColor: Colors.border,
  },
  taskCardLeft: { flex: 1 },
  taskName: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.text },
  taskMeta: { flexDirection: "row", gap: 8, marginTop: 3, flexWrap: "wrap" },
  taskDue: { fontSize: 12, fontFamily: "Inter_500Medium" },
  taskInterval: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  taskCost: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  completeBtn: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.goodMuted,
    alignItems: "center", justifyContent: "center",
  },
  emptyTasks: { alignItems: "center", paddingVertical: 32, gap: 8 },
  emptyTasksText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  emptyTasksSubtext: {
    fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textTertiary, textAlign: "center",
  },
  exportBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: Colors.vehicle, borderRadius: 12, paddingVertical: 11,
  },
  exportBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  historyContainer: { gap: 16 },
  historySummaryBar: {
    flexDirection: "row", backgroundColor: Colors.card, borderRadius: 16,
    borderWidth: 1, borderColor: Colors.border, padding: 16,
    alignItems: "center", justifyContent: "space-around",
  },
  historySummaryStat: { alignItems: "center", gap: 3 },
  historySummaryValue: { fontSize: 20, fontFamily: "Inter_700Bold", color: Colors.text },
  historySummaryLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  historySummaryDivider: { width: 1, height: 36, backgroundColor: Colors.border },
  historyGroupList: { gap: 10 },
  historyGroupCard: {
    flexDirection: "row", alignItems: "center", backgroundColor: Colors.card,
    borderRadius: 16, borderWidth: 1, borderColor: Colors.border,
    padding: 16, minHeight: 44, gap: 12,
  },
  historyGroupCardLeft: { flex: 1, gap: 3 },
  historyGroupCardName: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.text, lineHeight: 21 },
  historyGroupCardMeta: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  historyGroupCardProvider: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  historyGroupCardFooter: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  historyGroupCardCount: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  historyGroupCardTotal: { fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.vehicle },
  historyGroupCardRight: { alignItems: "flex-end", gap: 6, flexShrink: 0 },
  historyGroupCardCost: { fontSize: 17, fontFamily: "Inter_700Bold", color: Colors.vehicle },

  scheduleContainer: { gap: 12 },
  scheduleSection: {
    backgroundColor: Colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border, overflow: "hidden",
  },
  scheduleSectionHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 14, paddingVertical: 12,
  },
  scheduleSectionTitle: {
    fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.textSecondary,
    textTransform: "uppercase", letterSpacing: 0.6,
  },
  scheduleSectionContent: { borderTopWidth: 1, borderTopColor: Colors.border, gap: 1 },
  scheduleSectionEmpty: {
    fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textTertiary,
    textAlign: "center", paddingVertical: 20,
  },
  scheduleCard: {
    backgroundColor: Colors.card, paddingHorizontal: 14, paddingVertical: 12,
    borderLeftWidth: 3, gap: 6,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  scheduleCardTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  scheduleCardName: {
    flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.text,
  },
  criticalDot: {
    width: 18, height: 18, borderRadius: 9, backgroundColor: Colors.overdueMuted,
    alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1,
  },
  criticalDotText: {
    fontSize: 11, fontFamily: "Inter_700Bold", color: Colors.overdue,
  },
  scheduleCardRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, flexWrap: "wrap" },
  categoryBadge: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  categoryBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  dueInfo: { flex: 1, gap: 2 },
  scheduleCardDue: {
    fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary,
  },
  scheduleEmpty: {
    alignItems: "center", paddingVertical: 40, paddingHorizontal: 16, gap: 10,
  },
  scheduleEmptyIcon: {
    width: 72, height: 72, borderRadius: 20, backgroundColor: Colors.surface,
    alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  scheduleEmptyTitle: {
    fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.text,
  },
  scheduleEmptySubtitle: {
    fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary,
    textAlign: "center", lineHeight: 19,
  },
  generateBtn: {
    flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: Colors.accent,
    borderRadius: 12, paddingHorizontal: 22, paddingVertical: 12, marginTop: 6,
  },
  generateBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  customTaskBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
  },
  customTaskBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  scheduleError: { alignItems: "center", paddingVertical: 36, gap: 10 },
  scheduleErrorText: {
    fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center",
  },
  retryBtn: {
    backgroundColor: Colors.surface, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 9,
    borderWidth: 1, borderColor: Colors.border, marginTop: 4,
  },
  retryBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.text },
  skeletonContainer: { gap: 1, backgroundColor: Colors.card, borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: Colors.border },
  skeletonCard: {
    backgroundColor: Colors.card, paddingHorizontal: 14, paddingVertical: 14,
    borderLeftWidth: 3, borderLeftColor: Colors.border,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  skeletonLine: {
    height: 14, borderRadius: 7, backgroundColor: Colors.surface, width: "80%",
  },

  scheduleCardInner: {
    flexDirection: "row", alignItems: "center", gap: 10,
  },
  scheduleCardBody: { flex: 1 },
  scheduleCompleteBtn: {
    width: 36, height: 36, alignItems: "center", justifyContent: "center", flexShrink: 0,
  },

  sheetOverlay: {
    flex: 1, justifyContent: "flex-end",
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
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
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: Colors.border, alignSelf: "center", marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text,
    marginBottom: 20, textAlign: "center",
  },
  sheetFields: { gap: 16 },
  sheetField: { gap: 6 },
  sheetFieldLabel: {
    fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.textSecondary,
    textTransform: "uppercase", letterSpacing: 0.5,
  },
  sheetFieldOptional: {
    fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textTertiary,
    textTransform: "none", letterSpacing: 0,
  },
  sheetInput: {
    backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.text,
    borderWidth: 1, borderColor: Colors.border,
  },
  sheetInputMultiline: {
    minHeight: 64, textAlignVertical: "top",
  },
  dateStepper: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, overflow: "hidden",
  },
  dateStepBtn: {
    width: 44, height: 46, alignItems: "center", justifyContent: "center",
  },
  dateStepValue: {
    flex: 1, textAlign: "center",
    fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.text,
  },
  dateQuickRow: {
    flexDirection: "row", gap: 8, marginTop: 6,
  },
  dateQuickBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 10,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    alignItems: "center",
  },
  dateQuickBtnActive: {
    backgroundColor: Colors.accentMuted, borderColor: Colors.accent,
  },
  dateQuickText: {
    fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary,
  },
  dateQuickTextActive: {
    color: Colors.accent, fontFamily: "Inter_600SemiBold",
  },
  sheetActions: {
    flexDirection: "row", gap: 10, marginTop: 24,
  },
  sheetCancelBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 13, alignItems: "center",
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
  },
  sheetCancelText: {
    fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.textSecondary,
  },
  sheetSaveBtn: {
    flex: 2, paddingVertical: 13, borderRadius: 13,
    backgroundColor: Colors.accent, alignItems: "center", justifyContent: "center",
    flexDirection: "row", gap: 6,
  },
  sheetSaveText: {
    fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.textInverse,
  },
});
