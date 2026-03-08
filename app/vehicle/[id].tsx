import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
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
  Linking,
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
import { MILEAGE_TRACKED_TYPES } from "@/lib/vehicleTypes";

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
  const [activeTab, setActiveTab] = useState<"schedule" | "wallet" | "history">("schedule");
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
          vehicle_type: vehicle.fuel_type ?? "gas",
          is_awd: vehicle.is_awd ?? false,
          vehicle_category: vehicle.vehicle_type ?? "car",
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
    const tracksMileage = MILEAGE_TRACKED_TYPES.has(vehicle?.vehicle_type ?? "");
    let mileageNum: number | null = null;
    if (tracksMileage) {
      const parsed = parseInt(completeMileage, 10);
      if (!completeMileage.trim() || isNaN(parsed) || parsed < 0) {
        showToast("Please enter a valid mileage.");
        return;
      }
      mileageNum = parsed;
    }
    const task = markCompleteTask;
    setIsSavingComplete(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const newNextDueMiles = (task.interval_miles != null && mileageNum != null)
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
        mileageNum != null
          ? supabase.from("vehicles").update({ mileage: mileageNum }).eq("id", id!)
          : Promise.resolve({ error: null }),
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
    await Promise.all([refetchSchedule(), refetchLogs()]);
    setScheduleRefreshing(false);
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

  const isLoading = loadingVehicle;
  const vehicleName = vehicle ? (vehicle.nickname ?? `${vehicle.year} ${vehicle.make} ${vehicle.model}`) : "Vehicle";

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
                <Text style={[styles.statValue, { color: actionNeededTasks.some(t => t.status === "overdue") ? Colors.overdue : scheduleAttentionCount > 0 ? Colors.dueSoon : Colors.good }]}>
                  {scheduleAttentionCount}
                </Text>
                <Text style={styles.statLabel}>need attention</Text>
              </View>
            </View>

            <View style={styles.vehicleActions}>
              {MILEAGE_TRACKED_TYPES.has(vehicle.vehicle_type ?? "") && (
                <Pressable
                  style={({ pressed }) => [styles.vehicleActionBtn, { opacity: pressed ? 0.8 : 1 }]}
                  onPress={() => router.push(`/update-mileage/${id}` as any)}
                >
                  <Ionicons name="speedometer-outline" size={14} color={Colors.textSecondary} />
                  <Text style={styles.vehicleActionText}>Update Mileage</Text>
                </Pressable>
              )}
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
            {(["schedule", "wallet", "history"] as const).map(tab => (
              <Pressable
                key={tab}
                style={[styles.tab, activeTab === tab && styles.tabActive]}
                onPress={() => { Haptics.selectionAsync(); setActiveTab(tab); }}
              >
                <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                  {tab === "schedule"
                    ? (scheduleAttentionCount > 0 ? `Schedule (${scheduleAttentionCount})` : "Schedule")
                    : tab === "wallet" ? "Wallet"
                    : "History"}
                </Text>
              </Pressable>
            ))}
          </View>

          {activeTab === "schedule" ? (
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
          ) : activeTab === "wallet" ? (
            <WalletTab vehicleId={id!} userId={user!.id} />
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
        showMileage={MILEAGE_TRACKED_TYPES.has(vehicle?.vehicle_type ?? "")}
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
    <Pressable
      onPress={!isCompleted ? () => onMarkComplete(task) : undefined}
      style={({ pressed }) => [
        styles.scheduleCard,
        { borderLeftColor: borderColor },
        !isCompleted && pressed && { opacity: 0.7 },
      ]}
      accessibilityRole={!isCompleted ? "button" : undefined}
      accessibilityLabel={isCompleted ? `${task.name} — completed` : `${task.name} — tap to mark complete`}
    >
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
          <Ionicons name="chevron-forward" size={22} color={Colors.textTertiary} style={{ opacity: 0.5 }} />
        )}
        {isCompleted && (
          <Ionicons name="checkmark-circle" size={22} color={Colors.good} style={{ opacity: 0.5 }} />
        )}
      </View>
    </Pressable>
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
              <Text style={styles.taskName}>{task.name}</Text>
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
  showMileage = true,
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
  showMileage?: boolean;
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
            {showMileage && (
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
            )}

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

// ─── Wallet Tab ───────────────────────────────────────────────────────────────

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
];

const COVERAGE_TYPES = ["Liability Only", "Full Coverage", "Comprehensive"];

