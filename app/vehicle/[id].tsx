import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  Image,
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
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import * as Haptics from "expo-haptics";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";
import { parseISO, isBefore, addDays, addMonths, format, differenceInDays, formatDistanceToNowStrict } from "date-fns";
import { useAuth } from "@/context/AuthContext";
import Paywall from "@/components/Paywall";
import { hasPersonalOrAbove } from "@/lib/subscription";
import { SaveToast } from "@/components/SaveToast";
import { HOURS_TRACKED_TYPES, MILEAGE_TRACKED_TYPES } from "@/lib/vehicleTypes";

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
  const [scheduleToastIsError, setScheduleToastIsError] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [showDifficultyInfo, setShowDifficultyInfo] = useState(false);
  const lastStatusHashRef = useRef("");

  const [markCompleteTask, setMarkCompleteTask] = useState<any | null>(null);
  const [completeMileage, setCompleteMileage] = useState("");
  const [completeDate, setCompleteDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [completeNotes, setCompleteNotes] = useState("");
  const [completeCost, setCompleteCost] = useState("");
  const [completeProvider, setCompleteProvider] = useState("");
  const [completeDiy, setCompleteDiy] = useState(false);
  const [completeDuration, setCompleteDuration] = useState("");
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

  const { data: costEstimates } = useQuery({
    queryKey: ["repair_costs", id, vehicle?.make, scheduleTasks?.length ?? 0],
    queryFn: async () => {
      if (!vehicle || !scheduleTasks?.length) return {};
      const results: Record<string, any> = {};
      // Check cache first for all tasks
      const serviceNames = scheduleTasks.map(t => t.name.toLowerCase().trim());
      const vehicleKey = `${vehicle.year ?? ""}|${vehicle.make}|${vehicle.model ?? ""}|${vehicle.vehicle_type ?? ""}`.toLowerCase();

      const { data: cachedData, error: cacheErr } = await supabase
        .from("repair_cost_cache")
        .select("*")
        .eq("vehicle_key", vehicleKey)
        .in("service_name", serviceNames);
      if (cacheErr) {
        console.warn("[CostEstimate] cache read error:", cacheErr.message);
      }

      const cached = new Set<string>();
      for (const item of cachedData ?? []) {
        results[item.service_name] = item;
        cached.add(item.service_name);
      }

      // For uncached items, fetch estimates one at a time
      const uncached = serviceNames.filter((s: string) => !cached.has(s));
      for (const svc of uncached) {
        try {
          const { data: fnData, error: fnErr } = await supabase.functions.invoke("estimate-repair-cost", {
            body: {
              year: vehicle.year ?? null,
              make: vehicle.make,
              model: vehicle.model,
              service_name: svc,
              vehicle_type: vehicle.vehicle_type ?? "car",
            },
          });
          if (fnErr) {
            console.warn("[CostEstimate] edge fn error for", svc, ":", fnErr.message ?? fnErr);
            continue;
          }
          const estimate = fnData?.data ?? (fnData?.shop_low != null ? fnData : null);
          if (estimate) {
            results[svc] = estimate;
          } else {
            console.warn("[CostEstimate] no estimate in response for", svc, ":", JSON.stringify(fnData)?.slice(0, 200));
          }
        } catch (err: any) {
          console.warn("[CostEstimate] exception for", svc, ":", err?.message ?? err);
        }
      }

      return results;
    },
    enabled: !!vehicle?.make && !!scheduleTasks?.length,
    staleTime: 1000 * 60 * 60, // 1 hour
  });

  useFocusEffect(
    useCallback(() => {
      if (vehicle?.make && scheduleTasks?.length) {
        // Small delay to not block screen render
        const timer = setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["repair_costs", id] });
        }, 1000);
        return () => clearTimeout(timer);
      }
    }, [vehicle?.make, scheduleTasks?.length, id, queryClient]),
  );

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
          fuel_type: vehicle.fuel_type ?? "gas",
          is_awd: vehicle.is_awd ?? false,
          vehicle_category: vehicle.vehicle_type ?? "car",
        },
      });
      if (error) {
        const httpStatus = ((error as unknown as Record<string, unknown>)?.context as Record<string, unknown>)?.status as number | undefined;
        if (httpStatus !== 409) {
          showToast("Failed to generate schedule. Please try again.", true);
          return;
        }
      }
      await refetchSchedule();
      showToast("Schedule generated!");
    } catch {
      showToast("Failed to generate schedule. Please try again.", true);
    } finally {
      setGeneratingSchedule(false);
    }
  }

  function showToast(msg: string, isError = false) {
    setScheduleToast(msg);
    setScheduleToastIsError(isError);
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
    const tracksHoursOpen = HOURS_TRACKED_TYPES.has(vehicle?.vehicle_type ?? "");
    setCompleteMileage(
      tracksHoursOpen
        ? vehicle?.hours != null
          ? String(vehicle.hours)
          : ""
        : vehicle?.mileage != null
          ? String(vehicle.mileage)
          : "",
    );
    setCompleteDate(format(new Date(), "yyyy-MM-dd"));
    setCompleteNotes("");
    setCompleteCost("");
    setCompleteProvider("");
    setCompleteDiy(false);
    setCompleteDuration("");
    setIsSavingComplete(false);
  }

  function handleCloseMarkComplete() {
    setMarkCompleteTask(null);
    setCompleteMileage("");
    setCompleteNotes("");
    setCompleteCost("");
    setCompleteProvider("");
    setCompleteDiy(false);
    setCompleteDuration("");
    setIsSavingComplete(false);
  }

  async function handleSaveMarkComplete() {
    if (!markCompleteTask) return;
    const tracksMileage = MILEAGE_TRACKED_TYPES.has(vehicle?.vehicle_type ?? "");
    const tracksHours = HOURS_TRACKED_TYPES.has(vehicle?.vehicle_type ?? "");
    let mileageNum: number | null = null;
    if (tracksMileage || tracksHours) {
      const parsed = parseInt(completeMileage, 10);
      if (!completeMileage.trim() || isNaN(parsed) || parsed < 0) {
        showToast(tracksHours ? "Please enter a valid hours value." : "Please enter a valid mileage.", true);
        return;
      }
      mileageNum = parsed;
    }
    const costTrim = completeCost.trim();
    if (costTrim) {
      const costNum = parseFloat(costTrim.replace(/[^0-9.]/g, ""));
      if (isNaN(costNum) || costNum < 0) {
        showToast("Enter a valid cost or leave it blank.", true);
        return;
      }
    }
    const durTrim = completeDuration.trim();
    if (durTrim) {
      const dm = parseInt(durTrim, 10);
      if (isNaN(dm) || dm < 0) {
        showToast("Enter a valid time in minutes or leave it blank.", true);
        return;
      }
    }
    const notesForLog = (() => {
      const parts: string[] = [];
      if (completeNotes.trim()) parts.push(completeNotes.trim());
      if (durTrim) {
        const dm = parseInt(durTrim, 10);
        if (!isNaN(dm) && dm > 0) parts.push(`Time spent: ${dm} min`);
      }
      return parts.length ? parts.join("\n\n") : null;
    })();
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
          ? tracksHours
            ? supabase.from("vehicles").update({ hours: mileageNum }).eq("id", id!)
            : supabase.from("vehicles").update({ mileage: mileageNum }).eq("id", id!)
          : Promise.resolve({ error: null }),
        supabase.from("maintenance_logs").insert({
          user_id: user!.id,
          vehicle_id: id,
          property_id: null,
          service_name: task.name,
          service_date: completeDate,
          cost: completeCost.trim() ? parseFloat(completeCost) : null,
          mileage: mileageNum,
          provider_name: completeProvider.trim() || null,
          provider_contact: null,
          receipt_url: null,
          notes: notesForLog,
          did_it_myself: completeDiy,
        }),
      ]);

      if (taskRes.error || vehicleRes.error) throw taskRes.error ?? vehicleRes.error;

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
      showToast("Failed to save. Please try again.", true);
    }
  }

  async function handleRefreshAll() {
    setScheduleRefreshing(true);
    await Promise.all([refetchSchedule(), refetchLogs()]);
    setScheduleRefreshing(false);
  }

  async function handleVehiclePhoto() {
    if (!vehicle || !user) return;
    const hasPhoto = !!vehicle.photo_url;
    const options = hasPhoto
      ? [
          { text: "Take New Photo", onPress: () => pickVehiclePhoto("camera") },
          { text: "Choose from Library", onPress: () => pickVehiclePhoto("library") },
          { text: "Remove Photo", style: "destructive" as const, onPress: removeVehiclePhoto },
          { text: "Cancel", style: "cancel" as const },
        ]
      : [
          { text: "Take Photo", onPress: () => pickVehiclePhoto("camera") },
          { text: "Choose from Library", onPress: () => pickVehiclePhoto("library") },
          { text: "Cancel", style: "cancel" as const },
        ];
    Alert.alert("Vehicle Photo", "Choose a photo source", options);
  }

  async function pickVehiclePhoto(source: "camera" | "library") {
    setUploadingPhoto(true);
    try {
      let result;
      if (source === "camera") {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Camera access needed", "Turn on camera access in your Settings to take photos.");
          return;
        }
        result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: true, aspect: [16, 9] });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: true, aspect: [16, 9] });
      }
      if (result.canceled || !result.assets?.[0]) return;

      const uri = result.assets[0].uri;
      const storagePath = `${user!.id}/${id}/vehicle-photo.jpg`;
      const response = await fetch(uri);
      const blob = await response.blob();
      const arrayBuffer = await new Response(blob).arrayBuffer();

      const { error: uploadError } = await supabase.storage
        .from("wallet-documents")
        .upload(storagePath, arrayBuffer, { contentType: "image/jpeg", upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("wallet-documents").getPublicUrl(storagePath);
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

      await supabase.from("vehicles").update({ photo_url: publicUrl }).eq("id", id!);
      queryClient.invalidateQueries({ queryKey: ["vehicle", id] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      Alert.alert("Photo didn't save", "Something went wrong on our end. Give it another shot.");
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function removeVehiclePhoto() {
    try {
      const storagePath = `${user!.id}/${id}/vehicle-photo.jpg`;
      await supabase.storage.from("wallet-documents").remove([storagePath]);
      await supabase.from("vehicles").update({ photo_url: null }).eq("id", id!);
      queryClient.invalidateQueries({ queryKey: ["vehicle", id] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert("Photo didn't remove", "Give it another shot.");
    }
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
    return [header, ...rows, "", "Mileage data is self-reported by the vehicle owner and has not been independently verified."].join("\n");
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
    <div class="footer">Generated by LifeMaintained · lifemaintained.app<br/>Mileage data is self-reported by the vehicle owner and has not been independently verified.</div>
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
      Alert.alert("Export didn't work", e.message ?? "Try again in a moment.");
    } finally {
      setIsExporting(false);
    }
  }

  function handleDeleteVehicle() {
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
            if (isDeletingVehicle) return;
            setIsDeletingVehicle(true);
            try {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              router.back();
              setTimeout(async () => {
                try {
                  const userId = user!.id;
                  const vehicleId = id!;
                  await supabase.from("user_vehicle_maintenance_tasks").delete().eq("vehicle_id", vehicleId);
                  await supabase.from("maintenance_logs").delete().eq("vehicle_id", vehicleId);
                  await supabase.from("vehicle_mileage_history").delete().eq("vehicle_id", vehicleId);
                  const { data: walletFiles } = await supabase.storage.from("wallet-documents").list(`${userId}/${vehicleId}`);
                  if (walletFiles?.length) {
                    await supabase.storage.from("wallet-documents").remove(walletFiles.map(f => `${userId}/${vehicleId}/${f.name}`));
                  }
                  await supabase.from("vehicle_wallet_documents").delete().eq("vehicle_id", vehicleId);
                  await supabase.from("vehicles").delete().eq("id", vehicleId);
                  queryClient.invalidateQueries({ queryKey: ["vehicles"] });
                  queryClient.invalidateQueries({ queryKey: ["dashboard"] });
                } catch {}
              }, 200);
            } catch (err: any) {
              setIsDeletingVehicle(false);
              Alert.alert("Couldn't delete", err?.message ?? "Try again in a moment.");
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
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={6} accessibilityLabel="Go back" accessibilityRole="button">
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{vehicleName}</Text>
          {vehicle?.nickname && (
            <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: "#8B93A8" }} numberOfLines={1}>
              {`${vehicle.year ?? ""} ${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim()}
            </Text>
          )}
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable
            style={({ pressed }) => [{ width: 34, height: 34, borderRadius: 10, backgroundColor: Colors.surface, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 }]}
            onPress={() => router.push(`/edit-vehicle?vehicleId=${id}` as any)}
            hitSlop={4}
          >
            <Ionicons name="pencil-outline" size={16} color={Colors.text} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.deleteVehicleBtn, { opacity: pressed ? 0.7 : 1 }]}
            onPress={handleDeleteVehicle}
            hitSlop={4}
          >
            <Ionicons name="trash-outline" size={16} color={Colors.overdue} />
          </Pressable>
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator color={Colors.accent} style={{ marginTop: 60 }} />
      ) : vehicle ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          stickyHeaderIndices={[1]}
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
            {vehicle.photo_url ? (
              <Pressable onPress={handleVehiclePhoto} style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1 }]}>
                <Image
                  source={{ uri: vehicle.photo_url }}
                  style={{ width: "100%", height: 180, borderRadius: 14 }}
                  resizeMode="cover"
                />
              </Pressable>
            ) : (
              <Pressable
                onPress={handleVehiclePhoto}
                style={({ pressed }) => [{
                  height: 100, borderRadius: 14, borderWidth: 1.5, borderColor: "#2A3550", borderStyle: "dashed",
                  alignItems: "center", justifyContent: "center", gap: 6, opacity: pressed ? 0.7 : 1,
                }]}
              >
                {uploadingPhoto ? (
                  <ActivityIndicator color="#E8943A" />
                ) : (
                  <>
                    <Ionicons name="camera-outline" size={24} color="#5A6480" />
                    <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: "#5A6480" }}>Add vehicle photo</Text>
                  </>
                )}
              </Pressable>
            )}
            {(() => {
              const tracksMileage = MILEAGE_TRACKED_TYPES.has(vehicle.vehicle_type ?? "");
              const tracksHours = HOURS_TRACKED_TYPES.has(vehicle.vehicle_type ?? "");
              let metaLine = "No mileage tracked";
              if (tracksMileage && vehicle.mileage != null) {
                const mileStr = vehicle.mileage.toLocaleString() + " mi";
                if (vehicle.updated_at) {
                  metaLine = mileStr + " · Updated " + formatDistanceToNowStrict(parseISO(vehicle.updated_at), { addSuffix: true });
                } else {
                  metaLine = mileStr;
                }
              } else if (tracksHours && vehicle.hours != null) {
                const hourStr = vehicle.hours.toLocaleString() + " hrs";
                if (vehicle.updated_at) {
                  metaLine = hourStr + " · Updated " + formatDistanceToNowStrict(parseISO(vehicle.updated_at), { addSuffix: true });
                } else {
                  metaLine = hourStr;
                }
              } else if (tracksHours) {
                metaLine = "No hours entered yet";
              } else if (tracksMileage) {
                metaLine = "No mileage entered yet";
              }
              return (
                <>
                  <View style={{ gap: 4 }}>
                    <Text style={styles.vehicleFullName}>{vehicleName}</Text>
                    <Text style={styles.vehicleMeta}>{metaLine}</Text>
                  </View>
                  <Pressable
                    style={({ pressed }) => [styles.logServiceBtn, { opacity: pressed ? 0.85 : 1 }]}
                    onPress={() => router.push(`/log-service/${id}` as any)}
                  >
                    <Text style={styles.logServiceBtnText}>Log Service</Text>
                  </Pressable>
                  {(tracksMileage || tracksHours) && (
                    <Pressable
                      style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1, alignSelf: "center" }]}
                      onPress={() => router.push(`/update-mileage/${id}` as any)}
                    >
                      <Text style={styles.updateMileageLink}>{tracksHours ? "Update hours →" : "Update mileage →"}</Text>
                    </Pressable>
                  )}
                </>
              );
            })()}
          </View>

          <View style={{ backgroundColor: Colors.background }}>
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
                      : tab === "wallet" ? "Glovebox"
                      : "History"}
                  </Text>
                  {activeTab === tab && <View style={styles.tabUnderline} />}
                </Pressable>
              ))}
            </View>
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
                  <Text style={styles.scheduleEmptyTitle}>No maintenance schedule yet</Text>
                  <Text style={styles.scheduleEmptySubtitle}>Tap Log Service to record maintenance</Text>
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
                      costEstimates={costEstimates}
                      onShowDifficultyInfo={() => setShowDifficultyInfo(true)}
                    />
                  )}
                  <ScheduleSection
                    title={`Upcoming (${upcomingTasks.length})`}
                    expanded={upcomingExpanded}
                    onToggle={() => { Haptics.selectionAsync(); setUpcomingExpanded(v => !v); }}
                    tasks={upcomingTasks}
                    vehicle={vehicle}
                    emptyMessage="No upcoming tasks"
                    onMarkComplete={handleOpenMarkComplete}
                    costEstimates={costEstimates}
                    onShowDifficultyInfo={() => setShowDifficultyInfo(true)}
                  />
                  {completedTasks.length > 0 && (
                    <ScheduleSection
                      title={`Completed (${completedTasks.length})`}
                      titleColor={Colors.good}
                      expanded={completedExpanded}
                      onToggle={() => { Haptics.selectionAsync(); setCompletedExpanded(v => !v); }}
                      tasks={completedTasks}
                      vehicle={vehicle}
                      onMarkComplete={handleOpenMarkComplete}
                      costEstimates={costEstimates}
                      onShowDifficultyInfo={() => setShowDifficultyInfo(true)}
                    />
                  )}
                  {Object.keys(costEstimates ?? {}).length > 0 && (
                    <Text style={{ fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.textTertiary, textAlign: "center", marginTop: 12, paddingHorizontal: 16 }}>
                      Cost estimates are approximate and vary by location and shop. Not a guarantee of pricing.
                    </Text>
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

      <SaveToast visible={showScheduleToast} message={scheduleToast} isError={scheduleToastIsError} />

      <MarkCompleteSheet
        visible={markCompleteTask != null}
        task={markCompleteTask}
        mileage={completeMileage}
        onMileageChange={setCompleteMileage}
        showMileage={MILEAGE_TRACKED_TYPES.has(vehicle?.vehicle_type ?? "")}
        tracksHours={HOURS_TRACKED_TYPES.has(vehicle?.vehicle_type ?? "")}
        date={completeDate}
        onDateChange={setCompleteDate}
        notes={completeNotes}
        onNotesChange={setCompleteNotes}
        cost={completeCost}
        onCostChange={setCompleteCost}
        provider={completeProvider}
        onProviderChange={setCompleteProvider}
        diy={completeDiy}
        onDiyChange={setCompleteDiy}
        durationMinutes={completeDuration}
        onDurationChange={setCompleteDuration}
        onSave={handleSaveMarkComplete}
        onClose={handleCloseMarkComplete}
        isSaving={isSavingComplete}
        formatDateLabel={formatDateLabel}
        insets={insets}
      />

      <Modal
        visible={showDifficultyInfo}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDifficultyInfo(false)}
      >
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          <Pressable
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)" }}
            onPress={() => setShowDifficultyInfo(false)}
          />
          <View
            style={{
              backgroundColor: "#FFFFFF",
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              paddingHorizontal: 20,
              paddingTop: 16,
              paddingBottom: insets.bottom + 40,
            }}
          >
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.borderSubtle, alignSelf: "center", marginBottom: 16 }} />
            <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.text, marginBottom: 16 }}>
              DIY Difficulty Levels
            </Text>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
              <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium", color: Colors.good, backgroundColor: Colors.goodMuted, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: "hidden" }}>
                Easy DIY
              </Text>
              <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, flex: 1 }}>
                No special tools or experience needed. Most people can do this with basic supplies and a YouTube video. Examples: air filter, wiper blades, cabin filter.
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
              <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium", color: Colors.dueSoon, backgroundColor: Colors.dueSoonMuted, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: "hidden" }}>
                Moderate
              </Text>
              <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, flex: 1 }}>
                Requires some tools and comfort working on your vehicle. May take 1-2 hours. Examples: brake pads, spark plugs, battery replacement.
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
              <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium", color: Colors.overdue, backgroundColor: Colors.overdueMuted, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: "hidden" }}>
                Pro Recommended
              </Text>
              <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, flex: 1 }}>
                Complex job requiring professional tools, expertise, or safety equipment. Best left to a certified mechanic. Examples: timing belt, transmission service, suspension work.
              </Text>
            </View>
            <Pressable
              onPress={() => setShowDifficultyInfo(false)}
              style={{ width: "100%", backgroundColor: Colors.vehicle, borderRadius: 10, paddingVertical: 13, marginTop: 8 }}
            >
              <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#FFFFFF", textAlign: "center" }}>
                Got it
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

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

function ScheduleSection({
  title,
  titleColor,
  expanded,
  onToggle,
  tasks,
  vehicle,
  emptyMessage,
  onMarkComplete,
  costEstimates,
  onShowDifficultyInfo,
}: {
  title: string;
  titleColor?: string;
  expanded: boolean;
  onToggle: () => void;
  tasks: any[];
  vehicle: any;
  emptyMessage?: string;
  onMarkComplete: (task: any) => void;
  costEstimates?: Record<string, any>;
  onShowDifficultyInfo?: () => void;
}) {
  return (
    <View style={styles.scheduleSection}>
      <Pressable style={styles.scheduleSectionHeader} onPress={onToggle} hitSlop={6}>
        <Text style={styles.scheduleSectionTitle}>
          {title.toUpperCase()}
        </Text>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={14}
          color={Colors.textTertiary}
        />
      </Pressable>
      {expanded && (
        <View style={styles.scheduleSectionContent}>
          {tasks.length === 0 && emptyMessage ? (
            <Text style={styles.scheduleSectionEmpty}>{emptyMessage}</Text>
          ) : (
            tasks.map((task, idx) => (
              <ScheduleTaskCard
                key={task.id}
                task={task}
                vehicle={vehicle}
                onMarkComplete={onMarkComplete}
                isLast={idx === tasks.length - 1}
                costEstimate={costEstimates?.[task.name.toLowerCase().trim()]}
                onShowDifficultyInfo={onShowDifficultyInfo}
              />
            ))
          )}
        </View>
      )}
    </View>
  );
}

function ScheduleTaskCard({ task, vehicle, onMarkComplete, isLast, costEstimate, onShowDifficultyInfo }: {
  task: any;
  vehicle: any;
  onMarkComplete: (task: any) => void;
  isLast?: boolean;
  costEstimate?: any;
  onShowDifficultyInfo?: () => void;
}) {
  const isCompleted = task.status === "completed";
  const [showCompletedInfo, setShowCompletedInfo] = useState(false);

  function handlePress() {
    if (isCompleted) {
      setShowCompletedInfo(true);
      setTimeout(() => setShowCompletedInfo(false), 2500);
    } else {
      onMarkComplete(task);
    }
  }

  const barColor = task.status === "overdue"
    ? Colors.overdue
    : task.status === "due_soon"
      ? Colors.dueSoon
      : task.status === "completed"
        ? Colors.good
        : Colors.borderSubtle;

  const dueParts: string[] = [];
  if (!isCompleted) {
    if (task.next_due_miles != null) dueParts.push(`Due at ${task.next_due_miles.toLocaleString()} mi`);
    if (task.next_due_date != null) dueParts.push(format(parseISO(task.next_due_date), "MMM d, yyyy"));
    if (dueParts.length === 0) dueParts.push("No schedule set");
  } else if (task.last_completed_date) {
    dueParts.push(`Completed ${format(parseISO(task.last_completed_date), "MMM d, yyyy")}`);
  }
  const dueText = dueParts.join(" · ");
  let lastServicedText: string | null = null;
  if (!isCompleted && task.last_completed_date) {
    const lastDate = format(parseISO(task.last_completed_date), "MMM d, yyyy");
    const lastMiles = task.last_completed_miles != null ? ` at ${task.last_completed_miles.toLocaleString()} mi` : "";
    lastServicedText = `Last serviced ${lastDate}${lastMiles}`;
  }

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.scheduleCard,
        !isLast && styles.scheduleCardBorder,
        !isCompleted && pressed && { opacity: 0.7 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={isCompleted ? `${task.name} — completed` : `${task.name} — tap to mark complete`}
    >
      <View style={[styles.scheduleCardBar, { backgroundColor: barColor, opacity: isCompleted ? 0.5 : 1 }]} />
      <View style={styles.scheduleCardBody}>
        <Text
          style={[styles.scheduleCardName, isCompleted && styles.scheduleCardNameDone]}
          numberOfLines={1}
        >
          {task.name}
        </Text>
        {!!dueText && (
          <Text style={[styles.scheduleCardDue, isCompleted && styles.scheduleCardDueDone]}>
            {dueText}
          </Text>
        )}
        {!!lastServicedText && (
          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.vehicle, marginTop: 4 }}>
            {lastServicedText}
          </Text>
        )}
        {costEstimate && !isCompleted && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 }}>
            <Ionicons name="cash-outline" size={12} color={Colors.good} />
            <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.good }}>
              {Number(costEstimate.shop_low) === 0 && Number(costEstimate.shop_high) === 0 ? "Free shop" : Number(costEstimate.shop_low) === Number(costEstimate.shop_high) ? `$${Number(costEstimate.shop_low)} shop` : `$${Number(costEstimate.shop_low)}-$${Number(costEstimate.shop_high)} shop`}
              {costEstimate.diy_low == null ? "" : Number(costEstimate.diy_low) === 0 && Number(costEstimate.diy_high) === 0 ? " · Free DIY" : Number(costEstimate.diy_low) === Number(costEstimate.diy_high) ? ` · $${Number(costEstimate.diy_low)} DIY` : ` · $${Number(costEstimate.diy_low)}-$${Number(costEstimate.diy_high)} DIY`}
            </Text>
            {costEstimate.difficulty && (
              <>
                <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium", color: costEstimate.difficulty === 1 ? Colors.good : costEstimate.difficulty === 2 ? Colors.dueSoon : Colors.overdue, backgroundColor: costEstimate.difficulty === 1 ? Colors.goodMuted : costEstimate.difficulty === 2 ? Colors.dueSoonMuted : Colors.overdueMuted, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: "hidden" }}>
                  {costEstimate.difficulty === 1 ? "Easy DIY" : costEstimate.difficulty === 2 ? "Moderate" : "Pro"}
                </Text>
                <Pressable onPress={() => onShowDifficultyInfo?.()} hitSlop={8}>
                  <Ionicons name="information-circle-outline" size={14} color={Colors.textTertiary} />
                </Pressable>
              </>
            )}
          </View>
        )}
        {showCompletedInfo && (
          <Text style={styles.scheduleCardCompletedInfo}>
            Already completed. To undo, delete the entry from the History tab.
          </Text>
        )}
      </View>
    </Pressable>
  );
}

function MarkCompleteSheet({
  visible,
  task,
  mileage,
  onMileageChange,
  showMileage = true,
  tracksHours,
  date,
  onDateChange,
  notes,
  onNotesChange,
  cost,
  onCostChange,
  provider,
  onProviderChange,
  diy,
  onDiyChange,
  durationMinutes,
  onDurationChange,
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
  tracksHours?: boolean;
  date: string;
  onDateChange: (v: string) => void;
  notes: string;
  onNotesChange: (v: string) => void;
  cost: string;
  onCostChange: (v: string) => void;
  provider: string;
  onProviderChange: (v: string) => void;
  diy: boolean;
  onDiyChange: (v: boolean) => void;
  durationMinutes: string;
  onDurationChange: (v: string) => void;
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

          <ScrollView
            style={styles.sheetScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
          <View style={styles.sheetFields}>
            {(showMileage || tracksHours) && (
              <View style={styles.sheetField}>
                <Text style={styles.sheetFieldLabel}>{tracksHours ? "Current Hours" : "Current Mileage"}</Text>
                <TextInput
                  style={styles.sheetInput}
                  value={mileage}
                  onChangeText={onMileageChange}
                  keyboardType="number-pad"
                  placeholder={tracksHours ? "e.g. 1,250" : "e.g. 52,000"}
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
              <Text style={styles.sheetFieldLabel}>
                Time spent (minutes) <Text style={styles.sheetFieldOptional}>(optional)</Text>
              </Text>
              <TextInput
                style={styles.sheetInput}
                value={durationMinutes}
                onChangeText={onDurationChange}
                keyboardType="number-pad"
                placeholder="e.g. 45"
                placeholderTextColor={Colors.textTertiary}
                returnKeyType="done"
              />
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

            <View style={styles.sheetField}>
              <Text style={styles.sheetFieldLabel}>Cost  <Text style={styles.sheetFieldOptional}>(optional)</Text></Text>
              <TextInput
                style={styles.sheetInput}
                value={cost}
                onChangeText={onCostChange}
                keyboardType="decimal-pad"
                placeholder="e.g. 89.99"
                placeholderTextColor={Colors.textTertiary}
              />
            </View>

            <View style={styles.sheetField}>
              <Text style={styles.sheetFieldLabel}>Provider  <Text style={styles.sheetFieldOptional}>(optional)</Text></Text>
              <TextInput
                style={styles.sheetInput}
                value={provider}
                onChangeText={onProviderChange}
                placeholder="e.g. Jiffy Lube"
                placeholderTextColor={Colors.textTertiary}
              />
            </View>

            <Pressable
              onPress={() => onDiyChange(!diy)}
              style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 }}
            >
              <View style={{
                width: 24, height: 24, borderRadius: 6, borderWidth: 2,
                borderColor: diy ? "#E8943A" : Colors.border,
                backgroundColor: diy ? "#E8943A" : "transparent",
                alignItems: "center", justifyContent: "center",
              }}>
                {diy && <Ionicons name="checkmark" size={16} color="#0C111B" />}
              </View>
              <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.text }}>I did this myself</Text>
            </Pressable>
          </View>
          </ScrollView>

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

type WalletDoc = { id: string; document_type: string; data: Record<string, any> };
type WalletDocWithVehicle = WalletDoc & {
  vehicle_id: string;
  vehicles: { make: string | null; model: string | null; year: number | null; nickname: string | null } | null;
};
type DocType = "registration" | "insurance" | "id_card";

const DOC_LABELS: Record<DocType, string> = {
  registration: "Registration",
  insurance: "Insurance",
  id_card: "Driver's License",
};

function walletVehicleLabel(row: WalletDocWithVehicle): string {
  const v = row.vehicles;
  if (!v) return "Vehicle";
  const title = [v.year, v.make, v.model].filter(x => x != null && String(x).trim() !== "").join(" ").trim();
  const nick = v.nickname?.trim();
  return nick || title || "Vehicle";
}

function WalletTab({ vehicleId, userId }: { vehicleId: string; userId: string }) {
  const [uploading, setUploading] = useState<DocType | null>(null);
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);

  const { data: allWalletDocs } = useQuery<(WalletDoc & { vehicle_id: string })[]>({
    queryKey: ["all_wallet_docs", userId, vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicle_wallet_documents")
        .select("*, vehicles!inner(make, model, year, nickname)")
        .eq("user_id", userId)
        .neq("vehicle_id", vehicleId);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!userId,
  });

  const { data: docs, isLoading, refetch } = useQuery<WalletDoc[]>({
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

  function getPhotoUrl(docType: DocType): string | null {
    const found = docs?.find(d => d.document_type === docType);
    const url = found?.data?.photo_url ?? null;
    return url;
  }

  function getDoc(docType: DocType): WalletDoc | null {
    return docs?.find(d => d.document_type === docType) ?? null;
  }

  const copyOptionsByDocType = useMemo(() => {
    const empty: Record<DocType, { photoUrl: string; label: string }[]> = {
      registration: [],
      insurance: [],
      id_card: [],
    };
    if (!allWalletDocs?.length) return empty;
    const buildFor = (docType: "insurance" | "id_card") => {
      const seenUrls = new Set<string>();
      const out: { photoUrl: string; label: string }[] = [];
      for (const row of allWalletDocs as WalletDocWithVehicle[]) {
        if (row.document_type !== docType) continue;
        const url = row.data?.photo_url;
        if (!url || typeof url !== "string") continue;
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);
        out.push({ photoUrl: url, label: walletVehicleLabel(row) });
      }
      return out;
    };
    return {
      registration: [],
      insurance: buildFor("insurance"),
      id_card: buildFor("id_card"),
    };
  }, [allWalletDocs]);

  async function copyDocFromVehicle(docType: DocType, sourcePhotoUrl: string) {
    try {
      const existingDoc = getDoc(docType);
      if (existingDoc) {
        await supabase
          .from("vehicle_wallet_documents")
          .update({ data: { photo_url: sourcePhotoUrl }, updated_at: new Date().toISOString() })
          .eq("id", existingDoc.id);
      } else {
        await supabase.from("vehicle_wallet_documents").insert({
          user_id: userId,
          vehicle_id: vehicleId,
          document_type: docType,
          data: { photo_url: sourcePhotoUrl },
        });
      }
      await refetch();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error("[WalletTab] Copy error:", err);
      Alert.alert("Copy didn't work", "Give it another shot.");
    }
  }

  async function handlePick(docType: DocType, source: "camera" | "library") {
    setUploading(docType);
    try {
      let result: ImagePicker.ImagePickerResult;
      if (source === "camera") {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Camera access needed", "Turn on camera access in your Settings to take photos.");
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          quality: 0.85,
          allowsEditing: false,
        });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          quality: 0.85,
          allowsEditing: false,
        });
      }

      if (result.canceled || !result.assets?.[0]) return;

      const uri = result.assets[0].uri;
      const storagePath = `${userId}/${vehicleId}/${docType}.jpg`;

      const response = await fetch(uri);
      const blob = await response.blob();
      const arrayBuffer = await new Response(blob).arrayBuffer();

      const { error: uploadError } = await supabase.storage
        .from("wallet-documents")
        .upload(storagePath, arrayBuffer, { contentType: "image/jpeg", upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("wallet-documents").getPublicUrl(storagePath);
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      if (!publicUrl.startsWith("http")) {
        console.error("[WalletTab] Malformed public URL:", publicUrl);
        throw new Error("Malformed wallet document URL");
      }

      const existingDoc = getDoc(docType);
      if (existingDoc) {
        await supabase
          .from("vehicle_wallet_documents")
          .update({ data: { photo_url: publicUrl }, updated_at: new Date().toISOString() })
          .eq("id", existingDoc.id);
      } else {
        await supabase.from("vehicle_wallet_documents").insert({
          user_id: userId,
          vehicle_id: vehicleId,
          document_type: docType,
          data: { photo_url: publicUrl },
        });
      }

      await refetch();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error("[WalletTab] Upload error:", err);
      Alert.alert(
        "Couldn't save document",
        "Check your connection and try again. You can also pick a smaller photo.",
      );
    } finally {
      setUploading(null);
    }
  }

  function showPickerOptions(docType: DocType) {
    Alert.alert(
      DOC_LABELS[docType],
      "Choose a photo source",
      [
        { text: "Take Photo", onPress: () => handlePick(docType, "camera") },
        { text: "Choose from Library", onPress: () => handlePick(docType, "library") },
        { text: "Cancel", style: "cancel" },
      ],
    );
  }

  async function handleDelete(docType: DocType) {
    const doc = getDoc(docType);
    if (!doc) return;
    Alert.alert(
      "Delete Photo",
      `Remove the ${DOC_LABELS[docType]} photo from your wallet?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const storagePath = `${userId}/${vehicleId}/${docType}.jpg`;
              await supabase.storage.from("wallet-documents").remove([storagePath]);
              await supabase.from("vehicle_wallet_documents").delete().eq("id", doc.id);
              await refetch();
            } catch {
              Alert.alert("Photo didn't delete", "Try again in a moment.");
            }
          },
        },
      ],
    );
  }

  function handleLongPress(docType: DocType) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      DOC_LABELS[docType],
      "",
      [
        { text: "Replace Photo", onPress: () => showPickerOptions(docType) },
        { text: "Delete", style: "destructive", onPress: () => handleDelete(docType) },
        { text: "Cancel", style: "cancel" },
      ],
    );
  }

  if (isLoading) {
    return (
      <View style={walletStyles.loading}>
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }

  const DOC_TYPES: DocType[] = ["registration", "insurance", "id_card"];

  return (
    <View style={walletStyles.container}>
      {DOC_TYPES.map(docType => {
        const photoUrl = getPhotoUrl(docType);
        const isUploading = uploading === docType;
        const copyOpts =
          docType === "registration" ? [] : copyOptionsByDocType[docType];
        return (
          <DocPhotoSlot
            key={docType}
            label={DOC_LABELS[docType]}
            photoUrl={photoUrl}
            isUploading={isUploading}
            copyFromOptions={!photoUrl ? copyOpts : undefined}
            onCopyFrom={
              !photoUrl && copyOpts.length
                ? (url: string) => copyDocFromVehicle(docType, url)
                : undefined
            }
            onTap={() => {
              if (photoUrl) {
                setViewingPhoto(photoUrl);
              } else {
                showPickerOptions(docType);
              }
            }}
            onLongPress={() => handleLongPress(docType)}
          />
        );
      })}

      <Modal
        visible={!!viewingPhoto}
        transparent
        animationType="fade"
        presentationStyle={Platform.OS === "ios" ? "overFullScreen" : "fullScreen"}
        statusBarTranslucent={Platform.OS === "android"}
        onRequestClose={() => setViewingPhoto(null)}
      >
        <Pressable style={walletStyles.photoViewer} onPress={() => setViewingPhoto(null)}>
          {viewingPhoto ? (
            <View style={walletStyles.photoViewerInner} pointerEvents="box-none">
              <Image
                source={{ uri: viewingPhoto }}
                style={walletStyles.photoViewerImage}
                resizeMode="contain"
                pointerEvents="none"
                onError={() => {
                  setViewingPhoto(null);
                  Alert.alert("Can't load photo", "The image couldn't be loaded. Try re-uploading it.");
                }}
              />
              <Text style={walletStyles.photoViewerHint}>Tap anywhere to close</Text>
            </View>
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}

function DocPhotoSlot({
  label,
  photoUrl,
  isUploading,
  onTap,
  onLongPress,
  copyFromOptions,
  onCopyFrom,
}: {
  label: string;
  photoUrl: string | null;
  isUploading: boolean;
  onTap: () => void;
  onLongPress: () => void;
  copyFromOptions?: { photoUrl: string; label: string }[];
  onCopyFrom?: (photoUrl: string) => void;
}) {
  if (isUploading) {
    return (
      <View style={walletStyles.slotLoading}>
        <ActivityIndicator color={Colors.accent} />
        <Text style={walletStyles.slotLoadingText}>Uploading…</Text>
      </View>
    );
  }

  if (photoUrl) {
    return (
      <Pressable
        style={({ pressed }) => [walletStyles.slotFilled, { opacity: pressed ? 0.9 : 1 }]}
        onPress={onTap}
        onLongPress={onLongPress}
        delayLongPress={400}
      >
        <Image source={{ uri: photoUrl }} style={walletStyles.slotImage} resizeMode="cover" onError={(e) => console.error("[Wallet] Image load error:", e.nativeEvent.error, "URL:", photoUrl)} />
        <View style={walletStyles.slotLabelRow}>
          <Text style={walletStyles.slotLabelText}>{label}</Text>
          <Pressable onPress={onLongPress} hitSlop={8} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
            <Ionicons name="trash-outline" size={16} color={Colors.overdue} />
          </Pressable>
        </View>
      </Pressable>
    );
  }

  const hasCopy = !!(copyFromOptions?.length && onCopyFrom);

  return (
    <View style={walletStyles.slotEmpty}>
      {hasCopy ? (
        <View style={walletStyles.slotCopyBlock}>
          {copyFromOptions!.map((opt, idx) => (
            <Pressable
              key={`${opt.photoUrl}-${idx}`}
              onPress={() => onCopyFrom!(opt.photoUrl)}
              style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={walletStyles.slotCopyLink}>
                {copyFromOptions!.length === 1
                  ? `Same as ${opt.label}?`
                  : `Copy from ${opt.label}`}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Pressable
        style={({ pressed }) => [
          walletStyles.slotEmptyMain,
          { opacity: pressed ? 0.75 : 1 },
        ]}
        onPress={onTap}
      >
        <Ionicons name="camera-outline" size={28} color={Colors.textTertiary} />
        <Text style={walletStyles.slotName}>{label}</Text>
        <Text style={walletStyles.slotHint}>Tap to add photo</Text>
      </Pressable>
    </View>
  );
}

const walletStyles = StyleSheet.create({
  container: { gap: 14 },
  loading: { paddingVertical: 40, alignItems: "center" },
  slotEmpty: {
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    minHeight: 160,
    backgroundColor: Colors.surface,
    overflow: "hidden",
  },
  slotCopyBlock: {
    alignSelf: "stretch",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
    gap: 8,
    alignItems: "center",
  },
  slotCopyLink: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#0C111B",
    backgroundColor: "#E8943A",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    overflow: "hidden",
    textAlign: "center",
  },
  slotEmptyMain: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingBottom: 12,
    minHeight: 120,
  },
  slotName: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.text },
  slotHint: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  slotFilled: {
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  slotImage: { width: "100%", height: 180 },
  slotLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  slotLabelText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.text },
  slotLoading: {
    borderRadius: 14,
    height: 160,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: Colors.surface,
  },
  slotLoadingText: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  photoViewer: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    alignItems: "center",
    justifyContent: "center",
  },
  photoViewerInner: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
  },
  photoViewerImage: { width: "100%", flex: 1 },
  photoViewerHint: {
    position: "absolute",
    bottom: 48,
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.7)",
  },
});
const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 8,
  },
  backBtn: { width: 40, height: 44, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  headerCenter: { flex: 1, alignItems: "center", gap: 1 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_600SemiBold", color: Colors.text, textAlign: "center" },
  headerTrim: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center" },
  headerMileageRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 1 },
  headerMileage: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  deleteVehicleBtn: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: Colors.overdueMuted, alignItems: "center", justifyContent: "center",
  },
  scroll: { paddingHorizontal: 20, paddingTop: 16, gap: 12 },
  vehicleCard: {
    gap: 12,
  },
  vehicleFullName: { fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.text },
  vehicleMeta: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  logServiceBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  logServiceBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  updateMileageLink: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.accent },
  tabs: {
    flexDirection: "row",
    backgroundColor: Colors.background,
    paddingTop: 4,
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center", position: "relative" },
  tabActive: {},
  tabUnderline: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    height: 2, backgroundColor: Colors.accent, borderRadius: 1,
  },
  tabText: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.textTertiary },
  tabTextActive: { color: Colors.text, fontFamily: "Inter_600SemiBold" },
  tasksContainer: { gap: 12 },
  taskGroup: { gap: 8 },
  taskGroupHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  taskGroupDot: { width: 6, height: 6, borderRadius: 3 },
  taskGroupTitle: {
    fontSize: 12, fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase", letterSpacing: 1.5,
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
    flexDirection: "row", backgroundColor: Colors.card, borderRadius: 14,
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
    borderRadius: 14, borderWidth: 1, borderColor: Colors.border,
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

  scheduleContainer: { gap: 16 },
  scheduleSection: { gap: 0 },
  scheduleSectionHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 4, paddingBottom: 8,
  },
  scheduleSectionTitle: {
    fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.textTertiary,
    textTransform: "uppercase", letterSpacing: 1.5,
  },
  scheduleSectionContent: {
    backgroundColor: Colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border, overflow: "hidden",
  },
  scheduleSectionEmpty: {
    fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textTertiary,
    textAlign: "center", paddingVertical: 20,
  },
  scheduleCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingHorizontal: 20, paddingVertical: 14,
  },
  scheduleCardBorder: {
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  scheduleCardBar: {
    width: 4, height: 28, borderRadius: 2, flexShrink: 0,
  },
  scheduleCardBody: { flex: 1, gap: 3 },
  scheduleCardName: {
    fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.text,
  },
  scheduleCardNameDone: {
    fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textTertiary,
  },
  scheduleCardDue: {
    fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary,
  },
  scheduleCardDueDone: {
    fontSize: 12, color: Colors.textTertiary,
  },
  scheduleCardCompletedInfo: {
    fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, marginTop: 4,
  },
  scheduleEmpty: {
    alignItems: "center", paddingVertical: 40, paddingHorizontal: 20, gap: 8,
  },
  scheduleEmptyTitle: {
    fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.textSecondary, textAlign: "center",
  },
  scheduleEmptySubtitle: {
    fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textTertiary,
    textAlign: "center",
  },
  generateBtn: {
    flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: Colors.accent,
    borderRadius: 12, paddingHorizontal: 22, paddingVertical: 12, marginTop: 6,
  },
  generateBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  scheduleError: { alignItems: "center", paddingVertical: 36, gap: 10 },
  scheduleErrorText: {
    fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center",
  },
  retryBtn: {
    backgroundColor: Colors.surface, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 9,
    borderWidth: 1, borderColor: Colors.border, marginTop: 4,
  },
  retryBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.text },
  skeletonContainer: { gap: 0, backgroundColor: Colors.card, borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: Colors.border },
  skeletonCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  skeletonLine: {
    height: 14, borderRadius: 7, backgroundColor: Colors.surface, width: "80%",
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
  sheetScroll: { maxHeight: 400 },
  sheetFields: { gap: 16 },
  sheetField: { gap: 6 },
  sheetFieldLabel: {
    fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.textSecondary,
    textTransform: "uppercase", letterSpacing: 1.5,
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
