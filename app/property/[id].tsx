import React, { useMemo, useState, useRef, useEffect } from "react";
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
  Animated,
  Image,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { formatShopAndDiy } from "@/lib/costFormat";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import { parseISO, isBefore, addDays, addMonths, format } from "date-fns";
import { SaveToast } from "@/components/SaveToast";
import DatePicker from "@/components/DatePicker";
import Tooltip, { TOOLTIP_IDS } from "@/components/Tooltip";

function getStatus(nextDueDate: string | null, lastCompletedAt: string | null): "overdue" | "due_soon" | "upcoming" | "good" {
  const now = new Date();
  const soon = addDays(now, 30);
  if (nextDueDate) {
    const due = parseISO(nextDueDate);
    if (isBefore(due, now)) return "overdue";
    if (isBefore(due, soon)) return "due_soon";
    return "upcoming";
  }
  if (!lastCompletedAt) return "upcoming";
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
  const [upcomingExpanded, setUpcomingExpanded] = useState(false);

  const [markCompleteTask, setMarkCompleteTask] = useState<any | null>(null);
  const [completeDate, setCompleteDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [completeCost, setCompleteCost] = useState("");
  const [completeProvider, setCompleteProvider] = useState("");
  const [completeNotes, setCompleteNotes] = useState("");
  const [completeDuration, setCompleteDuration] = useState("");
  const [completeDiy, setCompleteDiy] = useState(false);
  const [isSavingComplete, setIsSavingComplete] = useState(false);

  const [toastMsg, setToastMsg] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [toastIsError, setToastIsError] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Skeleton / polling / animation state
  const prevTaskCountRef = useRef(0);
  const scheduleOpacity = useRef(new Animated.Value(0)).current;
  const [scheduleTimedOut, setScheduleTimedOut] = useState(false);
  const pollingStartRef = useRef<number | null>(null);

  function showToast(msg: string, isError = false) {
    setToastMsg(msg);
    setToastIsError(isError);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2800);
  }

  function buildCsv(logsData: any[]) {
    const header = "Date,Service,Cost,Provider,DIY,Notes";
    const rows = logsData.map(log => {
      const date = log.service_date ?? "";
      const task = (log.service_name ?? "").replace(/,/g, ";");
      const cost = log.cost != null ? `$${Number(log.cost).toFixed(2)}` : "";
      const provider = (log.provider_name ?? "").replace(/,/g, ";");
      const diy = log.did_it_myself ? "Yes" : "No";
      const notes = (log.notes ?? "").replace(/,/g, ";").replace(/\n/g, " ");
      return `${date},${task},${cost},${provider},${diy},${notes}`;
    });
    return [header, ...rows, "", "Data is self-reported by the property owner and has not been independently verified."].join("\n");
  }

  const { data: property, isLoading: loadingProperty } = useQuery({
    queryKey: ["property", id],
    queryFn: async () => {
      const { data } = await supabase.from("properties").select("*").eq("id", id).maybeSingle();
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
    refetchInterval: (query: { state: { data: unknown } }) => {
      const isEmpty = ((query.state.data as any[] | undefined)?.length ?? 0) === 0;
      if (!isEmpty) return false;
      if (scheduleTimedOut) return false;
      if (!pollingStartRef.current) pollingStartRef.current = Date.now();
      if (Date.now() - pollingStartRef.current > 45000) {
        setScheduleTimedOut(true);
        return false;
      }
      return 3000;
    },
  });

  function handleRetrySchedule() {
    setScheduleTimedOut(false);
    pollingStartRef.current = Date.now();
    refetch();
  }

  useEffect(() => {
    setScheduleTimedOut(false);
    pollingStartRef.current = null;
  }, [id]);

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

  const scheduleTasks = tasks;

  const { data: costEstimates } = useQuery({
    queryKey: ["property_repair_costs", id, property?.property_type, scheduleTasks?.length ?? 0],
    queryFn: async () => {
      if (!property || !scheduleTasks?.length) return {};
      const results: Record<string, any> = {};
      const serviceNames = scheduleTasks.map((t: any) => t.task.toLowerCase().trim());
      const propertyKey = `${property.year_built ?? ""}|${property.property_type}||property_${property.property_type}`.toLowerCase();

      const { data: cachedData } = await supabase
        .from("repair_cost_cache")
        .select("*")
        .eq("vehicle_key", propertyKey)
        .in("service_name", serviceNames);

      for (const item of cachedData ?? []) {
        results[item.service_name] = item;
      }
      return results;
    },
    enabled: !!property && (scheduleTasks?.length ?? 0) > 0,
  });

  async function handleExportHistory() {
    if (!logs || logs.length === 0 || !property) return;
    setIsExporting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const propName = property.nickname ?? property.address ?? "Property";
      const rows = logs
        .sort((a: any, b: any) => (b.service_date ?? "").localeCompare(a.service_date ?? ""))
        .map((log: any) => `
          <tr>
            <td>${log.service_date ? format(parseISO(log.service_date), "MMM d, yyyy") : "—"}</td>
            <td>${log.service_name ?? "—"}</td>
            <td>${log.provider_name ?? "—"}</td>
            <td>${log.cost != null ? `$${Number(log.cost).toFixed(2)}` : "—"}</td>
            <td>${log.notes ?? ""}</td>
          </tr>`)
        .join("");
      const totalSpent = logs.reduce((s: number, l: any) => s + (l.cost ?? 0), 0);

      const html = `
        <html><head><style>
          body { font-family: -apple-system, Helvetica, Arial, sans-serif; padding: 32px; color: #1a1a2e; }
          h1 { font-size: 22px; margin-bottom: 4px; }
          h2 { font-size: 14px; color: #666; margin-bottom: 24px; font-weight: normal; }
          table { width: 100%; border-collapse: collapse; font-size: 13px; }
          th { text-align: left; padding: 8px 6px; border-bottom: 2px solid #ddd; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; }
          td { padding: 8px 6px; border-bottom: 1px solid #eee; }
          .total { margin-top: 20px; font-size: 14px; font-weight: 600; }
          .footer { margin-top: 32px; font-size: 11px; color: #999; }
        </style></head><body>
          <h1>${propName} — Maintenance History</h1>
          <h2>${logs.length} service${logs.length === 1 ? "" : "s"} recorded</h2>
          <table>
            <tr><th>Date</th><th>Service</th><th>Provider</th><th>Cost</th><th>Notes</th></tr>
            ${rows}
          </table>
          <p class="total">Total spent: $${totalSpent.toFixed(2)}</p>
          <p class="footer">Generated by LifeMaintained · ${format(new Date(), "MMMM d, yyyy")}</p>
        </body></html>
      `;

      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: `${propName} History` });
    } catch (err: any) {
      showToast("Failed to export history", true);
    } finally {
      setIsExporting(false);
    }
  }

  async function handleExportCsv() {
    if (!logs || logs.length === 0 || !property) return;
    setIsExportingCsv(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const csv = buildCsv(logs);
      const csvPath = `${FileSystem.cacheDirectory}property-history.csv`;
      await FileSystem.writeAsStringAsync(csvPath, csv);
      await Sharing.shareAsync(csvPath, { mimeType: "text/csv" });
    } catch {
      showToast("Failed to export CSV", true);
    } finally {
      setIsExportingCsv(false);
    }
  }

  function handleOpenMarkComplete(task: any) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMarkCompleteTask(task);
    setCompleteDate(format(new Date(), "yyyy-MM-dd"));
    setCompleteCost("");
    setCompleteProvider("");
    setCompleteNotes("");
    setCompleteDuration("");
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

      const durTrim = completeDuration.trim();
      const notesForLog = (() => {
        const parts: string[] = [];
        if (completeNotes.trim()) parts.push(completeNotes.trim());
        if (durTrim) {
          const dm = parseInt(durTrim, 10);
          if (!isNaN(dm) && dm > 0) parts.push(`Time spent: ${dm} min`);
        }
        return parts.length ? parts.join("\n\n") : null;
      })();

      const { error: rpcError } = await supabase.rpc("complete_property_task", {
        p_task_id: task.id,
        p_completed_date: completedAt,
        p_notes: notesForLog,
        p_cost: costNum,
        p_provider_name: completeProvider.trim() || null,
        p_did_it_myself: completeDiy,
      });

      if (rpcError) throw rpcError;

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

  function handlePropertyPhoto() {
    if (!user || !id) return;
    if (property?.photo_url) {
      Alert.alert("Property Photo", "Choose an option", [
        { text: "Take Photo", onPress: () => pickPropertyPhoto("camera") },
        { text: "Choose from Library", onPress: () => pickPropertyPhoto("library") },
        { text: "Remove Photo", style: "destructive", onPress: removePropertyPhoto },
        { text: "Cancel", style: "cancel" },
      ]);
    } else {
      Alert.alert("Add Photo", "Choose an option", [
        { text: "Take Photo", onPress: () => pickPropertyPhoto("camera") },
        { text: "Choose from Library", onPress: () => pickPropertyPhoto("library") },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  }

  async function pickPropertyPhoto(source: "camera" | "library") {
    try {
      const result = source === "camera"
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: true, aspect: [16, 9] })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: true, aspect: [16, 9] });
      if (result.canceled) return;
      const uri = result.assets[0].uri;
      setUploadingPhoto(true);
      try {
        const response = await fetch(uri);
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const storagePath = `${user!.id}/${id}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from("property-photos")
          .upload(storagePath, arrayBuffer, { contentType: "image/jpeg", upsert: true });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("property-photos").getPublicUrl(storagePath);
        const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;
        await supabase.from("properties").update({ photo_url: publicUrl }).eq("id", id!);
        queryClient.invalidateQueries({ queryKey: ["property", id] });
      } finally {
        setUploadingPhoto(false);
      }
    } catch {
      setUploadingPhoto(false);
      showToast("Failed to upload photo", true);
    }
  }

  async function removePropertyPhoto() {
    if (!user || !id) return;
    setUploadingPhoto(true);
    try {
      await supabase.from("properties").update({ photo_url: null }).eq("id", id!);
      const storagePath = `${user.id}/${id}.jpg`;
      await supabase.storage.from("property-photos").remove([storagePath]);
      queryClient.invalidateQueries({ queryKey: ["property", id] });
    } catch {
      showToast("Failed to remove photo", true);
    } finally {
      setUploadingPhoto(false);
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

  // Fade-in + haptic when schedule first populates; reset when tasks clear
  useEffect(() => {
    const count = tasks?.length ?? 0;
    if (count === 0) {
      scheduleOpacity.setValue(0);
      prevTaskCountRef.current = 0;
      return;
    }
    if (prevTaskCountRef.current === 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Animated.timing(scheduleOpacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();
    }
    prevTaskCountRef.current = count;
  }, [tasks, scheduleOpacity]);

  const isLoading = loadingProperty || loadingTasks;
  const propertyName = property ? (property.nickname ?? property.address ?? "Property") : "Property";

  // Insight card: pick the most urgent task
  const insightText = useMemo(() => {
    if (!tasks || tasks.length === 0) return null;
    const overdue = tasks.filter(t => getStatus(t.next_due_date, t.last_completed_at) === "overdue");
    if (overdue.length > 0) return `${overdue[0].task} is overdue — take care of it soon to avoid bigger issues.`;
    const dueSoon = tasks.filter(t => getStatus(t.next_due_date, t.last_completed_at) === "due_soon");
    if (dueSoon.length > 0) return `${dueSoon[0].task} is coming up soon. Stay ahead of your maintenance.`;
    return null;
  }, [tasks]);

  // Show estimated banner when no tasks have been completed
  const showEstimatedBanner = useMemo(() => {
    if (!tasks || tasks.length === 0) return false;
    return !tasks.some(t => t.last_completed_at != null);
  }, [tasks]);

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
  const upcomingTasks = useMemo(
    () => tasks?.filter(t => getStatus(t.next_due_date, t.last_completed_at) === "upcoming") ?? [],
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

      {property?.photo_url ? (
        <Pressable onPress={handlePropertyPhoto} style={{ position: "relative" }}>
          <Image source={{ uri: property.photo_url }} style={styles.photoHeader} resizeMode="cover" />
          {uploadingPhoto && (
            <View style={styles.photoOverlay}>
              <ActivityIndicator color="#fff" />
            </View>
          )}
          <View style={styles.photoEditBadge}>
            <Ionicons name="camera-outline" size={14} color="#fff" />
          </View>
        </Pressable>
      ) : (
        <Pressable onPress={handlePropertyPhoto} style={styles.photoPlaceholder}>
          {uploadingPhoto ? (
            <ActivityIndicator color={Colors.textTertiary} />
          ) : (
            <>
              <Ionicons name="camera-outline" size={20} color={Colors.textTertiary} />
              <Text style={styles.photoPlaceholderText}>Add a photo</Text>
            </>
          )}
        </Pressable>
      )}

      {isLoading ? (
        <ActivityIndicator color={Colors.accent} style={{ marginTop: 60 }} />
      ) : !property ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 32 }}>
          <Text style={{ fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text, textAlign: "center" }}>Property not found</Text>
          <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center" }}>This property may have been deleted.</Text>
          <Pressable
            onPress={() => router.back()}
            style={{ paddingHorizontal: 24, paddingVertical: 12, backgroundColor: Colors.accent, borderRadius: 12 }}
          >
            <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.textInverse }}>Go Back</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          stickyHeaderIndices={[0]}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={() => { handleRetrySchedule(); refetchLogs(); }}
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
              <Tooltip
                id={TOOLTIP_IDS.PROPERTY_DETAIL_SCHEDULE}
                message="Your home maintenance plan is built for your property type and age. Tap any task to mark it done."
                icon="home-outline"
              />
              <Pressable
                style={({ pressed }) => [styles.addTaskBtn, { opacity: pressed ? 0.8 : 1 }]}
                onPress={() => router.push(`/add-property-task/${id}` as any)}
              >
                <Ionicons name="add" size={18} color={Colors.textInverse} />
                <Text style={styles.addTaskBtnText}>Add Task</Text>
              </Pressable>

              {(tasks?.length ?? 0) === 0 && !loadingTasks ? (
                scheduleTimedOut ? (
                  <View style={styles.emptyState}>
                    <Ionicons name="alert-circle-outline" size={36} color={Colors.textTertiary} />
                    <Text style={styles.emptyStateTitle}>Couldn't load your schedule</Text>
                    <Text style={styles.emptyStateText}>
                      This can happen if the server is busy. Tap below to try again.
                    </Text>
                    <Pressable
                      style={({ pressed }) => [styles.retryBtn, { opacity: pressed ? 0.8 : 1 }]}
                      onPress={handleRetrySchedule}
                    >
                      <Ionicons name="refresh" size={16} color={Colors.home} />
                      <Text style={styles.retryBtnText}>Try Again</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.skeletonWrap}>
                    <Text style={styles.skeletonTitle}>Building your maintenance plan</Text>
                    <Text style={styles.skeletonSubtitle}>This can take up to a minute</Text>
                    <PropertySkeleton />
                  </View>
                )
              ) : (tasks?.length ?? 0) === 0 ? null : (
                <Animated.View style={{ opacity: scheduleOpacity }}>
                  {insightText && (
                    <View style={styles.insightCard}>
                      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                        <Ionicons name="bulb-outline" size={16} color={Colors.home} style={{ marginTop: 2 }} />
                        <Text style={styles.insightText}>{insightText}</Text>
                      </View>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary, marginTop: 2, paddingLeft: 0 }}>
                        Based on your property type and age
                      </Text>
                    </View>
                  )}

                  {showEstimatedBanner && (
                    <View style={styles.estimatedBanner}>
                      <Ionicons name="information-circle-outline" size={16} color={Colors.dueSoon} />
                      <Text style={styles.estimatedBannerText}>
                        This schedule is estimated from your property details. Tap any task to log your last service date for more accurate due dates.
                      </Text>
                    </View>
                  )}

                  {actionNeededTasks.length > 0 && (
                    <TaskSection
                      title={`Action Needed (${actionNeededTasks.length})`}
                      titleColor={Colors.overdue}
                      expanded={actionNeededExpanded}
                      onToggle={() => { Haptics.selectionAsync(); setActionNeededExpanded(v => !v); }}
                      tasks={actionNeededTasks}
                      onMarkComplete={handleOpenMarkComplete}
                      costEstimates={costEstimates}
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
                      costEstimates={costEstimates}
                    />
                  )}
                  {upcomingTasks.length > 0 && (
                    <TaskSection
                      title={`Upcoming (${upcomingTasks.length})`}
                      titleColor={Colors.textSecondary}
                      expanded={upcomingExpanded}
                      onToggle={() => { Haptics.selectionAsync(); setUpcomingExpanded(v => !v); }}
                      tasks={upcomingTasks}
                      onMarkComplete={handleOpenMarkComplete}
                      costEstimates={costEstimates}
                    />
                  )}
                </Animated.View>
              )}
            </View>
          ) : (
            <View style={styles.tasksArea}>
              <Tooltip
                id={TOOLTIP_IDS.PROPERTY_HISTORY}
                message="Your complete home service record. Export to PDF or CSV to share with buyers or contractors."
                icon="time-outline"
              />
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

                  <View style={styles.exportBtnRow}>
                    <Pressable
                      style={({ pressed }) => [styles.exportBtn, styles.exportBtnHalf, { opacity: pressed || isExporting ? 0.7 : 1 }]}
                      onPress={handleExportHistory}
                      disabled={isExporting}
                    >
                      {isExporting ? (
                        <ActivityIndicator size="small" color={Colors.home} />
                      ) : (
                        <>
                          <Ionicons name="document-text-outline" size={16} color={Colors.home} />
                          <Text style={styles.exportBtnText}>Share PDF</Text>
                        </>
                      )}
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [styles.exportBtn, styles.exportBtnHalf, { opacity: pressed || isExportingCsv ? 0.7 : 1 }]}
                      onPress={handleExportCsv}
                      disabled={isExportingCsv}
                    >
                      {isExportingCsv ? (
                        <ActivityIndicator size="small" color={Colors.home} />
                      ) : (
                        <>
                          <Ionicons name="download-outline" size={16} color={Colors.home} />
                          <Text style={styles.exportBtnText}>Export as CSV</Text>
                        </>
                      )}
                    </Pressable>
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
                  <DatePicker
                    label="Date Completed"
                    value={completeDate}
                    onChange={setCompleteDate}
                    maximumDate={new Date()}
                  />
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

                <View style={styles.sheetField}>
                  <Text style={styles.sheetFieldLabel}>
                    Time spent (minutes) <Text style={{ color: Colors.textTertiary }}>(optional)</Text>
                  </Text>
                  <TextInput
                    style={styles.sheetInput}
                    value={completeDuration}
                    onChangeText={t => {
                      const cleaned = t.replace(/[^0-9]/g, "").slice(0, 4);
                      setCompleteDuration(cleaned);
                    }}
                    keyboardType="number-pad"
                    placeholder="e.g. 45"
                    placeholderTextColor={Colors.textTertiary}
                    returnKeyType="done"
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
  costEstimates,
}: {
  title: string;
  titleColor?: string;
  expanded: boolean;
  onToggle: () => void;
  tasks: any[];
  onMarkComplete: (task: any) => void;
  costEstimates?: Record<string, any>;
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
              costEstimates={costEstimates}
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
  costEstimates,
}: {
  task: any;
  onMarkComplete: (task: any) => void;
  isLast: boolean;
  costEstimates?: Record<string, any>;
}) {
  const status = getStatus(task.next_due_date, task.last_completed_at);
  const barColor = status === "overdue" ? Colors.overdue : status === "due_soon" ? Colors.dueSoon : status === "upcoming" ? Colors.textSecondary : Colors.good;
  const isCompleted = status === "good";
  const [showCompletedInfo, setShowCompletedInfo] = useState(false);

  let dueText: string;
  if (isCompleted && task.last_completed_at) {
    const completed = new Date(task.last_completed_at).getTime();
    const created = task.created_at ? new Date(task.created_at).getTime() : 0;
    if (Math.abs(completed - created) < 60000) {
      dueText = "Unknown — tap to log last service";
    } else {
      dueText = `Completed ${format(parseISO(task.last_completed_at), "MMM d, yyyy")}`;
    }
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
        {!isCompleted && (() => {
          const est = costEstimates?.[task.task.toLowerCase().trim()];
          if (est?.shop_low != null) {
            const shopLow = Number(est.shop_low);
            const shopHigh = Number(est.shop_high);
            const diyLow = est.diy_low != null ? Number(est.diy_low) : null;
            const diyHigh = est.diy_high != null ? Number(est.diy_high) : null;
            const costLine = formatShopAndDiy(shopLow, shopHigh, diyLow, diyHigh);
            if (!costLine) return null;
            return (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
                <Ionicons name="cash-outline" size={12} color={Colors.good} />
                <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.good }}>
                  {costLine}
                </Text>
                {est.difficulty != null && (
                  <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium", color: est.difficulty === 1 ? Colors.good : est.difficulty === 2 ? Colors.dueSoon : Colors.overdue, backgroundColor: est.difficulty === 1 ? Colors.goodMuted : est.difficulty === 2 ? Colors.dueSoonMuted : Colors.overdueMuted, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: "hidden" }}>
                    {est.difficulty === 1 ? "Easy DIY" : est.difficulty === 2 ? "Moderate" : "Pro"}
                  </Text>
                )}
              </View>
            );
          }
          if (task.estimated_cost != null && task.estimated_cost > 0) {
            return (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 }}>
                <Ionicons name="cash-outline" size={12} color={Colors.good} />
                <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.good }}>
                  Est. ~${task.estimated_cost.toLocaleString()}
                </Text>
              </View>
            );
          }
          return null;
        })()}
        {!isCompleted && task.last_completed_at != null && (
          <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.vehicle, marginTop: 2 }}>
            Last completed {format(parseISO(task.last_completed_at), "MMM d, yyyy")}
          </Text>
        )}
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

function PropertySkeleton() {
  return (
    <View style={styles.skeletonContainer}>
      {[1, 2, 3, 4].map(i => (
        <View key={i} style={styles.skeletonCard}>
          <View style={{ width: 4, height: 28, borderRadius: 2, backgroundColor: Colors.surface, flexShrink: 0 }} />
          <View style={{ flex: 1, gap: 8 }}>
            <View style={styles.skeletonLine} />
            <View style={[styles.skeletonLine, { width: "55%" }]} />
          </View>
        </View>
      ))}
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
  photoHeader: { width: "100%", height: 200 },
  photoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  photoEditBadge: {
    position: "absolute",
    bottom: 10,
    right: 12,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 14,
    padding: 7,
  },
  photoPlaceholder: {
    height: 100,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 2,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: Colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  photoPlaceholderText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textTertiary,
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

  skeletonWrap: { alignItems: "center", gap: 16, paddingTop: 8 },
  skeletonTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.text, textAlign: "center" },
  skeletonSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textTertiary, textAlign: "center" },
  skeletonContainer: {
    backgroundColor: Colors.card, borderRadius: 14, overflow: "hidden",
    borderWidth: 1, borderColor: Colors.border, width: "100%",
  },
  skeletonCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  skeletonLine: { height: 14, borderRadius: 7, backgroundColor: Colors.surface, width: "80%" },

  insightCard: {
    flexDirection: "column", alignItems: "flex-start", gap: 4,
    backgroundColor: Colors.homeMuted, borderRadius: 14,
    padding: 14, borderWidth: 1, borderColor: Colors.home + "30",
  },
  insightText: {
    flex: 1, fontSize: 14, fontFamily: "Inter_500Medium",
    color: Colors.text, lineHeight: 20,
  },

  estimatedBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    backgroundColor: Colors.dueSoonMuted, borderRadius: 14,
    padding: 14, borderWidth: 1, borderColor: Colors.dueSoon + "30",
  },
  estimatedBannerText: {
    flex: 1, fontSize: 13, fontFamily: "Inter_400Regular",
    color: Colors.textSecondary, lineHeight: 19,
  },

  emptyState: { alignItems: "center", paddingVertical: 40, gap: 8 },
  emptyStateTitle: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.homeMuted,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: Colors.home + "30",
    marginTop: 8,
  },
  retryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.home },

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

  exportBtnRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
  },
  exportBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.homeMuted,
    borderRadius: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.home + "30",
  },
  exportBtnHalf: {
    flex: 1,
    minWidth: 0,
  },
  exportBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.home },

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
