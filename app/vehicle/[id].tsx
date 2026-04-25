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
  Animated,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { completeVehicleTask } from "@/lib/rpc";
import * as Haptics from "expo-haptics";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { parseISO, isBefore, addMonths, format, formatDistanceToNowStrict, differenceInDays } from "date-fns";
import { useAuth } from "@/context/AuthContext";
import Paywall from "@/components/Paywall";
import { hasPersonalOrAbove } from "@/lib/subscription";
import { SaveToast } from "@/components/SaveToast";
import DatePicker from "@/components/DatePicker";
import { HOURS_TRACKED_TYPES, MILEAGE_TRACKED_TYPES } from "@/lib/vehicleTypes";
import { formatShopAndDiy } from "@/lib/costFormat";
import {
  resolveTrackingMode,
  isHoursTracked,
  isMileageTracked,
  isTimeOnly,
  currentUsageValue,
  formatUsageValue,
  taskNextDueUsage,
  taskLastCompletedUsage,
  type TrackingMode,
} from "@/lib/usageHelpers";
import Tooltip, { TOOLTIP_IDS } from "@/components/Tooltip";
import UpdateBanner from "@/components/UpdateBanner";
import { scheduleMaintenanceNotifications } from "@/lib/notificationScheduler";

function taskUsesHoursUsage(task: any, mode: TrackingMode): boolean {
  if (mode === "hours" || mode === "both") {
    return task.interval_hours != null || task.next_due_hours != null;
  }
  return false;
}

function calcStatus(
  task: any,
  vehicle: any,
): "overdue" | "needs_attention" | "due_soon" | "upcoming" | "completed" {
  if (task.status === "completed") return "completed";
  const today = new Date();
  const dueDate = task.next_due_date ? parseISO(task.next_due_date) : null;

  // Usage-based check (miles OR hours depending on tracking mode)
  const currentUsage = currentUsageValue(vehicle);
  const nextDueUsage = taskNextDueUsage(task, vehicle);
  const hoursMode = isHoursTracked(vehicle);
  const dueSoonThreshold = hoursMode ? 25 : 500; // 25 hours or 500 miles

  if (
    (nextDueUsage != null && currentUsage != null && currentUsage >= nextDueUsage) ||
    (dueDate != null && dueDate <= today)
  ) {
    if (task.updated_at && (Date.now() - new Date(task.updated_at).getTime() < 48 * 60 * 60 * 1000)) {
      return "needs_attention";
    }
    return "overdue";
  }
  if (
    (nextDueUsage != null && currentUsage != null && nextDueUsage - currentUsage <= dueSoonThreshold) ||
    (dueDate != null && differenceInDays(dueDate, today) <= 30)
  ) return "due_soon";
  return "upcoming";
}