type WalletDoc = { id: string; document_type: string; data: Record<string, any> };
type DocType = "registration" | "insurance" | "id_card";

function maskValue(value: string | null | undefined): string {
  if (!value) return "—";
  if (value.length <= 4) return value;
  return "••••" + value.slice(-4);
}

function ExpiryBadge({ dateStr }: { dateStr: string | null | undefined }) {
  if (!dateStr) return null;
  const d = parseISO(dateStr);
  const now = new Date();
  if (isBefore(d, now)) {
    return (
      <View style={walletStyles.badgeExpired}>
        <Text style={walletStyles.badgeExpiredText}>Expired</Text>
      </View>
    );
  }
  if (differenceInDays(d, now) <= 60) {
    return (
      <View style={walletStyles.badgeSoon}>
        <Text style={walletStyles.badgeSoonText}>Expiring Soon</Text>
      </View>
    );
  }
  return null;
}

function MaskedRow({
  label, value, fieldKey, revealed, onToggle,
}: {
  label: string; value: string | null | undefined;
  fieldKey: string; revealed: boolean; onToggle: () => void;
}) {
  const display = revealed ? (value || "—") : maskValue(value);
  return (
    <View style={walletStyles.row}>
      <Text style={walletStyles.rowLabel}>{label}</Text>
      <View style={walletStyles.rowRight}>
        <Text style={[walletStyles.rowValue, !revealed && !!value && value.length > 4 && walletStyles.rowMasked]}>
          {display}
        </Text>
        {!!value && value.length > 4 && (
          <Pressable onPress={onToggle} hitSlop={8}>
            <Ionicons
              name={revealed ? "eye-off-outline" : "eye-outline"}
              size={16}
              color={Colors.textSecondary}
            />
          </Pressable>
        )}
      </View>
    </View>
  );
}

function PlainRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <View style={walletStyles.row}>
      <Text style={walletStyles.rowLabel}>{label}</Text>
      <Text style={walletStyles.rowValue}>{value || "—"}</Text>
    </View>
  );
}

function PhoneRow({ label, phone }: { label: string; phone: string | null | undefined }) {
  if (!phone) return <PlainRow label={label} value={null} />;
  return (
    <View style={walletStyles.row}>
      <Text style={walletStyles.rowLabel}>{label}</Text>
      <Pressable onPress={() => Linking.openURL(`tel:${phone.replace(/\D/g, "")}`)}>
        <Text style={walletStyles.rowPhone}>{phone}</Text>
      </Pressable>
    </View>
  );
}

function WalletCard({
  title, icon, accentColor, children, onEdit,
}: {
  title: string; icon: string; accentColor: string;
  children: React.ReactNode; onEdit: () => void;
}) {
  return (
    <View style={[walletStyles.card, { borderTopColor: accentColor, borderTopWidth: 3 }]}>
      <View style={walletStyles.cardHeader}>
        <View style={walletStyles.cardHeaderLeft}>
          <View style={[walletStyles.cardIconWrap, { backgroundColor: accentColor + "22" }]}>
            <Ionicons name={icon as any} size={18} color={accentColor} />
          </View>
          <Text style={walletStyles.cardTitle}>{title}</Text>
        </View>
        <Pressable onPress={onEdit} hitSlop={8}>
          <Ionicons name="pencil-outline" size={17} color={Colors.textSecondary} />
        </Pressable>
      </View>
      {children}
    </View>
  );
}