function nextUsageSortKey(
  task: { next_due_miles?: number | null; next_due_hours?: number | null },
  mode: TrackingMode,
): number {
  if (taskUsesHoursUsage(task, mode)) {
    const h = task.next_due_hours;
    if (h != null) return Number(h);
  }
  const m = task.next_due_miles;
  if (m != null) return Number(m);
  return Infinity;
}

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
  upcoming:        Colors.border,
  due_soon:        Colors.dueSoon,
  overdue:         Colors.overdue,
  needs_attention: Colors.needsAttention,
  completed:       Colors.good,
};

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
  const [refreshingSchedule, setRefreshingSchedule] = useState(false);
  const [vehicleScheduleBannerVisible, setVehicleScheduleBannerVisible] = useState(false);
  const [scheduleToast, setScheduleToast] = useState("");
  const [showScheduleToast, setShowScheduleToast] = useState(false);
  const [scheduleToastIsError, setScheduleToastIsError] = useState(false);
  const [scheduleToastSubtitle, setScheduleToastSubtitle] = useState<string | undefined>(undefined);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [showDifficultyInfo, setShowDifficultyInfo] = useState(false);
  const [scheduleInsight, setScheduleInsight] = useState<string | null>(null);
  const [insightTaskName, setInsightTaskName] = useState<string | null>(null);
  const [highlightedTask, setHighlightedTask] = useState<string | null>(null);
  const prevScheduleCountRef = useRef(0);
  const lastStatusHashRef = useRef("");
  const pollStartRef = useRef<number | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStatusHashRef = useRef<string | null>(null);

  const [markCompleteTask, setMarkCompleteTask] = useState<any | null>(null);
  const [completeMileage, setCompleteMileage] = useState("");
  const [completeDate, setCompleteDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [completeNotes, setCompleteNotes] = useState("");
  const [completeCost, setCompleteCost] = useState("");
  const [completeProvider, setCompleteProvider] = useState("");
  const [completeDiy, setCompleteDiy] = useState(false);
  const [completeDuration, setCompleteDuration] = useState("");
  const [isSavingComplete, setIsSavingComplete] = useState(false);

  const [editTaskSheet, setEditTaskSheet] = useState<any | null>(null);

  const { data: vehicle, isLoading: loadingVehicle } = useQuery({
    queryKey: ["vehicle", id],
    queryFn: async () => {
      const { data } = await supabase.from("vehicles").select("*").eq("id", id).maybeSingle();
      return data;
    },
    enabled: !!id,
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

      // Fetch uncached estimates in parallel (batches of 5 to avoid overwhelming the API)
      const uncached = serviceNames.filter((s: string) => !cached.has(s));
      const BATCH_SIZE = 5;
      for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
        const batch = uncached.slice(i, i + BATCH_SIZE);
        await Promise.allSettled(
          batch.map((svc) => {
            const serviceName = svc;
            return supabase.functions.invoke("estimate-repair-cost", {
              body: {
                year: vehicle.year ?? null,
                make: vehicle.make,
                model: vehicle.model,
                service_name: serviceName,
                vehicle_type: vehicle.vehicle_type ?? "car",
              },
            }).then(({ data: fnData, error: fnErr }) => {
              if (fnErr) {
                console.warn("[CostEstimate] edge fn error for", serviceName, ":", fnErr.message ?? fnErr);
                return;
              }
              const estimate = fnData?.data ?? (fnData?.shop_low != null ? fnData : null);
              if (estimate) {
                results[serviceName] = estimate;
              } else {
                console.warn("[CostEstimate] no estimate for", serviceName);
              }
            }).catch((err: any) => {
              console.warn("[CostEstimate] exception for", serviceName, ":", err?.message ?? err);
            });
          })
        );
      }

      return results;
    },
    enabled: !!vehicle?.make && !!scheduleTasks?.length,
    staleTime: 1000 * 60 * 60, // 1 hour
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

  const vehicleMode = useMemo(
    () => (vehicle ? resolveTrackingMode(vehicle) : "mileage"),
    [vehicle],
  );

  const processedScheduleTasks = useMemo(() => {
    if (!scheduleTasks || !vehicle) return scheduleTasks ?? [];
    return scheduleTasks.map(t => ({
      ...t,
      status: calcStatus(t, vehicle),
    }));
  }, [scheduleTasks, vehicle]);

  const scheduleOpacity = useRef(new Animated.Value(0)).current;

  useFocusEffect(
    useCallback(() => {
      refetchSchedule();
    }, [refetchSchedule]),
  );

  useEffect(() => {
    if (!scheduleTasks?.length || !id) return;
    const oldest = scheduleTasks.reduce((a: any, b: any) =>
      (a.created_at ?? "") < (b.created_at ?? "") ? a : b
    );
    const ageInDays = oldest?.created_at
      ? differenceInDays(new Date(), new Date(oldest.created_at))
      : 0;
    if (ageInDays < 7) return;
    AsyncStorage.getItem(`@schedule_refresh_dismissed_${id}`).then(val => {
      if (val !== "true") setVehicleScheduleBannerVisible(true);
    }).catch(() => {});
  }, [scheduleTasks, id]);

  // Reset polling state when vehicle changes
  React.useEffect(() => {
    pollStartRef.current = null;
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, [id]);

  React.useEffect(() => {
    // Clear any existing interval first to prevent overlaps
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    if (!loadingSchedule && (!scheduleTasks || scheduleTasks.length === 0) && !!user && !!id) {
      if (pollStartRef.current === null) pollStartRef.current = Date.now();
      const elapsed = Date.now() - pollStartRef.current;
      if (elapsed >= 60000) return; // Hard stop at 60 seconds

      pollIntervalRef.current = setInterval(() => {
        const now = Date.now();
        if (pollStartRef.current !== null && now - pollStartRef.current >= 60000) {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
          return;
        }
        refetchSchedule();
      }, 3000);

      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      };
    } else if (scheduleTasks && scheduleTasks.length > 0) {
      pollStartRef.current = null; // Reset for future use (e.g., schedule refresh)
    }
  }, [loadingSchedule, scheduleTasks?.length, user, id, refetchSchedule]);

  React.useEffect(() => {
    if (processedScheduleTasks.length > 0) {
      Animated.timing(scheduleOpacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();
    }
  }, [processedScheduleTasks.length]);

  React.useEffect(() => {
    if (!processedScheduleTasks || !scheduleTasks || processedScheduleTasks.length === 0) return;
    const changed = processedScheduleTasks.filter((pt, i) => {
      const orig = scheduleTasks[i];
      return orig && pt.status !== orig.status;
    });
    if (changed.length === 0) return;
    const hash = changed.map(t => `${t.id}:${t.status}`).join(",");
    if (lastStatusHashRef.current === hash) return;

    // Clear any pending write — new data supersedes it
    if (statusSyncTimerRef.current) {
      clearTimeout(statusSyncTimerRef.current);
      statusSyncTimerRef.current = null;
      pendingStatusHashRef.current = null;
    }

    pendingStatusHashRef.current = hash;

    statusSyncTimerRef.current = setTimeout(() => {
      const writingHash = pendingStatusHashRef.current;
      Promise.all(
        changed.map(t =>
          supabase
            .from("user_vehicle_maintenance_tasks")
            .update({ status: t.status, updated_at: new Date().toISOString() })
            .eq("id", t.id),
        ),
      ).then(() => {
        // Only mark as synced after successful write
        if (writingHash) lastStatusHashRef.current = writingHash;
      }).catch((err) => {
        // Write failed — don't mark as synced so it retries on next render
        console.warn("[StatusSync] Write failed:", err);
      }).finally(() => {
        pendingStatusHashRef.current = null;
        statusSyncTimerRef.current = null;
      });
    }, 2000);

    return () => {
      if (statusSyncTimerRef.current) {
        clearTimeout(statusSyncTimerRef.current);
        statusSyncTimerRef.current = null;
        pendingStatusHashRef.current = null;
      }
    };
  }, [processedScheduleTasks, scheduleTasks]);

  const actionNeededTasks = useMemo(
    () => processedScheduleTasks.filter(t => t.status === "overdue" || t.status === "needs_attention" || t.status === "due_soon")
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "overdue" ? -1 : a.status === "needs_attention" && b.status !== "overdue" ? -1 : 1;
        return nextUsageSortKey(a, vehicleMode) - nextUsageSortKey(b, vehicleMode);
      }),
    [processedScheduleTasks, vehicleMode],
  );

  const upcomingTasks = useMemo(
    () => processedScheduleTasks.filter(t => t.status === "upcoming")
      .sort((a, b) => {
        const aKey = nextUsageSortKey(a, vehicleMode);
        const bKey = nextUsageSortKey(b, vehicleMode);
        if (aKey !== bKey) return aKey - bKey;
        const aDate = a.next_due_date ?? "9999";
        const bDate = b.next_due_date ?? "9999";
        return aDate.localeCompare(bDate);
      }),
    [processedScheduleTasks, vehicleMode],
  );

  React.useEffect(() => {
    if (!processedScheduleTasks || processedScheduleTasks.length === 0) { setScheduleInsight(null); setInsightTaskName(null); return; }
    if (processedScheduleTasks.some(t => t.last_completed_date != null)) { setScheduleInsight(null); setInsightTaskName(null); return; }
    const overdue = processedScheduleTasks.filter(t => t.status === "overdue" || t.status === "needs_attention");
    const dueSoon = processedScheduleTasks.filter(t => t.status === "due_soon");
    const highPri = processedScheduleTasks.filter(t => t.priority === "high");
    let insight: string | null = null;
    let taskName: string | null = null;
    if (overdue.length > 0) {
      const t = overdue[0]; taskName = t.name;
      const short = t.name.length > 30 ? t.name.slice(0, 27) + "..." : t.name;
      insight = `${short} is coming up.`;
    } else if (dueSoon.length > 0) {
      const t = dueSoon[0]; taskName = t.name;
      if (/chain/i.test(t.name)) insight = "Chain maintenance comes up often on this bike.";
      else if (/oil/i.test(t.name)) insight = "Oil change is coming up soon.";
      else if (/brake/i.test(t.name)) insight = "Brake service should be your next priority.";
      else if (/tire/i.test(t.name)) insight = "Tire condition check is due soon.";
      else { const short = t.name.length > 30 ? t.name.slice(0, 27) + "..." : t.name; insight = `${short} is coming up soon.`; }
    } else if (highPri.length > 0) {
      const t = highPri[0]; taskName = t.name;
      if (/chain/i.test(t.name)) insight = "Chain maintenance comes up often on this bike.";
      else if (/oil/i.test(t.name)) insight = "Oil changes are one of the most important routines.";
      else insight = "Focus on the next task below.";
    }
    setScheduleInsight(insight); setInsightTaskName(taskName);
  }, [processedScheduleTasks]);

  React.useEffect(() => {
    if (processedScheduleTasks.length > 0 && prevScheduleCountRef.current === 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    prevScheduleCountRef.current = processedScheduleTasks.length;
  }, [processedScheduleTasks.length]);

  const completedTasks = useMemo(
    () => processedScheduleTasks.filter(t => t.status === "completed").slice(0, 10),
    [processedScheduleTasks],
  );

  async function generateSchedule() {
    if (!vehicle || !user) return;
    setGeneratingSchedule(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const mode = resolveTrackingMode(vehicle);
      const { error } = await supabase.functions.invoke("generate-maintenance-schedule", {
        body: {
          vehicle_id: id,
          make: vehicle.make,
          model: vehicle.model ?? "",
          year: parseInt(String(vehicle.year), 10),
          current_mileage: vehicle.mileage ?? 0,
          current_hours: vehicle.hours ?? 0,
          tracking_mode: mode,
          fuel_type: vehicle.fuel_type ?? "gas",
          is_awd: vehicle.is_awd ?? false,
          vehicle_category: vehicle.vehicle_category ?? vehicle.vehicle_type ?? "car",
        },
      });
      if (error) {
        const httpStatus = ((error as unknown as Record<string, unknown>)?.context as Record<string, unknown>)?.status as number | undefined;
        if (httpStatus !== 409) {
          showToast("Failed to generate schedule. Please try again.", true);
          return;
        }
      }
      pollStartRef.current = null;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      await refetchSchedule();
      showToast("Schedule generated!");
    } catch {
      showToast("Failed to generate schedule. Please try again.", true);
    } finally {
      setGeneratingSchedule(false);
    }
  }

  async function refreshSchedule() {
    if (!vehicle || !user) return;
    setRefreshingSchedule(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const mode = resolveTrackingMode(vehicle);
      const { error } = await supabase.functions.invoke("generate-maintenance-schedule", {
        body: {
          vehicle_id: id,
          make: vehicle.make,
          model: vehicle.model ?? "",
          year: parseInt(String(vehicle.year), 10),
          current_mileage: vehicle.mileage ?? 0,
          current_hours: vehicle.hours ?? 0,
          tracking_mode: mode,
          fuel_type: vehicle.fuel_type ?? "gas",
          is_awd: vehicle.is_awd ?? false,
          vehicle_category: vehicle.vehicle_category ?? vehicle.vehicle_type ?? "car",
          force_refresh: true,
        },
      });
      if (error) {
        showToast("Failed to refresh schedule. Please try again.", true);
        return;
      }
      await AsyncStorage.setItem(`@schedule_refresh_dismissed_${id}`, "true");
      await refetchSchedule();
      showToast("Schedule updated");
    } catch {
      showToast("Failed to refresh schedule. Please try again.", true);
    } finally {
      setRefreshingSchedule(false);
    }
  }

  function handleRefreshSchedulePress() {
    Alert.alert(
      "Refresh maintenance schedule?",
      "We'll rebuild this vehicle's recommended schedule using your current mileage, service history, and the latest improvements. Your service history and custom tasks will be kept.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Refresh", onPress: refreshSchedule },
      ],
    );
  }

  function showToast(msg: string, isError = false, subtitle?: string) {
    setScheduleToast(msg);
    setScheduleToastSubtitle(subtitle);
    setScheduleToastIsError(isError);
    setShowScheduleToast(true);
    setTimeout(() => setShowScheduleToast(false), 2800);
  }

  function handleOpenMarkComplete(task: any) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMarkCompleteTask(task);
    const mode = resolveTrackingMode(vehicle ?? {});
    const hoursFirst = taskUsesHoursUsage(task, mode) || mode === "hours";
    setCompleteMileage(
      hoursFirst
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

  function handleOpenEditTask(task: any) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditTaskSheet(task);
  }

  function handleCloseEditTask() {
    setEditTaskSheet(null);
  }

  async function handleSaveEditTask(task: any, name: string, miles: number | null, months: number | null, changeMethod: "preset" | "custom") {
    if (!task || !vehicle) return;
    const tracksHrs = isHoursTracked(vehicle);

    const baseMiles = task.last_completed_miles ?? (tracksHrs ? null : (vehicle.mileage ?? null));
    const baseHours = task.last_completed_hours ?? (tracksHrs ? (vehicle.hours ?? null) : null);
    const baseDate = task.last_completed_date ?? format(new Date(), "yyyy-MM-dd");

    const newNextDueMiles = !tracksHrs && miles != null && baseMiles != null
      ? baseMiles + miles : task.next_due_miles;
    const newNextDueHours = tracksHrs && task.interval_hours != null && baseHours != null
      ? baseHours + task.interval_hours : task.next_due_hours;
    const newNextDueDate = months != null
      ? format(addMonths(parseISO(baseDate), months), "yyyy-MM-dd")
      : task.next_due_date;

    const updatedTask = {
      ...task,
      name,
      interval_miles: miles,
      interval_months: months,
      is_custom: true,
      next_due_miles: newNextDueMiles,
      next_due_hours: newNextDueHours,
      next_due_date: newNextDueDate,
    };

    queryClient.setQueryData(["user_vehicle_maintenance_tasks", id], (old: any[] | undefined) => {
      if (!old) return old;
      return old.map(t => t.id === task.id ? updatedTask : t);
    });

    try {
      const { error } = await supabase.from("user_vehicle_maintenance_tasks").update({
        name,
        interval_miles: miles,
        interval_months: months,
        is_custom: true,
        next_due_miles: newNextDueMiles,
        next_due_hours: newNextDueHours,
        next_due_date: newNextDueDate,
      }).eq("id", task.id);
      if (error) throw error;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast("Task updated");

      // Fire-and-forget analytics — never block the save or show errors
      supabase.from("interval_corrections").insert({
        user_id: user?.id,
        vehicle_id: id,
        task_name: task.name,
        task_key: task.task_key ?? task.key ?? null,
        vehicle_spec: [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" "),
        vehicle_category: vehicle.vehicle_type ?? vehicle.vehicle_category ?? null,
        fuel_type: vehicle.fuel_type ?? null,
        original_interval_miles: task.interval_miles ?? null,
        original_interval_months: task.interval_months ?? null,
        corrected_interval_miles: miles,
        corrected_interval_months: months,
        change_method: changeMethod,
        task_had_completion: task.last_completed_date != null,
        schedule_source: task.source ?? null,
      }).then(() => {}).catch(() => {});
    } catch {
      showToast("Failed to save changes.", true);
      queryClient.invalidateQueries({ queryKey: ["user_vehicle_maintenance_tasks", id] });
    }
  }

  async function handleDeleteEditTask(task: any) {
    if (!task) return;
    queryClient.setQueryData(["user_vehicle_maintenance_tasks", id], (old: any[] | undefined) => {
      if (!old) return old;
      return old.filter(t => t.id !== task.id);
    });
    try {
      await supabase.from("user_vehicle_maintenance_tasks").delete().eq("id", task.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast("Task removed");
    } catch {
      showToast("Failed to delete task.", true);
      queryClient.invalidateQueries({ queryKey: ["user_vehicle_maintenance_tasks", id] });
    }
  }

  async function handleSaveMarkComplete() {
    if (!markCompleteTask || !vehicle) return;
    const task = markCompleteTask;
    const mode = resolveTrackingMode(vehicle);
    const taskUsesHours = taskUsesHoursUsage(task, mode) || mode === "hours";
    const taskUsesMiles = !taskUsesHours && (mode === "mileage" || mode === "both");
    let usageNum: number | null = null;
    if (taskUsesMiles || taskUsesHours) {
      const parsed = taskUsesHours ? parseFloat(completeMileage.replace(/,/g, "")) : parseInt(completeMileage.replace(/,/g, ""), 10);
      if (!completeMileage.trim() || isNaN(parsed) || parsed < 0) {
        showToast(taskUsesHours ? "Please enter a valid hours value." : "Please enter a valid mileage.", true);
        return;
      }
      usageNum = parsed;
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

    setIsSavingComplete(true);

    try {
      // 1. RPC — all writes are atomic; no success UI until this resolves
      const rpcPromise = completeVehicleTask({
        p_task_id: task.id,
        p_mileage: taskUsesMiles ? (usageNum ?? undefined) : undefined,
        p_hours: taskUsesHours ? (usageNum ?? undefined) : undefined,
        p_completed_date: completeDate,
        p_notes: notesForLog ?? undefined,
        p_cost: costTrim ? parseFloat(completeCost) : undefined,
        p_skip_log: false,
        p_provider_name: completeProvider.trim() || undefined,
        p_did_it_myself: completeDiy,
      });
      const timeoutMs = 15000;
      let timeoutId: ReturnType<typeof setTimeout>;
      const timeout = new Promise<never>((_, reject) => { timeoutId = setTimeout(() => reject(new Error(`[MarkComplete] RPC timed out after ${timeoutMs}ms`)), timeoutMs); });
      const { data: rpcResult, error: rpcErr } = await Promise.race([rpcPromise, timeout]);
      clearTimeout(timeoutId!);
      if (rpcErr) throw rpcErr;

      handleCloseMarkComplete();

      // 2. Invalidate/refetch queries
      queryClient.invalidateQueries({ queryKey: ["vehicle", id] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["maintenance_logs", id] });
      queryClient.invalidateQueries({ queryKey: ["user_vehicle_maintenance_tasks", id] });

      // 3. Success haptics + toast — fire immediately, don't wait for notifications
      const toastTitle = `${rpcResult?.task_name ?? task.name} marked complete`;
      let toastSubtitle: string | undefined;
      if (rpcResult?.next_due_miles != null) {
        toastSubtitle = `Next due at ${Number(rpcResult.next_due_miles).toLocaleString()} mi`;
      } else if (rpcResult?.next_due_hours != null) {
        toastSubtitle = `Next due at ${Number(rpcResult.next_due_hours).toLocaleString()} hrs`;
      } else if (rpcResult?.next_due_date) {
        toastSubtitle = `Next due ${format(parseISO(rpcResult.next_due_date), "MMM d, yyyy")}`;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(toastTitle, false, toastSubtitle);

      // 4. Schedule notifications — fire-and-forget, never blocks UI
      if (user?.id) {
        try { scheduleMaintenanceNotifications(user.id).catch(() => {}); } catch {}
      }
    } catch (e) {
      console.error("[MarkComplete] RPC failed:", e);
      handleCloseMarkComplete();
      queryClient.invalidateQueries({ queryKey: ["user_vehicle_maintenance_tasks", id] });
      showToast("Failed to save. Please try again.", true);
    } finally {
      setIsSavingComplete(false);
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
    const tracksHrs = isHoursTracked(vehicle);
    const usageLabel = tracksHrs ? "Hours" : "Mileage";
    const header = `Date,Service,${usageLabel},Cost,Provider,Notes,Receipt`;
    const rows = logsData.map(log => {
      const date = log.service_date ?? "";
      const task = (log.service_name ?? "").replace(/,/g, ";");
      const usage = log.mileage ?? "";
      const cost = log.cost != null ? `$${log.cost.toFixed(2)}` : "";
      const provider = (log.provider_name ?? "").replace(/,/g, ";");
      const notes = (log.notes ?? "").replace(/,/g, ";").replace(/\n/g, " ");
      const receipt = log.receipt_url ? `https://fqblqrrgjpwysrsiolcn.supabase.co/storage/v1/object/public/receipts/${log.receipt_url}` : "-";
      return `${date},${task},${usage},${cost},${provider},${notes},${receipt}`;
    });
    return [header, ...rows, "", "Usage data is self-reported by the owner and has not been independently verified."].join("\n");
  }

  function buildHtml(logsData: any[], vehicleData: any) {
    const name = vehicleData?.nickname ?? `${vehicleData?.year} ${vehicleData?.make} ${vehicleData?.model}`;
    const rows = logsData.map(log => {
      const receiptCell = log.receipt_url
        ? `<a href="https://fqblqrrgjpwysrsiolcn.supabase.co/storage/v1/object/public/receipts/${log.receipt_url}" target="_blank">View Receipt</a>`
        : "-";
      return `
      <tr>
        <td>${log.service_date ? format(parseISO(log.service_date), "MMM d, yyyy") : "-"}</td>
        <td>${log.service_name ?? "Service"}</td>
        <td>${log.mileage != null ? log.mileage.toLocaleString() + (isHoursTracked(vehicle) ? " hrs" : " mi") : "-"}</td>
        <td>${log.cost != null ? "$" + log.cost.toFixed(2) : "-"}</td>
        <td>${log.provider_name ?? "-"}</td>
        <td>${log.notes ?? ""}</td>
        <td>${receiptCell}</td>
      </tr>`;
    }).join("");
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
      <thead><tr><th>Date</th><th>Service</th><th>${isHoursTracked(vehicle) ? "Hours" : "Mileage"}</th><th>Cost</th><th>Provider</th><th>Notes</th><th>Receipt</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="footer">Generated by LifeMaintained · lifemaintained.app<br/>Usage data is self-reported by the owner and has not been independently verified.</div>
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
          onPress: () => {
            const vehicleId = id!;
            const userId = user!.id;

            // Optimistically remove from cache (safe handling)
            queryClient.setQueryData(["vehicles", userId], (old: any) => {
              if (!old) return old;

              // Handle array case
              if (Array.isArray(old)) {
                return old.filter((v: any) => v.id !== vehicleId);
              }

              // Handle object shape { data: [...] }
              if (old.data && Array.isArray(old.data)) {
                return {
                  ...old,
                  data: old.data.filter((v: any) => v.id !== vehicleId),
                };
              }

              return old;
            });

            // Navigate safely to vehicles list
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace("/(tabs)/vehicles");
            }

            // Background delete
            (async () => {
              try {
                await supabase.from("user_vehicle_maintenance_tasks").delete().eq("vehicle_id", vehicleId);
                await supabase.from("maintenance_logs").delete().eq("vehicle_id", vehicleId);
                await supabase.from("vehicle_mileage_history").delete().eq("vehicle_id", vehicleId);

                const { data: walletFiles } = await supabase.storage
                  .from("wallet-documents")
                  .list(`${userId}/${vehicleId}`);

                if (walletFiles?.length) {
                  await supabase.storage
                    .from("wallet-documents")
                    .remove(walletFiles.map(f => `${userId}/${vehicleId}/${f.name}`));
                }

                await supabase.from("vehicle_wallet_documents").delete().eq("vehicle_id", vehicleId);
                await supabase.from("vehicles").delete().eq("id", vehicleId);

                queryClient.invalidateQueries({ queryKey: ["vehicles"] });
                queryClient.invalidateQueries({ queryKey: ["dashboard"] });

              } catch (err: any) {
                console.warn("[DELETE] Background delete error:", err?.message ?? err);

                // Re-sync state if something failed
                queryClient.invalidateQueries({ queryKey: ["vehicles"] });
              }
            })();
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

  const markCompleteMode = vehicle ? resolveTrackingMode(vehicle) : "mileage";
  const markCompleteUsesHours = markCompleteTask
    ? (taskUsesHoursUsage(markCompleteTask, markCompleteMode) || markCompleteMode === "hours")
    : isHoursTracked(vehicle);

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
          {vehicle?.mileage != null && isMileageTracked(vehicle) && (
            <View style={styles.headerMileageRow}>
              <Ionicons name="speedometer-outline" size={11} color={Colors.textTertiary} />
              <Text style={styles.headerMileage}>{vehicle.mileage.toLocaleString()} mi</Text>
            </View>
          )}
          {vehicle?.hours != null && isHoursTracked(vehicle) && (
            <View style={styles.headerMileageRow}>
              <Ionicons name="timer-outline" size={11} color={Colors.textTertiary} />
              <Text style={styles.headerMileage}>{vehicle.hours.toLocaleString()} hrs</Text>
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
              const tracksMiles = isMileageTracked(vehicle);
              const tracksHrs = isHoursTracked(vehicle);
              const timeOnlyMode = isTimeOnly(vehicle);
              const usage = currentUsageValue(vehicle);
              let metaLine = timeOnlyMode ? "Time-based maintenance" : "No usage tracked";
              if (usage != null) {
                const usageStr = formatUsageValue(usage, vehicle);
                if (vehicle.updated_at) {
                  metaLine = usageStr + " · Updated " + formatDistanceToNowStrict(parseISO(vehicle.updated_at), { addSuffix: true });
                } else {
                  metaLine = usageStr;
                }
              } else if (tracksHrs) {
                metaLine = "No hours entered yet";
              } else if (tracksMiles) {
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
                  {(tracksMiles || tracksHrs) && (
                    <Pressable
                      style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1, alignSelf: "center" }]}
                      onPress={() => router.push(`/update-mileage/${id}` as any)}
                    >
                      <Text style={styles.updateMileageLink}>{tracksHrs ? "Update hours →" : "Update mileage →"}</Text>
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
              <Tooltip
                id={TOOLTIP_IDS.VEHICLE_DETAIL_SCHEDULE}
                message="Your schedule gets smarter when you log past services. Tap any task to mark it complete."
                icon="checkmark-circle-outline"
              />
              {vehicleScheduleBannerVisible && processedScheduleTasks.length > 0 && (
                <View style={{ flexDirection: "row", alignItems: "flex-start", backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.good + "44", padding: 14, gap: 12, marginHorizontal: 16, marginBottom: 8 }}>
                  <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: Colors.goodMuted, alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                    <Ionicons name="sparkles-outline" size={18} color={Colors.good} />
                  </View>
                  <View style={{ flex: 1, gap: 6 }}>
                    <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, lineHeight: 18 }}>
                      A better schedule is available for this vehicle.
                    </Text>
                    <Pressable
                      onPress={() => { setVehicleScheduleBannerVisible(false); handleRefreshSchedulePress(); }}
                      style={({ pressed }) => [{ alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: Colors.good, opacity: pressed ? 0.75 : 1 }]}
                    >
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" }}>Refresh Now</Text>
                    </Pressable>
                  </View>
                  <Pressable
                    onPress={async () => {
                      setVehicleScheduleBannerVisible(false);
                      if (id) await AsyncStorage.setItem(`@schedule_refresh_dismissed_${id}`, "true").catch(() => {});
                    }}
                    hitSlop={12}
                    style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                  >
                    <Ionicons name="close" size={18} color={Colors.textTertiary} />
                  </Pressable>
                </View>
              )}
              {(loadingSchedule || refreshingSchedule) ? (
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
              ) : processedScheduleTasks.length > 0 && !processedScheduleTasks.some(t => t.last_completed_date != null) ? (
                <Animated.View style={{ opacity: scheduleOpacity }}>
                  {scheduleInsight && (
                    <Pressable
                      onPress={() => { if (insightTaskName) { setHighlightedTask(insightTaskName); setTimeout(() => setHighlightedTask(null), 2000); } }}
                      style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, flexDirection: "column", alignItems: "flex-start", gap: 4 }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                        <Ionicons name="bulb-outline" size={16} color={Colors.textSecondary} style={{ marginTop: 1 }} />
                        <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.textSecondary, flex: 1 }}>
                          {scheduleInsight}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary, marginTop: 2 }}>
                        Based on your vehicle and usage
                      </Text>
                    </Pressable>
                  )}
                  <View style={{ backgroundColor: Colors.dueSoonMuted, borderRadius: 10, padding: 12, marginHorizontal: 16, marginTop: 8, marginBottom: 12, flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                    <Ionicons name="information-circle-outline" size={18} color={Colors.dueSoon} style={{ marginTop: 1 }} />
                    <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.dueSoon, flex: 1 }}>
                      This schedule is estimated from your current usage. Tap any task to log your last service date for more accurate due dates.
                    </Text>
                  </View>
                  {actionNeededTasks.length > 0 && (
                    <ScheduleSection
                      title={`Action Needed (${actionNeededTasks.length})`}
                      titleColor={Colors.overdue}
                      expanded={actionNeededExpanded}
                      onToggle={() => { Haptics.selectionAsync(); setActionNeededExpanded(v => !v); }}
                      tasks={actionNeededTasks}
                      vehicle={vehicle}
                      onMarkComplete={handleOpenMarkComplete}
                      onEditTask={handleOpenEditTask}
                      costEstimates={costEstimates}
                      onShowDifficultyInfo={() => setShowDifficultyInfo(true)}
                      highlightedTask={highlightedTask}
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
                    onEditTask={handleOpenEditTask}
                    costEstimates={costEstimates}
                    onShowDifficultyInfo={() => setShowDifficultyInfo(true)}
                    highlightedTask={highlightedTask}
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
                      onEditTask={handleOpenEditTask}
                      costEstimates={costEstimates}
                      onShowDifficultyInfo={() => setShowDifficultyInfo(true)}
                      highlightedTask={highlightedTask}
                    />
                  )}
                  {Object.keys(costEstimates ?? {}).length > 0 && (
                    <Text style={{ fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.textTertiary, textAlign: "center", marginTop: 12, paddingHorizontal: 16 }}>
                      Cost estimates are approximate and vary by location and shop. Not a guarantee of pricing.
                    </Text>
                  )}
                  <Pressable
                    style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, opacity: pressed || refreshingSchedule ? 0.6 : 1 }]}
                    onPress={handleRefreshSchedulePress}
                    disabled={refreshingSchedule}
                  >
                    <Ionicons name="refresh-outline" size={14} color={Colors.textTertiary} />
                    <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary }}>Refresh Schedule</Text>
                  </Pressable>
                </Animated.View>
              ) : processedScheduleTasks.length === 0 ? (
                <View style={{ paddingTop: 16 }}>
                  <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
                    <Text style={{ fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text, marginBottom: 4 }}>
                      Building your maintenance plan
                    </Text>
                    <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textTertiary }}>
                      This usually takes about 10–20 seconds
                    </Text>
                  </View>
                  {!generatingSchedule && (
                    <Pressable
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); generateSchedule(); }}
                      style={({ pressed }) => [{ marginTop: 16, marginHorizontal: 16, paddingVertical: 14, paddingHorizontal: 20, backgroundColor: '#E8943A', borderRadius: 12, alignItems: 'center', opacity: pressed ? 0.85 : 1 }]}
                      accessibilityRole="button"
                      accessibilityLabel="Generate maintenance schedule"
                    >
                      <Text style={{ color: '#0C111B', fontSize: 16, fontFamily: 'Inter_600SemiBold' }}>Generate Schedule</Text>
                    </Pressable>
                  )}
                  <ScheduleSkeleton />
                </View>
              ) : (
                <Animated.View style={{ opacity: scheduleOpacity }}>
                  {actionNeededTasks.length > 0 && (
                    <ScheduleSection
                      title={`Action Needed (${actionNeededTasks.length})`}
                      titleColor={Colors.overdue}
                      expanded={actionNeededExpanded}
                      onToggle={() => { Haptics.selectionAsync(); setActionNeededExpanded(v => !v); }}
                      tasks={actionNeededTasks}
                      vehicle={vehicle}
                      onMarkComplete={handleOpenMarkComplete}
                      onEditTask={handleOpenEditTask}
                      costEstimates={costEstimates}
                      onShowDifficultyInfo={() => setShowDifficultyInfo(true)}
                      highlightedTask={highlightedTask}
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
                    onEditTask={handleOpenEditTask}
                    costEstimates={costEstimates}
                    onShowDifficultyInfo={() => setShowDifficultyInfo(true)}
                    highlightedTask={highlightedTask}
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
                      onEditTask={handleOpenEditTask}
                      costEstimates={costEstimates}
                      onShowDifficultyInfo={() => setShowDifficultyInfo(true)}
                      highlightedTask={highlightedTask}
                    />
                  )}
                  {Object.keys(costEstimates ?? {}).length > 0 && (
                    <Text style={{ fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.textTertiary, textAlign: "center", marginTop: 12, paddingHorizontal: 16 }}>
                      Cost estimates are approximate and vary by location and shop. Not a guarantee of pricing.
                    </Text>
                  )}
                  <Pressable
                    style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, opacity: pressed || refreshingSchedule ? 0.6 : 1 }]}
                    onPress={handleRefreshSchedulePress}
                    disabled={refreshingSchedule}
                  >
                    <Ionicons name="refresh-outline" size={14} color={Colors.textTertiary} />
                    <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary }}>Refresh Schedule</Text>
                  </Pressable>
                </Animated.View>
              )}
            </View>
          ) : activeTab === "wallet" ? (
            <>
              <Tooltip
                id={TOOLTIP_IDS.VEHICLE_GLOVEBOX}
                message="Store your registration, insurance, and ID here. Always have them when you need them."
                icon="wallet-outline"
              />
              <WalletTab vehicleId={id!} userId={user!.id} />
            </>
          ) : (
            <View style={styles.historyContainer}>
              <Tooltip
                id={TOOLTIP_IDS.VEHICLE_HISTORY}
                message="Every service you log shows up here. Export to PDF or CSV anytime."
                icon="time-outline"
              />
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
                          <Text style={[styles.historySummaryLabel, { textAlign: "center" }]}>{isHoursTracked(vehicle) ? "hours logged" : "miles driven"}{"\n"}(logged period)</Text>
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
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 32 }}>
          <Text style={{ fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text, textAlign: "center" }}>Vehicle not found</Text>
          <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center" }}>This vehicle may have been deleted.</Text>
          <Pressable
            onPress={() => router.back()}
            style={{ paddingHorizontal: 24, paddingVertical: 12, backgroundColor: Colors.accent, borderRadius: 12 }}
          >
            <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.textInverse }}>Go Back</Text>
          </Pressable>
        </View>
      )}

      <SaveToast visible={showScheduleToast} message={scheduleToast} subtitle={scheduleToastSubtitle} isError={scheduleToastIsError} />

      <EditTaskSheet
        visible={editTaskSheet != null}
        task={editTaskSheet}
        vehicle={vehicle}
        onClose={handleCloseEditTask}
        onMarkComplete={(task) => { handleCloseEditTask(); handleOpenMarkComplete(task); }}
        onSave={handleSaveEditTask}
        onDelete={(task) => { handleCloseEditTask(); handleDeleteEditTask(task); }}
        insets={insets}
      />

      <MarkCompleteSheet
        visible={markCompleteTask != null}
        task={markCompleteTask}
        mileage={completeMileage}
        onMileageChange={setCompleteMileage}
        showMileage={isMileageTracked(vehicle) || isHoursTracked(vehicle)}
        tracksHours={markCompleteUsesHours}
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
              backgroundColor: Colors.card,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              paddingHorizontal: 20,
              paddingTop: 16,
              paddingBottom: insets.bottom + 40,
            }}
          >
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.borderSubtle, alignSelf: "center", marginBottom: 16 }} />
            <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.textPrimary, marginBottom: 16 }}>
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
  onEditTask,
  costEstimates,
  onShowDifficultyInfo,
  highlightedTask,
}: {
  title: string;
  titleColor?: string;
  expanded: boolean;
  onToggle: () => void;
  tasks: any[];
  vehicle: any;
  emptyMessage?: string;
  onMarkComplete: (task: any) => void;
  onEditTask: (task: any) => void;
  costEstimates?: Record<string, any>;
  onShowDifficultyInfo?: () => void;
  highlightedTask?: string | null;
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
                onEditTask={onEditTask}
                isLast={idx === tasks.length - 1}
                costEstimate={costEstimates?.[task.name.toLowerCase().trim()]}
                onShowDifficultyInfo={onShowDifficultyInfo}
                isHighlighted={task.name === highlightedTask}
              />
            ))
          )}
        </View>
      )}
    </View>
  );
}

function ScheduleTaskCard({ task, vehicle, onMarkComplete, onEditTask, isLast, costEstimate, onShowDifficultyInfo, isHighlighted }: {
  task: any;
  vehicle: any;
  onMarkComplete: (task: any) => void;
  onEditTask: (task: any) => void;
  isLast?: boolean;
  costEstimate?: any;
  onShowDifficultyInfo?: () => void;
  isHighlighted?: boolean;
}) {
  const isCompleted = task.status === "completed";
  const [showCompletedInfo, setShowCompletedInfo] = useState(false);

  function handlePress() {
    if (isCompleted) {
      setShowCompletedInfo(true);
      setTimeout(() => setShowCompletedInfo(false), 2500);
    } else {
      onEditTask(task);
    }
  }

  const barColor = task.status === "overdue"
    ? Colors.overdue
    : task.status === "needs_attention"
      ? Colors.needsAttention
      : task.status === "due_soon"
        ? Colors.dueSoon
        : task.status === "completed"
          ? Colors.good
          : Colors.borderSubtle;

  const nextDueUsage = taskNextDueUsage(task, vehicle);
  const lastCompletedUsage = taskLastCompletedUsage(task, vehicle);
  const tracksHrs = isHoursTracked(vehicle);

  const dueParts: string[] = [];
  if (!isCompleted) {
    if (nextDueUsage != null) dueParts.push(`Due at ${formatUsageValue(nextDueUsage, vehicle)}`);
    if (task.next_due_date != null) dueParts.push(format(parseISO(task.next_due_date), "MMM d, yyyy"));
    if (dueParts.length === 0) dueParts.push("No schedule set");
  } else if (task.last_completed_date) {
    dueParts.push(`Completed ${format(parseISO(task.last_completed_date), "MMM d, yyyy")}`);
  }
  const dueText = dueParts.join(" · ");
  let lastServicedText: string | null = null;
  if (!isCompleted && task.last_completed_date) {
    const lastDate = format(parseISO(task.last_completed_date), "MMM d, yyyy");
    const lastUsage = lastCompletedUsage != null ? ` at ${formatUsageValue(lastCompletedUsage, vehicle)}` : "";
    lastServicedText = `Last serviced ${lastDate}${lastUsage}`;
  }

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.scheduleCard,
        !isLast && styles.scheduleCardBorder,
        !isCompleted && pressed && { opacity: 0.7 },
        isHighlighted && { backgroundColor: "rgba(255, 200, 50, 0.15)" },
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
        {costEstimate && !isCompleted && (() => {
          const costLine = formatShopAndDiy(
            costEstimate.shop_low != null ? Number(costEstimate.shop_low) : null,
            costEstimate.shop_high != null ? Number(costEstimate.shop_high) : null,
            costEstimate.diy_low != null ? Number(costEstimate.diy_low) : null,
            costEstimate.diy_high != null ? Number(costEstimate.diy_high) : null,
          );
          if (!costLine && !costEstimate.difficulty) return null;
          return (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
            {!!costLine && <Ionicons name="cash-outline" size={12} color={Colors.good} />}
            {!!costLine && <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.good }}>
              {costLine}
            </Text>}
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
          );
        })()}
        {showCompletedInfo && (
          <Text style={styles.scheduleCardCompletedInfo}>
            Already completed. To undo, delete the entry from the History tab.
          </Text>
        )}
      </View>
    </Pressable>
  );
}