function StatePickerModal({
  visible, selected, onSelect, onClose,
}: {
  visible: boolean; selected: string; onSelect: (s: string) => void; onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={walletStyles.pickerOverlay}>
        <Pressable style={walletStyles.pickerBackdrop} onPress={onClose} />
        <View style={walletStyles.pickerContainer}>
          <View style={walletStyles.pickerHeader}>
            <Text style={walletStyles.pickerTitle}>Select State</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={Colors.text} />
            </Pressable>
          </View>
          <ScrollView style={walletStyles.pickerScroll} showsVerticalScrollIndicator={false}>
            {US_STATES.map(s => (
              <Pressable
                key={s}
                style={({ pressed }) => [
                  walletStyles.pickerOption,
                  selected === s && walletStyles.pickerOptionSelected,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
                onPress={() => { Haptics.selectionAsync(); onSelect(s); onClose(); }}
              >
                <Text style={[walletStyles.pickerOptionText, selected === s && walletStyles.pickerOptionTextSelected]}>
                  {s}
                </Text>
                {selected === s && <Ionicons name="checkmark" size={16} color={Colors.accent} />}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function WalletFormSheet({
  visible, docType, existingDoc, vehicleId, userId, onClose, onSaved, insets,
}: {
  visible: boolean;
  docType: DocType | null;
  existingDoc: WalletDoc | null;
  vehicleId: string;
  userId: string;
  onClose: () => void;
  onSaved: () => void;
  insets: { bottom: number };
}) {
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showStatePicker, setShowStatePicker] = useState(false);

  const [regState, setRegState] = useState("");
  const [regPlate, setRegPlate] = useState("");
  const [regNumber, setRegNumber] = useState("");
  const [regExpiry, setRegExpiry] = useState(format(new Date(), "yyyy-MM-dd"));
  const [regOwner, setRegOwner] = useState("");

  const [insProvider, setInsProvider] = useState("");
  const [insPolicyNum, setInsPolicyNum] = useState("");
  const [insGroupNum, setInsGroupNum] = useState("");
  const [insCoverage, setInsCoverage] = useState("Full Coverage");
  const [insExpiry, setInsExpiry] = useState(format(new Date(), "yyyy-MM-dd"));
  const [insAgent, setInsAgent] = useState("");
  const [insAgentPhone, setInsAgentPhone] = useState("");
  const [insClaimsPhone, setInsClaimsPhone] = useState("");

  const [idcName, setIdcName] = useState("");
  const [idcLicenseNum, setIdcLicenseNum] = useState("");
  const [idcState, setIdcState] = useState("");
  const [idcClass, setIdcClass] = useState("");
  const [idcExpiry, setIdcExpiry] = useState(format(new Date(), "yyyy-MM-dd"));
  const [idcDob, setIdcDob] = useState("1990-01-15");

  useEffect(() => {
    if (!visible || !docType) return;
    const d = existingDoc?.data ?? {};
    if (docType === "registration") {
      setRegState(d.state ?? "");
      setRegPlate(d.plate_number ?? "");
      setRegNumber(d.registration_number ?? "");
      setRegExpiry(d.expiration_date ?? format(new Date(), "yyyy-MM-dd"));
      setRegOwner(d.registered_owner ?? "");
    } else if (docType === "insurance") {
      setInsProvider(d.provider ?? "");
      setInsPolicyNum(d.policy_number ?? "");
      setInsGroupNum(d.group_number ?? "");
      setInsCoverage(d.coverage_type ?? "Full Coverage");
      setInsExpiry(d.expiration_date ?? format(new Date(), "yyyy-MM-dd"));
      setInsAgent(d.agent_name ?? "");
      setInsAgentPhone(d.agent_phone ?? "");
      setInsClaimsPhone(d.claims_phone ?? "");
    } else if (docType === "id_card") {
      setIdcName(d.full_name ?? "");
      setIdcLicenseNum(d.license_number ?? "");
      setIdcState(d.state ?? "");
      setIdcClass(d.class ?? "");
      setIdcExpiry(d.expiration_date ?? format(new Date(), "yyyy-MM-dd"));
      setIdcDob(d.date_of_birth ?? "1990-01-15");
    }
  }, [visible, docType, existingDoc]);

  function buildData(): Record<string, any> {
    if (docType === "registration") {
      return {
        state: regState, plate_number: regPlate,
        registration_number: regNumber, expiration_date: regExpiry,
        registered_owner: regOwner,
      };
    } else if (docType === "insurance") {
      return {
        provider: insProvider, policy_number: insPolicyNum,
        group_number: insGroupNum || null, coverage_type: insCoverage,
        expiration_date: insExpiry, agent_name: insAgent,
        agent_phone: insAgentPhone || null, claims_phone: insClaimsPhone || null,
      };
    } else {
      return {
        full_name: idcName, license_number: idcLicenseNum,
        state: idcState, class: idcClass,
        expiration_date: idcExpiry, date_of_birth: idcDob,
      };
    }
  }

  function adjustDate(current: string, days: number): string {
    return format(addDays(parseISO(current), days), "yyyy-MM-dd");
  }

  async function handleSave() {
    if (isSaving || !docType) return;
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("vehicle_wallet_documents")
        .upsert(
          {
            vehicle_id: vehicleId,
            user_id: userId,
            document_type: docType,
            data: buildData(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "vehicle_id,document_type" },
        );
      if (error) throw error;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ["wallet_docs", vehicleId] });
      onSaved();
      onClose();
    } catch (e: any) {
      setIsSaving(false);
      Alert.alert("Save Failed", e?.message ?? "Could not save. Please try again.");
    }
  }

  function handleDelete() {
    if (!existingDoc || isDeleting) return;
    Alert.alert(
      "Delete Document",
      "This will permanently remove this document from your wallet.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setIsDeleting(true);
            try {
              await supabase.from("vehicle_wallet_documents").delete().eq("id", existingDoc.id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              queryClient.invalidateQueries({ queryKey: ["wallet_docs", vehicleId] });
              onSaved();
              onClose();
            } catch {
              setIsDeleting(false);
              Alert.alert("Error", "Could not delete document.");
            }
          },
        },
      ],
    );
  }

  const isEditing = !!existingDoc;
  const titleMap: Record<DocType, string> = {
    registration: "Registration",
    insurance: "Insurance",
    id_card: "Driver's License",
  };

  if (!docType) return null;

  const stateValue = docType === "registration" ? regState : idcState;
  const setStateValue = docType === "registration" ? setRegState : setIdcState;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.sheetOverlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <View style={[walletStyles.formSheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{isEditing ? "Edit" : "Add"} {titleMap[docType]}</Text>

          <ScrollView
            style={walletStyles.formScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.sheetFields}>

              {docType === "registration" && (
                <>
                  <View style={styles.sheetField}>
                    <Text style={styles.sheetFieldLabel}>State</Text>
                    <Pressable
                      style={[styles.sheetInput, walletStyles.pickerTrigger]}
                      onPress={() => setShowStatePicker(true)}
                    >
                      <Text style={regState ? walletStyles.pickerTriggerText : walletStyles.pickerTriggerPlaceholder}>
                        {regState || "Select state"}
                      </Text>
                      <Ionicons name="chevron-down" size={16} color={Colors.textSecondary} />
                    </Pressable>
                  </View>
                  <View style={styles.sheetField}>
                    <Text style={styles.sheetFieldLabel}>Plate Number</Text>
                    <TextInput
                      style={styles.sheetInput} value={regPlate} onChangeText={setRegPlate}
                      placeholder="e.g. ABC1234" placeholderTextColor={Colors.textTertiary}
                      autoCapitalize="characters" returnKeyType="next"
                    />
                  </View>
                  <View style={styles.sheetField}>
                    <Text style={styles.sheetFieldLabel}>Registration #</Text>
                    <TextInput
                      style={styles.sheetInput} value={regNumber} onChangeText={setRegNumber}
                      placeholder="e.g. REG123456" placeholderTextColor={Colors.textTertiary}
                      secureTextEntry returnKeyType="next"
                    />
                  </View>
                  <View style={styles.sheetField}>
                    <Text style={styles.sheetFieldLabel}>Expiration Date</Text>
                    <View style={styles.dateStepper}>
                      <Pressable style={({ pressed }) => [styles.dateStepBtn, { opacity: pressed ? 0.7 : 1 }]} onPress={() => setRegExpiry(adjustDate(regExpiry, -1))}>
                        <Ionicons name="chevron-back" size={18} color={Colors.text} />
                      </Pressable>
                      <Text style={styles.dateStepValue}>{format(parseISO(regExpiry), "MMM d, yyyy")}</Text>
                      <Pressable style={({ pressed }) => [styles.dateStepBtn, { opacity: pressed ? 0.7 : 1 }]} onPress={() => setRegExpiry(adjustDate(regExpiry, 1))}>
                        <Ionicons name="chevron-forward" size={18} color={Colors.text} />
                      </Pressable>
                    </View>
                  </View>
                  <View style={styles.sheetField}>
                    <Text style={styles.sheetFieldLabel}>Registered Owner</Text>
                    <TextInput
                      style={styles.sheetInput} value={regOwner} onChangeText={setRegOwner}
                      placeholder="e.g. John Doe" placeholderTextColor={Colors.textTertiary}
                      autoCapitalize="words" returnKeyType="done"
                    />
                  </View>
                </>
              )}

              {docType === "insurance" && (
                <>
                  <View style={styles.sheetField}>
                    <Text style={styles.sheetFieldLabel}>Provider</Text>
                    <TextInput
                      style={styles.sheetInput} value={insProvider} onChangeText={setInsProvider}
                      placeholder="e.g. State Farm" placeholderTextColor={Colors.textTertiary}
                      autoCapitalize="words" returnKeyType="next"
                    />
                  </View>
                  <View style={styles.sheetField}>
                    <Text style={styles.sheetFieldLabel}>Policy Number</Text>
                    <TextInput
                      style={styles.sheetInput} value={insPolicyNum} onChangeText={setInsPolicyNum}
                      placeholder="e.g. POL-987654" placeholderTextColor={Colors.textTertiary}
                      secureTextEntry returnKeyType="next"
                    />
                  </View>
                  <View style={styles.sheetField}>
                    <Text style={styles.sheetFieldLabel}>
                      Group Number{" "}
                      <Text style={styles.sheetFieldOptional}>(optional)</Text>
                    </Text>
                    <TextInput
                      style={styles.sheetInput} value={insGroupNum} onChangeText={setInsGroupNum}
                      placeholder="e.g. GRP-001" placeholderTextColor={Colors.textTertiary}
                      secureTextEntry returnKeyType="next"
                    />
                  </View>
                  <View style={styles.sheetField}>
                    <Text style={styles.sheetFieldLabel}>Coverage Type</Text>
                    <View style={walletStyles.segControl}>
                      {COVERAGE_TYPES.map(ct => {
                        const isSelected = insCoverage === ct;
                        return (
                          <Pressable
                            key={ct}
                            style={[walletStyles.segOption, isSelected && walletStyles.segOptionSelected]}
                            onPress={() => { Haptics.selectionAsync(); setInsCoverage(ct); }}
                          >
                            <Text
                              style={[walletStyles.segOptionText, isSelected && walletStyles.segOptionTextSelected]}
                              numberOfLines={2}
                            >
                              {ct}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                  <View style={styles.sheetField}>
                    <Text style={styles.sheetFieldLabel}>Expiration Date</Text>
                    <View style={styles.dateStepper}>
                      <Pressable style={({ pressed }) => [styles.dateStepBtn, { opacity: pressed ? 0.7 : 1 }]} onPress={() => setInsExpiry(adjustDate(insExpiry, -1))}>
                        <Ionicons name="chevron-back" size={18} color={Colors.text} />
                      </Pressable>
                      <Text style={styles.dateStepValue}>{format(parseISO(insExpiry), "MMM d, yyyy")}</Text>
                      <Pressable style={({ pressed }) => [styles.dateStepBtn, { opacity: pressed ? 0.7 : 1 }]} onPress={() => setInsExpiry(adjustDate(insExpiry, 1))}>
                        <Ionicons name="chevron-forward" size={18} color={Colors.text} />
                      </Pressable>
                    </View>
                  </View>
                  <View style={styles.sheetField}>
                    <Text style={styles.sheetFieldLabel}>
                      Agent Name{" "}
                      <Text style={styles.sheetFieldOptional}>(optional)</Text>
                    </Text>
                    <TextInput
                      style={styles.sheetInput} value={insAgent} onChangeText={setInsAgent}
                      placeholder="e.g. Jane Smith" placeholderTextColor={Colors.textTertiary}
                      autoCapitalize="words" returnKeyType="next"
                    />
                  </View>
                  <View style={styles.sheetField}>
                    <Text style={styles.sheetFieldLabel}>
                      Agent Phone{" "}
                      <Text style={styles.sheetFieldOptional}>(optional)</Text>
                    </Text>
                    <TextInput
                      style={styles.sheetInput} value={insAgentPhone} onChangeText={setInsAgentPhone}
                      placeholder="e.g. 847-555-1234" placeholderTextColor={Colors.textTertiary}
                      keyboardType="phone-pad" returnKeyType="next"
                    />
                  </View>
                  <View style={styles.sheetField}>
                    <Text style={styles.sheetFieldLabel}>
                      Claims Phone{" "}
                      <Text style={styles.sheetFieldOptional}>(optional)</Text>
                    </Text>
                    <TextInput
                      style={styles.sheetInput} value={insClaimsPhone} onChangeText={setInsClaimsPhone}
                      placeholder="e.g. 800-555-0000" placeholderTextColor={Colors.textTertiary}
                      keyboardType="phone-pad" returnKeyType="done"
                    />
                  </View>
                </>
              )}

              {docType === "id_card" && (
                <>
                  <View style={styles.sheetField}>
                    <Text style={styles.sheetFieldLabel}>Full Name</Text>
                    <TextInput
                      style={styles.sheetInput} value={idcName} onChangeText={setIdcName}
                      placeholder="e.g. John Doe" placeholderTextColor={Colors.textTertiary}
                      autoCapitalize="words" returnKeyType="next"
                    />
                  </View>
                  <View style={styles.sheetField}>
                    <Text style={styles.sheetFieldLabel}>License Number</Text>
                    <TextInput
                      style={styles.sheetInput} value={idcLicenseNum} onChangeText={setIdcLicenseNum}
                      placeholder="e.g. D123-4567-8901" placeholderTextColor={Colors.textTertiary}
                      secureTextEntry autoCapitalize="characters" returnKeyType="next"
                    />
                  </View>
                  <View style={styles.sheetField}>
                    <Text style={styles.sheetFieldLabel}>State</Text>
                    <Pressable
                      style={[styles.sheetInput, walletStyles.pickerTrigger]}
                      onPress={() => setShowStatePicker(true)}
                    >
                      <Text style={idcState ? walletStyles.pickerTriggerText : walletStyles.pickerTriggerPlaceholder}>
                        {idcState || "Select state"}
                      </Text>
                      <Ionicons name="chevron-down" size={16} color={Colors.textSecondary} />
                    </Pressable>
                  </View>
                  <View style={styles.sheetField}>
                    <Text style={styles.sheetFieldLabel}>Class</Text>
                    <TextInput
                      style={styles.sheetInput} value={idcClass} onChangeText={setIdcClass}
                      placeholder="e.g. D" placeholderTextColor={Colors.textTertiary}
                      autoCapitalize="characters" returnKeyType="next"
                    />
                  </View>
                  <View style={styles.sheetField}>
                    <Text style={styles.sheetFieldLabel}>Expiration Date</Text>
                    <View style={styles.dateStepper}>
                      <Pressable style={({ pressed }) => [styles.dateStepBtn, { opacity: pressed ? 0.7 : 1 }]} onPress={() => setIdcExpiry(adjustDate(idcExpiry, -1))}>
                        <Ionicons name="chevron-back" size={18} color={Colors.text} />
                      </Pressable>
                      <Text style={styles.dateStepValue}>{format(parseISO(idcExpiry), "MMM d, yyyy")}</Text>
                      <Pressable style={({ pressed }) => [styles.dateStepBtn, { opacity: pressed ? 0.7 : 1 }]} onPress={() => setIdcExpiry(adjustDate(idcExpiry, 1))}>
                        <Ionicons name="chevron-forward" size={18} color={Colors.text} />
                      </Pressable>
                    </View>
                  </View>
                  <View style={styles.sheetField}>
                    <Text style={styles.sheetFieldLabel}>Date of Birth</Text>
                    <View style={styles.dateStepper}>
                      <Pressable style={({ pressed }) => [styles.dateStepBtn, { opacity: pressed ? 0.7 : 1 }]} onPress={() => setIdcDob(adjustDate(idcDob, -1))}>
                        <Ionicons name="chevron-back" size={18} color={Colors.text} />
                      </Pressable>
                      <Text style={styles.dateStepValue}>{format(parseISO(idcDob), "MMM d, yyyy")}</Text>
                      <Pressable style={({ pressed }) => [styles.dateStepBtn, { opacity: pressed ? 0.7 : 1 }]} onPress={() => setIdcDob(adjustDate(idcDob, 1))}>
                        <Ionicons name="chevron-forward" size={18} color={Colors.text} />
                      </Pressable>
                    </View>
                  </View>
                </>
              )}

            </View>

            {isEditing && (
              <Pressable
                style={({ pressed }) => [walletStyles.deleteBtn, { opacity: pressed || isDeleting ? 0.7 : 1 }]}
                onPress={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting
                  ? <ActivityIndicator size="small" color={Colors.overdue} />
                  : <Text style={walletStyles.deleteBtnText}>Delete Document</Text>
                }
              </Pressable>
            )}
          </ScrollView>

          <View style={styles.sheetActions}>
            <Pressable
              style={({ pressed }) => [styles.sheetCancelBtn, { opacity: pressed ? 0.8 : 1 }]}
              onPress={onClose}
            >
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.sheetSaveBtn, { opacity: pressed || isSaving ? 0.8 : 1 }]}
              onPress={handleSave}
              disabled={isSaving}
            >
              {isSaving
                ? <ActivityIndicator size="small" color={Colors.textInverse} />
                : <Text style={styles.sheetSaveText}>Save</Text>
              }
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      <StatePickerModal
        visible={showStatePicker}
        selected={stateValue}
        onSelect={setStateValue}
        onClose={() => setShowStatePicker(false)}
      />
    </Modal>
  );
}

function WalletTab({
  vehicleId, userId,
}: {
  vehicleId: string; userId: string;
}) {
  const insets = useSafeAreaInsets();

  const { data: docs, isLoading } = useQuery<WalletDoc[]>({
    queryKey: ["wallet_docs", vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicle_wallet_documents")
        .select("*")
        .eq("vehicle_id", vehicleId)
        .eq("user_id", userId);
      if (error) throw error;
      return (data ?? []) as WalletDoc[];
    },
  });

  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [sheetDocType, setSheetDocType] = useState<DocType | null>(null);
  const [editingDoc, setEditingDoc] = useState<WalletDoc | null>(null);

  function toggle(key: string) {
    Haptics.selectionAsync();
    setRevealed(prev => ({ ...prev, [key]: !prev[key] }));
  }

  function openAdd(dt: DocType) {
    setEditingDoc(null);
    setSheetDocType(dt);
  }

  function openEdit(dt: DocType) {
    const doc = docs?.find(d => d.document_type === dt) ?? null;
    setEditingDoc(doc);
    setSheetDocType(dt);
  }

  function closeSheet() {
    setSheetDocType(null);
    setEditingDoc(null);
  }

  const reg = docs?.find(d => d.document_type === "registration")?.data ?? null;
  const ins = docs?.find(d => d.document_type === "insurance")?.data ?? null;
  const idc = docs?.find(d => d.document_type === "id_card")?.data ?? null;

  if (isLoading) {
    return (
      <View style={walletStyles.loading}>
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }

  return (
    <View style={walletStyles.container}>
      {/* ── Registration ──────────────────────────── */}
      <WalletCard
        title="Registration"
        icon="document-text-outline"
        accentColor={Colors.blue}
        onEdit={() => openEdit("registration")}
      >
        {reg ? (
          <>
            <View style={walletStyles.badgeRow}>
              <ExpiryBadge dateStr={reg.expiration_date} />
            </View>
            <PlainRow label="State" value={reg.state} />
            <PlainRow label="Plate" value={reg.plate_number} />
            <MaskedRow label="Reg #" value={reg.registration_number} fieldKey="reg_num" revealed={!!revealed.reg_num} onToggle={() => toggle("reg_num")} />
            <PlainRow label="Expires" value={reg.expiration_date ? format(parseISO(reg.expiration_date), "MMM d, yyyy") : null} />
            <PlainRow label="Owner" value={reg.registered_owner} />
          </>
        ) : (
          <View style={walletStyles.emptyCard}>
            <Text style={walletStyles.emptyCardText}>No registration saved</Text>
            <Pressable style={walletStyles.addBtn} onPress={() => openAdd("registration")}>
              <Ionicons name="add" size={14} color={Colors.blue} />
              <Text style={[walletStyles.addBtnText, { color: Colors.blue }]}>Add Registration</Text>
            </Pressable>
          </View>
        )}
      </WalletCard>

      {/* ── Insurance ─────────────────────────────── */}
      <WalletCard
        title="Insurance"
        icon="shield-checkmark-outline"
        accentColor={Colors.good}
        onEdit={() => openEdit("insurance")}
      >
        {ins ? (
          <>
            <View style={walletStyles.badgeRow}>
              <ExpiryBadge dateStr={ins.expiration_date} />
            </View>
            <PlainRow label="Provider" value={ins.provider} />
            <MaskedRow label="Policy #" value={ins.policy_number} fieldKey="pol_num" revealed={!!revealed.pol_num} onToggle={() => toggle("pol_num")} />
            {!!ins.group_number && (
              <MaskedRow label="Group #" value={ins.group_number} fieldKey="grp_num" revealed={!!revealed.grp_num} onToggle={() => toggle("grp_num")} />
            )}
            <PlainRow label="Coverage" value={ins.coverage_type} />
            <PlainRow label="Expires" value={ins.expiration_date ? format(parseISO(ins.expiration_date), "MMM d, yyyy") : null} />
            <PlainRow label="Agent" value={ins.agent_name} />
            <PhoneRow label="Agent Phone" phone={ins.agent_phone} />
            <PhoneRow label="Claims" phone={ins.claims_phone} />
          </>
        ) : (
          <View style={walletStyles.emptyCard}>
            <Text style={walletStyles.emptyCardText}>No insurance saved</Text>
            <Pressable style={walletStyles.addBtn} onPress={() => openAdd("insurance")}>
              <Ionicons name="add" size={14} color={Colors.good} />
              <Text style={[walletStyles.addBtnText, { color: Colors.good }]}>Add Insurance</Text>
            </Pressable>
          </View>
        )}
      </WalletCard>

      {/* ── Driver's License ──────────────────────── */}
      <WalletCard
        title="Driver's License"
        icon="card-outline"
        accentColor={Colors.vehicle}
        onEdit={() => openEdit("id_card")}
      >
        {idc ? (
          <>
            <View style={walletStyles.badgeRow}>
              <ExpiryBadge dateStr={idc.expiration_date} />
            </View>
            <PlainRow label="Name" value={idc.full_name} />
            <MaskedRow label="License #" value={idc.license_number} fieldKey="lic_num" revealed={!!revealed.lic_num} onToggle={() => toggle("lic_num")} />
            <PlainRow label="State" value={idc.state} />
            <PlainRow label="Class" value={idc.class} />
            <PlainRow label="Expires" value={idc.expiration_date ? format(parseISO(idc.expiration_date), "MMM d, yyyy") : null} />
            <MaskedRow label="Date of Birth" value={idc.date_of_birth} fieldKey="dob" revealed={!!revealed.dob} onToggle={() => toggle("dob")} />
          </>
        ) : (
          <View style={walletStyles.emptyCard}>
            <Text style={walletStyles.emptyCardText}>No ID saved</Text>
            <Pressable style={walletStyles.addBtn} onPress={() => openAdd("id_card")}>
              <Ionicons name="add" size={14} color={Colors.vehicle} />
              <Text style={[walletStyles.addBtnText, { color: Colors.vehicle }]}>Add Driver's License</Text>
            </Pressable>
          </View>
        )}
      </WalletCard>

      <WalletFormSheet
        visible={!!sheetDocType}
        docType={sheetDocType}
        existingDoc={editingDoc}
        vehicleId={vehicleId}
        userId={userId}
        onClose={closeSheet}
        onSaved={closeSheet}
        insets={insets}
      />
    </View>
  );
}

const walletStyles = StyleSheet.create({
  container: { gap: 14 },
  loading: { paddingVertical: 40, alignItems: "center" },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  cardHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardIconWrap: {
    width: 32, height: 32, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
  },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.text },
  badgeRow: { paddingHorizontal: 16, paddingTop: 10, flexDirection: "row", gap: 6 },
  badgeExpired: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
    backgroundColor: Colors.overdueMuted,
  },
  badgeExpiredText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.overdue },
  badgeSoon: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
    backgroundColor: Colors.dueSoonMuted,
  },
  badgeSoonText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.dueSoon },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
  },
  rowLabel: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, flex: 1 },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 8, flex: 2, justifyContent: "flex-end" },
  rowValue: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.text, textAlign: "right", flex: 1 },
  rowMasked: { fontFamily: "Inter_400Regular", letterSpacing: 2, color: Colors.textTertiary },
  rowPhone: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.blue },
  emptyCard: { padding: 20, alignItems: "center", gap: 10 },
  emptyCardText: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  addBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  addBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  formSheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 12, paddingHorizontal: 20,
    maxHeight: "90%",
  },
  formScroll: { marginTop: 4 },
  deleteBtn: {
    marginTop: 8, marginBottom: 16,
    paddingVertical: 14, alignItems: "center",
    borderRadius: 12, borderWidth: 1,
    borderColor: Colors.overdueMuted,
  },
  deleteBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.overdue },
  pickerOverlay: { flex: 1, justifyContent: "flex-end" },
  pickerBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
  pickerContainer: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 12, maxHeight: "60%",
  },
  pickerHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  pickerTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.text },
  pickerScroll: { paddingBottom: 32 },
  pickerOption: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  pickerOptionSelected: { backgroundColor: Colors.accent + "12" },
  pickerOptionText: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.text },
  pickerOptionTextSelected: { fontFamily: "Inter_600SemiBold", color: Colors.accent },
  pickerTrigger: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  pickerTriggerText: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.text },
  pickerTriggerPlaceholder: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  segControl: {
    flexDirection: "row",
    gap: 6,
  },
  segOption: {
    flex: 1, paddingVertical: 8, paddingHorizontal: 6,
    borderRadius: 10, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.surface, alignItems: "center",
  },
  segOptionSelected: {
    backgroundColor: Colors.accent + "22",
    borderColor: Colors.accent,
  },
  segOptionText: { fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.textSecondary, textAlign: "center" },
  segOptionTextSelected: { color: Colors.accent, fontFamily: "Inter_600SemiBold" },
});
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