function EditTaskSheet({
  visible,
  task,
  vehicle,
  onClose,
  onMarkComplete,
  onSave,
  onDelete,
  insets,
}: {
  visible: boolean;
  task: any | null;
  vehicle: any;
  onClose: () => void;
  onMarkComplete: (task: any) => void;
  onSave: (task: any, name: string, miles: number | null, months: number | null, changeMethod: "preset" | "custom") => void;
  onDelete: (task: any) => void;
  insets: { bottom: number };
}) {
  const [editName, setEditName] = useState(task?.name ?? "");
  const [isEditingName, setIsEditingName] = useState(false);
  const [editMiles, setEditMiles] = useState<number | null>(task?.interval_miles ?? null);
  const [editMonths, setEditMonths] = useState<number | null>(task?.interval_months ?? null);
  const [showIntervalEditor, setShowIntervalEditor] = useState(false);
  const [useCustomMiles, setUseCustomMiles] = useState(false);
  const [useCustomMonths, setUseCustomMonths] = useState(false);
  const [changeMethod, setChangeMethod] = useState<"preset" | "custom">("preset");
  const [customMilesInput, setCustomMilesInput] = useState(String(task?.interval_miles ?? ""));
  const [customMonthsInput, setCustomMonthsInput] = useState(String(task?.interval_months ?? ""));
  const nameInputRef = useRef<any>(null);

  useEffect(() => {
    if (task) {
      setEditName(task.name ?? "");
      setIsEditingName(false);
      setEditMiles(task.interval_miles ?? null);
      setEditMonths(task.interval_months ?? null);
      setShowIntervalEditor(false);
      setUseCustomMiles(false);
      setUseCustomMonths(false);
      setCustomMilesInput(String(task.interval_miles ?? ""));
      setCustomMonthsInput(String(task.interval_months ?? ""));
      setChangeMethod("preset");
    }
  }, [task?.id]);

  if (!task) return null;

  const isOilChange = /oil.*change|oil.*filter|engine.*oil/i.test(task.name ?? "");
  const hasMiles = task.interval_miles != null;

  const milesPresets: number[] = isOilChange
    ? [3000, 5000, 7500, 10000]
    : (() => {
        const cur = task.interval_miles;
        if (cur == null) return [1000, 3000, 5000, 10000];
        const round = (n: number) => Math.max(500, Math.round(n / 500) * 500);
        return Array.from(new Set([round(cur * 0.75), cur, round(cur * 1.25)])).filter((p): p is number => typeof p === "number" && p > 0);
      })();

  const monthsPresets = [3, 6, 12, 24];

  const intervalText = (() => {
    const parts: string[] = [];
    if (editMiles != null) parts.push(`${editMiles.toLocaleString()} mi`);
    if (editMonths != null) parts.push(`${editMonths} mo`);
    return parts.length ? `Every ${parts.join(" · ")}` : "No interval set";
  })();

  function handleMilesPreset(val: number) {
    setEditMiles(val);
    setCustomMilesInput(String(val));
    setUseCustomMiles(false);
    setChangeMethod("preset");
  }

  function handleMonthsPreset(val: number) {
    setEditMonths(val);
    setCustomMonthsInput(String(val));
    setUseCustomMonths(false);
    setChangeMethod("preset");
  }

  function handleCustomMilesChange(text: string) {
    setCustomMilesInput(text);
    const n = parseInt(text.replace(/,/g, ""), 10);
    if (!isNaN(n) && n > 0) setEditMiles(n);
  }

  function handleCustomMonthsChange(text: string) {
    setCustomMonthsInput(text);
    const n = parseInt(text, 10);
    if (!isNaN(n) && n > 0) setEditMonths(n);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.sheetOverlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <View style={[styles.sheetContainer, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.sheetHandle} />

          {/* Task name — tappable to edit */}
          {isEditingName ? (
            <TextInput
              ref={nameInputRef}
              style={[styles.sheetTitle, { borderBottomWidth: 1, borderBottomColor: Colors.accent, paddingBottom: 4, marginBottom: 20 }]}
              value={editName}
              onChangeText={setEditName}
              onBlur={() => setIsEditingName(false)}
              returnKeyType="done"
              onSubmitEditing={() => setIsEditingName(false)}
              autoFocus
            />
          ) : (
            <Pressable
              onPress={() => { setIsEditingName(true); setTimeout(() => nameInputRef.current?.focus(), 50); }}
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 20 }}
            >
              <Text style={[styles.sheetTitle, { marginBottom: 0, flex: 1, textAlign: "center" }]} numberOfLines={2}>{editName}</Text>
              <Ionicons name="pencil-outline" size={14} color={Colors.textTertiary} />
            </Pressable>
          )}

          <ScrollView style={styles.sheetScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={[styles.sheetFields, { paddingBottom: 8 }]}>

              {/* Interval row — tappable to expand editor */}
              <Pressable
                style={({ pressed }) => [{
                  flexDirection: "row" as const, alignItems: "center" as const,
                  justifyContent: "space-between" as const,
                  backgroundColor: Colors.surface, borderRadius: 12, padding: 14,
                  borderWidth: 1, borderColor: showIntervalEditor ? Colors.accent : Colors.border,
                  opacity: pressed ? 0.8 : 1,
                }]}
                onPress={() => setShowIntervalEditor(v => !v)}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name="time-outline" size={18} color={Colors.textSecondary} />
                  <Text style={{ fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.text }}>{intervalText}</Text>
                </View>
                <Ionicons name={showIntervalEditor ? "chevron-up" : "chevron-down"} size={16} color={Colors.textTertiary} />
              </Pressable>

              {/* Interval editor */}
              {showIntervalEditor && (
                <View style={{ gap: 16 }}>
                  {/* Miles presets */}
                  {hasMiles && (
                    <View style={{ gap: 8 }}>
                      <Text style={styles.sheetFieldLabel}>Miles</Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                        {milesPresets.map(val => (
                          <Pressable
                            key={val}
                            style={({ pressed }) => [{
                              paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                              borderWidth: 1, opacity: pressed ? 0.8 : 1,
                              borderColor: editMiles === val && !useCustomMiles ? Colors.accent : Colors.border,
                              backgroundColor: editMiles === val && !useCustomMiles ? Colors.accentMuted : Colors.surface,
                            }]}
                            onPress={() => handleMilesPreset(val)}
                          >
                            <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium",
                              color: editMiles === val && !useCustomMiles ? Colors.accent : Colors.textSecondary }}>
                              {val.toLocaleString()}
                            </Text>
                          </Pressable>
                        ))}
                        <Pressable
                          style={({ pressed }) => [{
                            paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                            borderWidth: 1, opacity: pressed ? 0.8 : 1,
                            borderColor: useCustomMiles ? Colors.accent : Colors.border,
                            backgroundColor: useCustomMiles ? Colors.accentMuted : Colors.surface,
                          }]}
                          onPress={() => { setUseCustomMiles(true); setChangeMethod("custom"); }}
                        >
                          <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium",
                            color: useCustomMiles ? Colors.accent : Colors.textSecondary }}>Custom</Text>
                        </Pressable>
                      </View>
                      {useCustomMiles && (
                        <TextInput
                          style={styles.sheetInput}
                          value={customMilesInput}
                          onChangeText={handleCustomMilesChange}
                          placeholder="e.g. 6000"
                          placeholderTextColor={Colors.textTertiary}
                          keyboardType="numeric"
                          returnKeyType="done"
                        />
                      )}
                    </View>
                  )}

                  {/* Months presets */}
                  <View style={{ gap: 8 }}>
                    <Text style={styles.sheetFieldLabel}>Months</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {monthsPresets.map(val => (
                        <Pressable
                          key={val}
                          style={({ pressed }) => [{
                            paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                            borderWidth: 1, opacity: pressed ? 0.8 : 1,
                            borderColor: editMonths === val && !useCustomMonths ? Colors.accent : Colors.border,
                            backgroundColor: editMonths === val && !useCustomMonths ? Colors.accentMuted : Colors.surface,
                          }]}
                          onPress={() => handleMonthsPreset(val)}
                        >
                          <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium",
                            color: editMonths === val && !useCustomMonths ? Colors.accent : Colors.textSecondary }}>
                            {val} mo
                          </Text>
                        </Pressable>
                      ))}
                      <Pressable
                        style={({ pressed }) => [{
                          paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                          borderWidth: 1, opacity: pressed ? 0.8 : 1,
                          borderColor: useCustomMonths ? Colors.accent : Colors.border,
                          backgroundColor: useCustomMonths ? Colors.accentMuted : Colors.surface,
                        }]}
                        onPress={() => { setUseCustomMonths(true); setChangeMethod("custom"); }}
                      >
                        <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium",
                          color: useCustomMonths ? Colors.accent : Colors.textSecondary }}>Custom</Text>
                      </Pressable>
                    </View>
                    {useCustomMonths && (
                      <TextInput
                        style={styles.sheetInput}
                        value={customMonthsInput}
                        onChangeText={handleCustomMonthsChange}
                        placeholder="e.g. 8"
                        placeholderTextColor={Colors.textTertiary}
                        keyboardType="numeric"
                        returnKeyType="done"
                      />
                    )}
                  </View>
                </View>
              )}

              {/* Mark as Done */}
              {task.status !== "completed" && (
                <Pressable
                  style={({ pressed }) => [{
                    flexDirection: "row" as const, alignItems: "center" as const,
                    justifyContent: "center" as const, gap: 8,
                    backgroundColor: Colors.surface, borderRadius: 12, paddingVertical: 13,
                    borderWidth: 1, borderColor: Colors.border, opacity: pressed ? 0.8 : 1,
                  }]}
                  onPress={() => { onClose(); onMarkComplete(task); }}
                >
                  <Ionicons name="checkmark-circle-outline" size={18} color={Colors.good} />
                  <Text style={{ fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.good }}>Mark as Done</Text>
                </Pressable>
              )}

              {/* Delete Task */}
              <Pressable
                style={({ pressed }) => [{
                  flexDirection: "row" as const, alignItems: "center" as const,
                  justifyContent: "center" as const, gap: 8,
                  borderRadius: 12, paddingVertical: 13, borderWidth: 1,
                  borderColor: Colors.overdue + "40", backgroundColor: Colors.overdueMuted,
                  opacity: pressed ? 0.8 : 1,
                }]}
                onPress={() => onDelete(task)}
              >
                <Ionicons name="trash-outline" size={16} color={Colors.overdue} />
                <Text style={{ fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.overdue }}>Delete Task</Text>
              </Pressable>
            </View>
          </ScrollView>

          <View style={[styles.sheetActions, { marginTop: 12 }]}>
            <Pressable
              style={({ pressed }) => [styles.sheetCancelBtn, { opacity: pressed ? 0.8 : 1 }]}
              onPress={onClose}
            >
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.sheetSaveBtn, { opacity: pressed ? 0.8 : 1 }]}
              onPress={() => { onSave(task, editName.trim() || task.name, editMiles, editMonths, changeMethod); onClose(); }}
            >
              <Text style={styles.sheetSaveText}>Save Changes</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
  insets: { bottom: number };
}) {
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
                <Text style={styles.sheetFieldLabel}>{tracksHours ? "Hours at Service" : "Mileage at Service"}</Text>
                <TextInput
                  style={styles.sheetInput}
                  value={mileage}
                  onChangeText={onMileageChange}
                  keyboardType={tracksHours ? "decimal-pad" : "number-pad"}
                  placeholder={tracksHours ? "e.g. 1,250.5" : "e.g. 52,000"}
                  placeholderTextColor={Colors.textTertiary}
                  returnKeyType="done"
                />
              </View>
            )}

            <View style={styles.sheetField}>
              <DatePicker
                label="Date Completed"
                value={date}
                onChange={onDateChange}
                maximumDate={new Date()}
              />
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
      <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textTertiary, textAlign: "center", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, lineHeight: 16 }}>
        Photos stored here are for personal reference only. Check your local laws regarding acceptable identification documents.
      </Text>
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
