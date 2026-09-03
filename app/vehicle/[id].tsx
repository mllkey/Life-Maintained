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
import { Colors } from "@/constants/colors";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Divider } from "@/components/ui/Divider";
import { usePressScale } from "@/components/ui/usePressScale";
// Reanimated drives the one-shot reveal stagger; the RN Animated fade above owns a
// different node, so the two coexist (G3).
import Reanimated, { FadeIn, FadeInDown, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

const AnimatedPressable = Reanimated.createAnimatedComponent(Pressable);
import { Typography } from "@/constants/typography";
import { Radius } from "@/constants/radius";
import { supabase } from "@/lib/supabase";
import { completeVehicleTask, deleteVehicleCascade } from "@/lib/rpc";
import * as Haptics from "expo-haptics";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { parseISO, isBefore, addMonths, format, formatDistanceToNowStrict, differenceInDays } from "date-fns";
import { useAuth } from "@/context/AuthContext";
import { capture } from "@/lib/analytics";
import Paywall from "@/components/Paywall";
import { hasPersonalOrAbove } from "@/lib/subscription";
import { SaveToast } from "@/components/SaveToast";
import LoadErrorState from "@/components/LoadErrorState";
import DatePicker from "@/components/DatePicker";
import { HOURS_TRACKED_TYPES, MILEAGE_TRACKED_TYPES } from "@/lib/vehicleTypes";
import { formatShopAndDiy } from "@/lib/costFormat";
import {
  resolveTrackingMode,
  isHoursTracked,
  isMileageTracked,
  isTimeOnly,
  currentUsageValue,
  projectedMileage,
  projectedHours,
  formatUsageValue,
  taskNextDueUsage,
  taskLastCompletedUsage,
  formatIntervalUsage,
  type TrackingMode,
} from "@/lib/usageHelpers";
import Tooltip, { TOOLTIP_IDS } from "@/components/Tooltip";
import UpdateBanner from "@/components/UpdateBanner";
import { scheduleMaintenanceNotifications } from "@/lib/notificationScheduler";
import { useDeepLinkHighlight } from "@/lib/useDeepLinkHighlight";
import { HighlightBackdrop } from "@/components/HighlightBackdrop";
import { vehicleTaskCalibrationState, vehicleTaskHasCalibratableAxis } from "@/lib/calibration";
import { CalibrationEntryCard } from "@/components/CalibrationEntryCard";
import CalibrationSheet, { type CalibrationSheetHandle } from "@/components/CalibrationSheet";
import ReminderMoment, { type ReminderMomentHandle } from "@/components/ReminderMoment";

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
  // Uncalibrated estimates carry no urgency; the Confirm-history card owns them.
  if (vehicleTaskCalibrationState(task) === "estimated") return "upcoming";
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

// Human "Overdue by ..." line for the reminder-fired moment. Usage first
// (matches the app's usage-forward bias for vehicles), then date.
/** GAP-7 reveal is offered while the vehicle is this fresh at mount. */
const REVEAL_FRESHNESS_MS = 180000;
/** Rows begin entering this long after the headline starts, so the title lands first. */
const REVEAL_ROWS_DELAY_MS = 260;

function buildOverdueLine(task: any, vehicle: any): string {
  const cur = currentUsageValue(vehicle);
  const due = taskNextDueUsage(task, vehicle);
  if (cur != null && due != null && cur >= due) {
    const over = Math.max(0, Math.round(cur - due));
    const unit = isHoursTracked(vehicle) ? "hours" : "miles";
    return `Overdue by ${over.toLocaleString()} ${unit}`;
  }
  if (task.next_due_date) {
    const days = differenceInDays(new Date(), parseISO(task.next_due_date));
    if (days > 1) return `Overdue by ${days} days`;
    if (days === 1) return "Overdue by 1 day";
    if (days === 0) return "Due today";
  }
  return "Needs attention now";
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  engine:     { bg: Colors.card,           text: Colors.textSecondary },
  brakes:     { bg: Colors.card,           text: Colors.textSecondary },
  fluids:     { bg: Colors.card,           text: Colors.textSecondary },
  electrical: { bg: Colors.card,           text: Colors.textSecondary },
  tires:      { bg: Colors.card,           text: Colors.textSecondary },
  body:       { bg: Colors.card,           text: Colors.textSecondary },
  drivetrain: { bg: Colors.card,           text: Colors.textSecondary },
};

const STATUS_BORDER: Record<string, string> = {
  upcoming:        Colors.border,
  due_soon:        Colors.dueSoon,
  overdue:         Colors.overdue,
  needs_attention: Colors.needsAttention,
  completed:       Colors.good,
};

export default function VehicleDetailScreen() {
  const { id, taskId, reminder, rid } = useLocalSearchParams<{ id: string; taskId?: string; reminder?: string; rid?: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { profile, user } = useAuth();
  const estimatesUnlocked = hasPersonalOrAbove(profile);
  const [activeTab, setActiveTab] = useState<"schedule" | "wallet" | "history">("schedule");
  const [isExporting, setIsExporting] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [isDeletingVehicle, setIsDeletingVehicle] = useState(false);
  const [scheduleRefreshing, setScheduleRefreshing] = useState(false);
  const [actionNeededExpanded, setActionNeededExpanded] = useState(true);
  const [upcomingExpanded, setUpcomingExpanded] = useState(true);
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [generatingSchedule, setGeneratingSchedule] = useState(false);
  const [pollEpoch, setPollEpoch] = useState(0);
  const [refreshingSchedule, setRefreshingSchedule] = useState(false);
  const [scheduleToast, setScheduleToast] = useState("");
  const [showScheduleToast, setShowScheduleToast] = useState(false);
  const [scheduleToastIsError, setScheduleToastIsError] = useState(false);
  const [scheduleToastSubtitle, setScheduleToastSubtitle] = useState<string | undefined>(undefined);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [showDifficultyInfo, setShowDifficultyInfo] = useState(false);
  const [scheduleInsight, setScheduleInsight] = useState<string | null>(null);
  const [insightTaskName, setInsightTaskName] = useState<string | null>(null);
  const [highlightedTask, setHighlightedTask] = useState<string | null>(null);
  const { highlightedId: highlightedTaskId, scrollProps: highlightScrollProps, registerRow: registerTaskRow, dismissImmediately: dismissHighlight } = useDeepLinkHighlight(taskId);

  const [reminderMoment, setReminderMoment] = useState<{ task: any; title: string; statusLine: string; costLine: string | null } | null>(null);
  const reminderRef = useRef<ReminderMomentHandle>(null);
  const calibrationRef = useRef<CalibrationSheetHandle>(null);
  const reminderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reminderFiredRef = useRef<string | null>(null);
  const costEstimatesRef = useRef<Record<string, any> | undefined>(undefined);

  // Deep-link: switch tabs + expand sections. Highlight + scroll handled by hook.
  useEffect(() => {
    if (!taskId) return;
    setActiveTab("schedule");
    setActionNeededExpanded(true);
    setUpcomingExpanded(true);
    setCompletedExpanded(true);
  }, [taskId]);

  // Blur cleanup — when this screen loses focus, dismiss the highlight.
  useFocusEffect(
    useCallback(() => {
      return () => {
        dismissHighlight();
        if (reminderTimerRef.current) { clearTimeout(reminderTimerRef.current); reminderTimerRef.current = null; }
        reminderRef.current?.dismiss();
      };
    }, [dismissHighlight]),
  );
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

  const { data: vehicle, isLoading: loadingVehicle, isError: vehicleError, fetchStatus: vehicleFetchStatus, refetch: refetchVehicle } = useQuery({
    queryKey: ["vehicle", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("vehicles").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
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
    queryKey: ["repair_costs", id, vehicle?.make, scheduleTasks?.length ?? 0, estimatesUnlocked],
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
    enabled: !!vehicle?.make && !!scheduleTasks?.length && estimatesUnlocked,
    staleTime: 1000 * 60 * 60, // 1 hour
  });

  costEstimatesRef.current = costEstimates;

  const { data: logs, refetch: refetchLogs } = useQuery({
    queryKey: ["maintenance_logs", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maintenance_logs")
        .select("*")
        .eq("vehicle_id", id)
        .order("service_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  function handleVehicleRetry() { refetchVehicle(); refetchSchedule(); refetchLogs(); }

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

  const estimatedTasks = useMemo(
    () =>
      (scheduleTasks ?? []).filter(
        (t: any) =>
          vehicleTaskCalibrationState(t) === "estimated" &&
          vehicleTaskHasCalibratableAxis(t, vehicle, vehicleMode),
      ),
    [scheduleTasks, vehicle, vehicleMode],
  );

  // Reminder-fired moment: when opened from a maintenance reminder
  // (reminder === "1") and the tapped task is genuinely overdue, surface a
  // calm "flagged for you" sheet after the scroll-to-highlight settles.
  // Fires once per tapped task; never for due-soon/upcoming reminders.
  useEffect(() => {
    if (reminder !== "1" || !taskId) return;
    const reminderFireKey = rid ?? taskId;
    if (!vehicle) return;
    if (reminderFiredRef.current === reminderFireKey) return;
    if (!processedScheduleTasks || processedScheduleTasks.length === 0) return;
    const task = processedScheduleTasks.find((t: any) => t.id === taskId);
    if (!task) return;
    if (task.status !== "overdue" && task.status !== "needs_attention") {
      reminderFiredRef.current = reminderFireKey;
      return;
    }
    reminderFiredRef.current = reminderFireKey;
    const vName = vehicle ? (vehicle.nickname ?? `${vehicle.year} ${vehicle.make} ${vehicle.model}`) : "your vehicle";
    const est = costEstimatesRef.current?.[String(task.name ?? "").toLowerCase().trim()];
    const costLine = est
      ? formatShopAndDiy(
          est.shop_low != null ? Number(est.shop_low) : null,
          est.shop_high != null ? Number(est.shop_high) : null,
          est.diy_low != null ? Number(est.diy_low) : null,
          est.diy_high != null ? Number(est.diy_high) : null,
        )
      : null;
    setReminderMoment({
      task,
      title: String(task.name ?? "Maintenance"),
      statusLine: `${buildOverdueLine(task, vehicle)} · ${vName}`,
      costLine,
    });
    // Intentionally NO cleanup: the timer must survive dependency-driven
    // re-renders (the fired-guard prevents re-scheduling). It is cleared on
    // blur and unmount.
    reminderTimerRef.current = setTimeout(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      reminderRef.current?.present();
    }, 700);
  }, [reminder, rid, taskId, processedScheduleTasks, vehicle]);

  const scheduleOpacity = useRef(new Animated.Value(0)).current;

  // ---- GAP 7: the plan-ready reveal -------------------------------------------------
  // H1: a real user reads the plan-reveal copy before tapping through, and the building
  // scene alone is ~10s, so the window has to outlast an unhurried pass.
  // H2: the headline lands first, then the plan assembles beneath it — without the delay
  // the stagger dissipates under the loading skeleton.
  // One-shot per mount session. Armed BEFORE the first render that mounts reveal-eligible
  // rows, so the stagger is never missed. Never fires on tab switches or refetches.
  const mountStartedAt = useRef(Date.now()).current;
  const reduceMotion = useReducedMotion();
  const revealDecided = useRef(false);
  const revealSnapshot = useRef<Set<string> | null>(null);
  const revealConsumed = useRef<Set<string>>(new Set());
  const generatedOnScreen = useRef(false);
  const [revealActive, setRevealActive] = useState(false);
  const revealHeadlineOpacity = useSharedValue(0);



  useFocusEffect(
    useCallback(() => {
      refetchSchedule();
    }, [refetchSchedule]),
  );

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
  }, [loadingSchedule, scheduleTasks?.length, user, id, refetchSchedule, pollEpoch]);

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
      // This is also the reveal's success haptic (G2). It already fires on exactly the
      // first-non-empty transition, so the reveal reuses it rather than stacking a second.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    prevScheduleCountRef.current = processedScheduleTasks.length;
  }, [processedScheduleTasks.length]);

  const completedTasks = useMemo(
    () => processedScheduleTasks.filter(t => t.status === "completed").slice(0, 10),
    [processedScheduleTasks],
  );

  // Freshness is computed exactly once, and only after created_at has resolved. The
  // screen renders a skeleton until the vehicle query settles, so this decision always
  // lands before the first render that mounts a task row.
  const createdAt = vehicle?.created_at ?? null;
  const vehicleResolved = !!vehicle;
  if (!revealDecided.current && vehicleResolved) {
    const fresh = createdAt != null
      && Math.abs(mountStartedAt - new Date(createdAt).getTime()) <= REVEAL_FRESHNESS_MS;
    // (a) the vehicle is fresh and its schedule has arrived, or (b) generation just
    // completed on-screen — either arms the reveal for the rows about to mount.
    if ((fresh || generatedOnScreen.current) && processedScheduleTasks.length > 0) {
      revealDecided.current = true;
      revealSnapshot.current = new Set(
        revealSnapshotIds(actionNeededTasks, upcomingTasks, completedTasks,
          actionNeededExpanded, upcomingExpanded, completedExpanded),
      );
    } else if (!fresh && !generatedOnScreen.current) {
      revealDecided.current = true;
      revealSnapshot.current = new Set();
    }
  }
  const revealArmed = (revealSnapshot.current?.size ?? 0) > 0;
  // No extra row gate is needed: the screen renders a skeleton until the vehicle query
  // resolves (see `isLoading` below), so no task row can commit before created_at is
  // known and freshness has been decided in this same render pass.

  React.useEffect(() => {
    if (revealArmed && !revealActive) {
      setRevealActive(true);
      revealHeadlineOpacity.value = withTiming(1, { duration: 220 });
    }
  }, [revealArmed, revealActive, revealHeadlineOpacity]);

  const revealHeadlineStyle = useAnimatedStyle(() => ({ opacity: revealHeadlineOpacity.value }));

  /** One-shot per row id: returns the entering animation only on that row's first
   *  committed mount, then marks it consumed for the rest of the mount session. */
  const revealEnteringFor = useCallback((taskId: string, index: number) => {
    if (!revealSnapshot.current?.has(taskId)) return undefined;
    if (revealConsumed.current.has(taskId)) return undefined;
    revealConsumed.current.add(taskId);
    if (reduceMotion) return FadeIn.duration(180);
    return FadeInDown.duration(180)
      .delay(REVEAL_ROWS_DELAY_MS + index * 40)
      .withInitialValues({ opacity: 0, transform: [{ translateY: 6 }] });
  }, [reduceMotion]);

  async function generateSchedule() {
    if (!vehicle || !user) return;
    setGeneratingSchedule(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
          showToast("Couldn't build the schedule. Try again in a moment.", true);
          return;
        }
        // 409: another invocation holds the generation lock — the schedule IS
        // being built. Keep the building state, restart the 60s window, and let
        // the interval deliver the rows. No success claim here.
        pollStartRef.current = null;
        setPollEpoch(v => v + 1);
        showToast("Your schedule is already being built — it'll appear in a few seconds.");
        return;
      }
      pollStartRef.current = null;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      // GAP 7 trigger (b): generation finished while the user is on this screen. Arm
      // before the refetch resolves so the reveal is decided ahead of the rows' mount.
      generatedOnScreen.current = true;
      revealDecided.current = false;
      const fresh = await refetchSchedule();
      if ((fresh.data?.length ?? 0) > 0) {
        showToast("Schedule generated!");
      } else {
        // 200 but rows not visible yet — disarm the reveal, restart the window,
        // and let the interval carry it home instead of claiming an absent plan.
        generatedOnScreen.current = false;
        pollStartRef.current = null;
        setPollEpoch(v => v + 1);
        showToast("Almost ready — your schedule will appear in a few seconds.");
      }
    } catch {
      showToast("Couldn't build the schedule. Try again in a moment.", true);
    } finally {
      setGeneratingSchedule(false);
    }
  }

  async function refreshSchedule() {
    if (!vehicle || !user) return;
    setRefreshingSchedule(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
        const httpStatus = (error as { context?: { status?: number } })?.context?.status;
        if (httpStatus === 409) {
          await refetchSchedule();
          showToast("Schedule is already updating, check back in a moment.");
          return;
        }
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
      Promise.resolve(supabase.from("interval_corrections").insert({
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
      })).then(() => {}).catch(() => {});
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

      if (typeof id === "string" && id.length > 0) {
        capture("task_completed", {
          task_id: task.id,
          vehicle_id: id,
          task_name: rpcResult?.task_name ?? task.name,
        });
      }

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
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength === 0) throw new Error("Empty image file");

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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast("Photo didn't upload", true, "Check your connection and try again.");
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast("Photo didn't remove", true, "Give it another shot.");
    }
  }

  function compareLogsAsc(a: any, b: any) {
    const left = a?.service_date ? String(a.service_date) : "";
    const right = b?.service_date ? String(b.service_date) : "";
    if (left === right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    return left < right ? -1 : 1;
  }

  function buildCsv(logsData: any[]) {
    const csvField = (value: any): string => {
      if (value == null) return "";
      const text = String(value);
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const header = "service_date,service_name,mileage,hours,cost_usd,provider_name,provider_contact,did_it_myself,notes,receipt_on_file";
    const records = [...logsData].sort(compareLogsAsc).map(log => [
      csvField(log?.service_date == null ? null : String(log.service_date).slice(0, 10)),
      csvField(log?.service_name),
      csvField(log?.mileage),
      csvField(log?.hours),
      csvField(log?.cost),
      csvField(log?.provider_name),
      csvField(log?.provider_contact),
      csvField(log?.did_it_myself == null ? null : log.did_it_myself === true ? "true" : "false"),
      csvField(log?.notes),
      csvField(log?.receipt_url ? "true" : "false"),
    ].join(","));
    return [header, ...records].map(record => `${record}\r\n`).join("");
  }

  function buildHtml(logsData: any[], vehicleData: any, receiptUrlByLogId: Map<string, string>) {
    const logoDataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAAAXNSR0IArs4c6QAAAHhlWElmTU0AKgAAAAgABAEaAAUAAAABAAAAPgEbAAUAAAABAAAARgEoAAMAAAABAAIAAIdpAAQAAAABAAAATgAAAAAAAAEsAAAAAQAAASwAAAABAAOgAQADAAAAAQABAACgAgAEAAAAAQAAAICgAwAEAAAAAQAAAIAAAAAAHeJAawAAAAlwSFlzAAAuIwAALiMBeKU/dgAAEYZJREFUeAHtXXuQHEUZ7+6Z2dsLEB7hInnc5UESqAJRDAUSSMiDBJBnSIL/6x/+YRUlKmjwUWuJYgGlVVpaapWWVVZpmYQDooAEsA5CwiMgKKIIBzlyx+VFTIDkbu92ptvfN3cne3t7t9Mzszs963RVcjvT769//X3d3/d1D2NZyCiQUSCjQEaBjAIZBTIKZBTIKJBRIKNARoGMAhkF/l8owMN0tP2yez7LRe4cJofDZA+QRzCuvBOecn7W9+yXBwNkSEWSA9+af4ni1orjR/mPF/+ke2is0XMvvWuOELnPjz1r/xU2Y15p777dX/utbl7k1A9csc8J4axT+lkD5iBcOky4xVfw48mAmYxPJjnfzJhaN2Oa+iUa+z8AKOG0Y0J9J2wHOAAgpbcL+RsDAFRUVN4wU7IUts0183ErxzjnG5CwKQBw+M55s1zGVyrFjqlWMW7ucMmkUhG4qZLAlSrWJGqVBKLKOyNeKekyxdQ1bSt/erIRDYrYCNe2rj4pJ05lnHkRi4o1u7EAAHsBB7Dn54cGL4u1xwkVhim/ady0T6gdldWaCwBqKbcAArmxstFpe95fmD8fq5rLhz3zIGA0AJRyaayvWnTJj6enbdDHtVfya/MOP0WaN/7MaAD4YkDY7cOiuGIcQVP0gEUfNk1i08jgm4cAswHgDzSayBntBlIZ9n9n/jmcq0tMZP9EUOMBMCoG1nVcfvfpaUQAl9b1rTbPgxMYGYwHwKgYmM09e6WRFJyiUWrLJgtb2Y0utummBvMB4FOOM8VV6sRA/6svX2AJfmHJwNX/GCBTAQClfN3JlXMu/v6MsYan4q+QN7VYzDGU+/skTAUARsXAxyzLXp2KgUcjXyucl4Mq88aSweyfaJkOAPijTgYilRql0Gml4kWOYOe7BrP/VAHAFwOcrz572b0zfTwY/h+31YacxbEINDukhwOQbUA4Z7qKXWk2SRnr/eHcVmz7risZZfapTrX0AGC0/VKYLwbsYy2fdiy22DVR91uBg1QBgJRC0KuunLf8R7Mq+mHUo1LqlpyA/s+oVlVvTKoAAKcHEgOnKzm8rnp3kn97pLBouuLsM8MpYP9EraQAEI08ihu7GxiWcjkWfx1pYP+JAIDDxg/16B5U/j5ZeXQDeQohrFiw7L55unkbkR5if6Od1LQK0cHGN5XD45fzv2FP/yIXVogm+2JguuTe9SEy1zVL3+ZzZ3DOrta2/ClPfybE1JPGAwCzHk6QA1ggdYaXQLS84huWLv2FExMdYinGsofWtNj8LE9T+2fbyXUjAQAwJgV3PNv+I7yK4fOvD34lPVoPXnw4f3RJLCMXVyFcbBT63WGul9x+MREAwLbn9D/9lV78fSG8GMhNA5KMUQodKsw/SzG5ehiaqjSFRACAVaA/T7AYjCAGwGc5uwHEDjHn4h8iT1pX5W0xw3DV/4SOJwOA0WYABw/jQMSJMGNIYgDh0+3L7lk4oVcJvCDlTwLVRq4yUQD07r7jLXCD3VHEAJaU10amQsQC+r+xYB740HLt1X/EeuPInigARjuwLQwHGMkLAxFTN2NLmagYkBb/TKuhbt+1QJI4AHBk6lHsBkIqhbAbYPziBZfdk9hugLTT0GaMun3XIrd58YkDgHYDIMtOOuGqH4j6Tis2Udfp540nB7l9Y91/qcl+f1P1NHEA+I3jCmIgZICfAAYAYqCQSF/I7Xuaw/PJ7eRD0m00WyJEq2wyzsbvgBj4D0x9lVE1n/3dABdLO5affG7NxDEn2LKJgfvL9Sa7fdfqsj7Fa5UYIv6dnbftxzaqiwxF+gFiQDgtzJWkE2houOLcBedjF3JRKeL0txQnC5ev2GhoB1CZEQDwO83F1tCdpwsSOFvPNm0Jg6DQ1eLGj/U49OlgIRgtJOg6aAwASlbpSYiBQ+HEADyFmLhwXm/PJ6KNRPDc6hdLHcDuJtPdvmv1yBgAHNh552Hs5p8IJwagCWCMfHBztTocV3xf35FPwe6v7fYNvYU4NigT1VuU08AYAFCj4EaH3YA+Px0Bjfz7jOJpL5V3rp6/0dYNLZpu38hDeotDxdZWY24+MwoAirld8Pjp1xYDcCzBlLr/pZe+UL9bq8rQ1Hvb3FYs/m7QZf84KELtfPC8wmsRboQqa0gMP40CwL5nNh9Fn3bgbiCNrmFWydKQ4vIBjUyRktqn2peA/S/ROfWDyc+KJQV9kXowUuUxZzYKANQ3zKxtbOQwaKCu+oYkJffs21X8V6AMcSRSnE79aLl9O/AUgfn7xTmv7/1HHE2IqwzjAOB4LTul8vYFFwN+F7CFLGBRXv9w+I5zTlGKX6fr9k2OopD/W/nW7Jq4KUep+/lbP8DUejSYGMCsUqXj3BV/nLLQGCPdaaXljsXn67h9k5vYoKsG4Cv4pxibEktRxnEAv1fKFwM1twNkQFJS7nznhdv3xkKNAIVIqe/2DcDgKle2e+5db3cHqKKhSYwEwNB09ixOA78dRCeANcAfKil2sLBkIZ3QqXwf9fmdr3fgniJ1lS77Jw6AFcMW/KkJ6qht1M1vJAAO7rj9BBaDj/mW9sl6RHtqGJDEsHysMomn3NsHcUKn8n3UZydnr85bYraOE6/P/kvqmBTWo1Hrr0d+IwFAHVWcPzjVbsBfIyj1RM+eOw6UE+ZNmvmKbYBRIHZXMUBuk9CkGHYLNO+75ha6+8rbacpvze40rtmDTivEgNvDJzURkxWQTWD/06R3xTRHtCF23YF7LzgprhYfvHPBx1DmGl23b+L5wuIT2hlXu6KWYywADnd98TgEJ8RAFaUQRh4aw3f5idxfKgmA+baJphzO5y/03j9+aWV82GfPYmvzNj9Tx+3bAnWHXHVIMuuJsPXWO5+xAKCOY+VcVQyMbBHVIz2v3HasnED9hSVnYu2wdgijBLUr6YjWl8dH+c2FALD0gs/+Odsxu/DGe3o5G5faaADk5cBu7AZ6K5VCeIfrd8WWSjKBK6wdO5tHK3XY6a85VDjv5Mp0us/9hYUdKGylrts3eQphEWgs+yc6GA2A7ucLH0CGPl6uFPK3hsrrlp5Fn0gZF0bY/8grUtTYgi9w5Yno3xuQ/Bo4fkzXcfxB3QyA2YcP3zw9rpGGPRgNAKIVl7QbKNPygq9Dp7698mNS731jyRyAZVX5LM2RfxDncBiNGtQGncGn2qhuaDQfmVHo/iBq7fXMbzwARN7eCXXv/jExADbvWWKi+9iw8K6Fd+5p5QM1Igb41VGUQr3fXLgYKofLdNy+wYlo9ivcYTBBTNVzMMOUbTwAerpoocefJNY/wv7lqzMGp/+1orNY+6mN5YNP8SQGsBDrGGby8or0gR+5UDfgtu9plWVPVYCNvT+uiHtDfeg9N1U6E+KMBwARCTMKNnQweHL8ULyz0vGjt3D22UizrNosJSscBi/URdOqQGs4frPuhQ/k+IGGbm//UZ8xnj+TgS0VACjlxFNMuoeh+nWV8DorO2NLeSPO5p1UbZaSGIAsXre3MP+0yny1nvu8heeBQEuHqxU8SWZi/0MemI9g4Q+7TFJ2PV6nAgD9XV99D8aUZ2FTe3Hfrq//s5wQNEtphk92LwPp7SEG5uZcvqI8X5DfIM56AKtFx+2bLH+48ePVg/1nvBykjqTTpAIARCTM4m0Ok7/CT9Ku/i/0sQXnC8GXVmP/Y4lIIwflodZugNy+IXu0T/2QyBFcPHDRL19qiH/iWB/D/k0NAPbmBn/f7Qz9prKjQvKbMUtzU81S2hri3MDaY3eTOTdYONB39JMAzsenAlZlSeT3N1hSQwBbw/wTK9ug+1xF0a5bRIPSdxXcypr8O/nl4E21LmWmRRz25bMHBp2VKCPQ4ChwjFa4fQ9oyH9S/UL3v+cs9tY4MVXZbpOeU8MBqhFtBjsR+HAGiQFIj0C7AXL7hqDRPvWD8ScBdT8v0Dm/dIRUA0AqsSno4YxRDeGavs1zan52xnf7ttg5Om7fvuOHy45jm9Iw/8Q4IJZaAPQXZk/DbLt+OOBcIzFAhiLLyq2qRTiprA26t30T+8c6ZFfHXd1v1SrfpPjUAkC5+WWw+S/SnaVKTG0bOFRoO5lLdW25TSHIgNECEDaLVOz9y/uTWgBwwW+BxY3IHjiMevOs2b95UdtkmYbcU1Y4NlkRJ0sx8T3Jfqz+jzqW+8jEWLPfpBIAvYW5Z+BWTu1ZSt48EAMzWYs3qRiAz5/2bd8ADI3yX9oKvf1mD/fE1qUSAPZQHpMu1HUipNxn0hNVdwPk9o3odbrsn3QQOC2UOvZPcEglAGbd3X0Y2/PHaeGlG0gMQK286kDh7JmVeR3buQJlztEx/oz6/R1QrvN4ZXlpeE4lAIiwNhfbiKXrhlEx0OZ5bPWEvFD+jOgLJsRM+oJAiJXIn+fe/fqRSRMZHJFaALQI9ylo3d7VHTAaCxIDkPXjHEbpYw9g5Gt12b+/WISdwuAxnrJpqQXA6YWeY0Kxx0KJAbAB3Eq2qrtMDFiOu3rMoXRKipVFkt8fbAV73y86T5e9TtXP1AKAqKwsvlXnlO7YyIwqhdrynlw59k4ybwNxBp3g+/0x9adz7/n3hzr5TEobEgDhVuBjHcfsI3fNyMFm+WfgIrKXZqJuoCw25/7dgvu/v6gNknycQ2mt8qhGOIqAlVj310prcnxIAMgIVkQyzbII+T8i58zCa8eVEA/73r8fvQ70i2Q9dD1rfJXygHcF6Qd0Vv/k9+d67F9Fy30+UIWGJgoJAHN6I5Tb6c9EzSbRYOdgG+AsvxKm3+t0mciI3x9/cEGhp6hZtVHJUw8AJUrPYyX+Js1I7UAKHMm+BH+h1XScLGigmoZc5rpcBfItCFpuEulSD4DZhf4BWAUfzoXoCYkBzPy1GNB2nEMMHMjvD27/L7ezjlcCZzI0YQiyGdgTwToxmBpD+FEfyOEn+NwfyUd+f8gDx4+uCV5KH5Wcjl9NAYATZ4g9tCCjmVnv4Pv9uaqI7wRsr3ddjSi/KQCw+NbuIfDyh/yFWZ2pRoonnPl6btZ333y9zlU1pPimAIBPKSzIaGGm5yGgT2PaLQACW1GPruTQr6wBOZoGALP6T/+bq+SrdCNnvQIVjeteP2SWTJ3jx2Q0aRoAcBzEwKUgD9ECrV7BZ/+MPT2r0NNTrzoaXW4dydXoruCDAUI+VCyxUj3FgFTc+CPfOpRvKgC8xnr+gW+IvVIPMUAbjKIrj+Qsb4cOgU1P21QAWFVgLuz8nfUQA1Abw/GDPz6z0DPuXkLTB7hW+5oKANTZoSF3Oy5mLsYtBkhTCL+/pmL/RK+mA0BHy77XYaTdE8ZRhAhSLZC5ueix/tJwqatafJrfNR0A/HN5inXGqRTEARQ6nv7IvB/sO5rmwa7W9qYDAHXShnGI7uePSwzQ6WOLy6Zj/0SrpgRA23f9e/mfi0MMEPuH29lbamBgNxGs2UJTAoDUtPDW6oxDKTjqbbT9rPsOnmi2waf+NCUA/I4J9TCpbaOAgJTKcD3HKfR0nvohOtQKTQsAUtdiN7AzihggLyP4jPxz4Ahv2Acpaw1Y3PFNCwAiFETBNvJADRvIvIwyOhf/BObmJg1NDQDXG94BMXA0jBgg3JBdAdfMTbiXsJmwEA4Aikf49ClIi4u0G0HE9u/1vQuj/TPT84LhYw9a/05BHrIrmPahx7jpFs4/P7IzBNQqDQpQ4f686CoLnECrxlGu8TvTPvSo1YkAicMBIEDBpiRpv+ttct5oGgeOuOkaTgTE3YqsvMQokAEgMdKbUXEGADPGIbFWZABIjPRmVJwBwIxxSKwVGQASI70ZFWcAMGMcEmtFBoDESG9GxRkAzBiHxFoRVhOY51bON5XptpyLHLxrSy26+Zo5ve9xkCPbI81HPZU10YULGzT18mFoFAoAirNfS1naxaS+TcfvnlSV3/0L0/amySOkfBcg+DbdYYqLbLX75d92pORe7YxZhowCGQUyCmQUyCiQUSCjQEaBjAIZBTIKZBTIKJBR4P+KAv8FvafFT6bXUk8AAAAASUVORK5CYII=";
    const esc = (value: unknown): string =>
      String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    const dash = "—";
    const group = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const num = (value: any): string => {
      const parts = String(Number(value)).split(".");
      const whole = parts[0] ?? "";
      const negative = whole.startsWith("-");
      return `${negative ? "-" : ""}${group(negative ? whole.slice(1) : whole)}${parts[1] ? `.${parts[1]}` : ""}`;
    };
    const money = (value: any): string => {
      const amount = Number(value);
      const fixed = Math.abs(amount).toFixed(2).split(".");
      return `${amount < 0 ? "-" : ""}$${group(fixed[0] ?? "0")}.${fixed[1] ?? "00"}`;
    };
    const dayLabel = (value: any): string => {
      if (!value) return dash;
      const parsed = parseISO(String(value).slice(0, 10));
      return Number.isNaN(parsed.getTime()) ? dash : format(parsed, "MMM d, yyyy");
    };
    const monthLabel = (value: any): string => {
      if (!value) return dash;
      const parsed = parseISO(String(value).slice(0, 10));
      return Number.isNaN(parsed.getTime()) ? dash : format(parsed, "MMM yyyy");
    };

    const ordered = [...logsData].sort(compareLogsAsc);
    const tracksHrs = isHoursTracked(vehicleData);
    const usageHeader = tracksHrs ? "Hours" : "Mileage";
    const yearMakeModel = [vehicleData?.year, vehicleData?.make, vehicleData?.model].filter(Boolean).join(" ");
    const nickname = vehicleData?.nickname ? String(vehicleData.nickname) : "";
    const identity = nickname || yearMakeModel;
    const lastRecordedValue = tracksHrs ? vehicleData?.hours : vehicleData?.mileage;

    const costed = ordered.filter(log => log?.cost != null);
    const totalSpent = costed.reduce((sum, log) => sum + Number(log.cost), 0);
    const dated = ordered.filter(log => !!log?.service_date);
    const spanStart = dated.length > 0 ? monthLabel(dated[0]?.service_date) : dash;
    const spanEnd = dated.length > 0 ? monthLabel(dated[dated.length - 1]?.service_date) : dash;
    const receiptLogs = ordered.filter(log => !!log?.receipt_url);
    const appendixLogs = receiptLogs.slice(0, 30);
    const overflowCount = receiptLogs.length - appendixLogs.length;

    const rows = ordered.map(log => {
      const usageValue = tracksHrs ? log?.hours : log?.mileage;
      const signedUrl = receiptUrlByLogId.get(String(log?.id));
      const providerText = log?.provider_name != null && String(log.provider_name).length > 0 ? esc(log.provider_name) : dash;
      return `
      <tr>
        <td>${dayLabel(log?.service_date)}</td>
        <td>${usageValue != null ? esc(num(usageValue)) : dash}</td>
        <td>${esc(log?.service_name ?? "")}</td>
        <td>${log?.cost != null ? esc(money(log.cost)) : dash}</td>
        <td>${providerText}</td>
        <td>${signedUrl ? `<img class="thumb" src="${esc(signedUrl)}" />` : dash}</td>
      </tr>`;
    }).join("");

    const appendixBlocks = appendixLogs.map(log => {
      const signedUrl = receiptUrlByLogId.get(String(log?.id));
      if (!signedUrl) return "";
      return `
      <div class="receiptBlock">
        <img src="${esc(signedUrl)}" />
        <div class="receiptCaption">${dayLabel(log?.service_date)} — ${esc(log?.service_name ?? "")}</div>
      </div>`;
    }).join("");
    const overflowLine = overflowCount > 0
      ? `<div class="overflowNote">Plus ${overflowCount} additional receipts on file in LifeMaintained.</div>`
      : "";
    const appendix = appendixBlocks.length > 0 || overflowLine.length > 0
      ? `<h2 class="appendixHeading">Receipt Documentation</h2>${appendixBlocks}${overflowLine}`
      : "";

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Service History Report</title>
    <style>
      body { font-family: -apple-system, Helvetica, sans-serif; color: #111; background: #ffffff; margin: 0; padding: 32px 32px 56px 32px; }
      table.brand { width: 100%; border-collapse: collapse; }
      table.brand td { padding: 0; vertical-align: baseline; }
      .wordmark { font-size: 20px; font-weight: 700; color: #E8943A; }
      .logoMark { height: 28px; width: 28px; border-radius: 6px; margin-right: 8px; vertical-align: middle; }
      .docType { font-size: 11px; color: #666; text-align: right; }
      .identity { font-size: 28px; font-weight: 800; color: #111; margin-top: 20px; }
      .ymm { font-size: 13px; color: #444; margin-top: 3px; }
      .lastRecorded { font-size: 13px; color: #444; margin-top: 3px; }
      table.summary { width: 100%; border-collapse: collapse; margin-top: 20px; }
      table.summary td { border: 1px solid #ddd; padding: 10px; width: 25%; vertical-align: top; }
      .summaryLabel { font-size: 10px; color: #666; letter-spacing: 0.4px; text-transform: uppercase; }
      .summaryValue { font-size: 13px; color: #111; margin-top: 4px; }
      table.timeline { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 26px; }
      table.timeline th { background: #f5f5f5; text-align: left; font-size: 12px; padding: 8px 10px; border: 1px solid #eee; }
      table.timeline td { font-size: 12px; padding: 8px 10px; border: 1px solid #eee; vertical-align: top; }
      table.timeline tr { page-break-inside: avoid; }
      .thumb { height: 40px; width: auto; display: block; }
      .appendixHeading { font-size: 16px; font-weight: 700; color: #111; margin: 28px 0 12px 0; }
      .receiptBlock { page-break-inside: avoid; margin-bottom: 18px; }
      .receiptBlock img { max-width: 100%; max-height: 640px; display: block; }
      .receiptCaption { font-size: 11px; color: #666; margin-top: 5px; }
      .overflowNote { font-size: 12px; color: #444; margin-top: 12px; }
      .pageFooter { position: fixed; left: 32px; right: 32px; bottom: 16px; font-size: 9px; color: #999; }
    </style></head><body>
    <div class="pageFooter">Generated by LifeMaintained on ${esc(format(new Date(), "MMM d, yyyy"))}</div>
    <table class="brand"><tr>
      <td class="wordmark"><img class="logoMark" src="${logoDataUri}" />LifeMaintained</td>
      <td class="docType">Service History Report</td>
    </tr></table>
    <div class="identity">${esc(identity)}</div>
    ${nickname ? `<div class="ymm">${esc(yearMakeModel)}</div>` : ""}
    ${lastRecordedValue != null ? `<div class="lastRecorded">Last recorded: ${esc(num(lastRecordedValue))} ${tracksHrs ? "hours" : "miles"}</div>` : ""}
    <table class="summary"><tr>
      <td><div class="summaryLabel">Total records</div><div class="summaryValue">${ordered.length}</div></td>
      <td><div class="summaryLabel">Total spent</div><div class="summaryValue">${costed.length > 0 ? esc(money(totalSpent)) : dash}</div></td>
      <td><div class="summaryLabel">History span</div><div class="summaryValue">${spanStart} – ${spanEnd}</div></td>
      <td><div class="summaryLabel">Documentation</div><div class="summaryValue">${receiptLogs.length} of ${ordered.length} records include receipt documentation</div></td>
    </tr></table>
    <table class="timeline">
      <thead><tr><th>Date</th><th>${usageHeader}</th><th>Service</th><th>Cost</th><th>Provider</th><th>Receipt</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${appendix}
    </body></html>`;
  }

  function exportFileName(vehicleData: any, ext: "pdf" | "csv") {
    const base = `${vehicleData?.year ?? ""}-${vehicleData?.make ?? ""}-${vehicleData?.model ?? ""}-Service-History-${format(new Date(), "yyyy-MM-dd")}`;
    return `${base.replace(/\s+/g, "-").replace(/[^A-Za-z0-9-]/g, "")}.${ext}`;
  }

  async function copyToNamedDestination(sourceUri: string, fileName: string) {
    const destUri = FileSystem.cacheDirectory + fileName;
    await FileSystem.deleteAsync(destUri, { idempotent: true });
    await FileSystem.copyAsync({ from: sourceUri, to: destUri });
    return destUri;
  }

  async function resolveReceiptUrls(logsData: any[]): Promise<Map<string, string>> {
    const resolved = new Map<string, string>();
    const entries = [...logsData]
      .sort(compareLogsAsc)
      .filter(log => !!log?.receipt_url)
      .map(log => ({ logId: String(log.id), storagePath: String(log.receipt_url) }));
    if (entries.length === 0) return resolved;
    try {
      const outcome = await Promise.race([
        supabase.storage.from("receipts").createSignedUrls(entries.map(entry => entry.storagePath), 3600),
        new Promise<null>(resolve => setTimeout(() => resolve(null), 8000)),
      ]);
      if (outcome == null) return resolved;
      const { data, error } = outcome;
      if (error || !data) return resolved;
      data.forEach((item, index) => {
        const entry = entries[index];
        const signedUrl = item?.signedUrl;
        if (entry && typeof signedUrl === "string" && signedUrl.length > 0) {
          resolved.set(entry.logId, signedUrl);
        }
      });
    } catch {
      return resolved;
    }
    return resolved;
  }

  async function exportHistory(fmt: "pdf" | "csv") {
    if (!logs || logs.length === 0) {
      showToast("No Records", false, "There are no service records to export.");
      return;
    }
    setIsExporting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      if (fmt === "pdf") {
        const receiptUrlByLogId = await resolveReceiptUrls(logs);
        const html = buildHtml(logs, vehicle, receiptUrlByLogId);
        const { uri } = await Print.printToFileAsync({ html });
        const destUri = await copyToNamedDestination(uri, exportFileName(vehicle, "pdf"));
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(destUri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
        } else {
          showToast("PDF Saved", false, `Saved to: ${destUri}`);
        }
      } else {
        const csv = buildCsv(logs);
        const fileName = exportFileName(vehicle, "csv");
        const fileUri = FileSystem.documentDirectory + fileName;
        await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
        const destUri = await copyToNamedDestination(fileUri, fileName);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(destUri, { mimeType: "text/csv", UTI: "public.comma-separated-values-text" });
        } else {
          showToast("CSV Saved", false, `Saved to: ${destUri}`);
        }
      }
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast("Export didn't work", true, "Try again in a moment.");
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

            // Background delete: one atomic server-side RPC deletes all DB child
            // rows + the vehicle in a single transaction (all-or-nothing). Storage
            // files are purged best-effort AFTER the DB delete confirms success.
            (async () => {
              try {
                const { error: rpcErr } = await deleteVehicleCascade({ p_vehicle_id: vehicleId });
                if (rpcErr) throw rpcErr;

                try {
                  const { data: walletFiles } = await supabase.storage
                    .from("wallet-documents")
                    .list(`${userId}/${vehicleId}`);
                  if (walletFiles?.length) {
                    await supabase.storage
                      .from("wallet-documents")
                      .remove(walletFiles.map(f => `${userId}/${vehicleId}/${f.name}`));
                  }
                } catch (storageErr: any) {
                  console.warn("[DELETE] storage purge (non-blocking):", storageErr?.message ?? storageErr);
                }

                queryClient.invalidateQueries({ queryKey: ["vehicles"] });
                queryClient.invalidateQueries({ queryKey: ["vehicles", userId] });
                queryClient.invalidateQueries({ queryKey: ["dashboard"] });
              } catch (err: any) {
                console.warn("[DELETE] vehicle delete failed:", err?.message ?? err);
                queryClient.invalidateQueries({ queryKey: ["vehicles"] });
                queryClient.invalidateQueries({ queryKey: ["vehicles", userId] });
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
      { text: "Service History Report (PDF)", onPress: () => exportHistory("pdf") },
      { text: "Spreadsheet (CSV)", onPress: () => exportHistory("csv") },
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
          <Icon name="chevron-back" size={24} color={Colors.text} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{vehicleName}</Text>
          {vehicle?.nickname && (
            <Text style={{ ...Typography.footnote, color: Colors.textSecondary }} numberOfLines={1}>
              {`${vehicle.year ?? ""} ${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim()}
            </Text>
          )}
          {vehicle?.trim && (
            <Text style={styles.headerTrim} numberOfLines={1}>{vehicle.trim}</Text>
          )}
          {vehicle?.mileage != null && isMileageTracked(vehicle) && (
            <View style={styles.headerMileageRow}>
              <Icon name="speedometer-outline" size={11} color={Colors.textTertiary} />
              <Text style={styles.headerMileage}>{(projectedMileage(vehicle) ?? vehicle.mileage).toLocaleString()} mi</Text>
            </View>
          )}
          {vehicle?.hours != null && isHoursTracked(vehicle) && (
            <View style={styles.headerMileageRow}>
              <Icon name="timer-outline" size={11} color={Colors.textTertiary} />
              <Text style={styles.headerMileage}>{(projectedHours(vehicle) ?? vehicle.hours).toLocaleString()} hrs</Text>
            </View>
          )}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable
            style={({ pressed }) => [{ width: 34, height: 34, borderRadius: Radius.md, backgroundColor: Colors.surface, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 }]}
            onPress={() => router.push(`/edit-vehicle?vehicleId=${id}` as any)}
            hitSlop={4}
          >
            <Icon name="pencil-outline" size={16} color={Colors.text} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.deleteVehicleBtn, { opacity: pressed ? 0.7 : 1 }]}
            onPress={handleDeleteVehicle}
            hitSlop={4}
          >
            <Icon name="trash-outline" size={16} color={Colors.overdue} />
          </Pressable>
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator color={Colors.accent} style={{ marginTop: 60 }} />
      ) : vehicle ? (
        <ScrollView
          {...highlightScrollProps}
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
                  style={{ width: "100%", height: 180, borderRadius: Radius.lg }}
                  resizeMode="cover"
                />
              </Pressable>
            ) : (
              <Pressable
                onPress={handleVehiclePhoto}
                style={({ pressed }) => [{
                  height: 100, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.border, borderStyle: "dashed",
                  alignItems: "center", justifyContent: "center", gap: 8, opacity: pressed ? 0.7 : 1,
                }]}
              >
                {uploadingPhoto ? (
                  <ActivityIndicator color={Colors.accent} />
                ) : (
                  <>
                    <Icon name="camera-outline" size={24} color={Colors.textTertiary} />
                    <Text style={{ ...Typography.footnote, color: Colors.textTertiary }}>Add vehicle photo</Text>
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
                  <Button
                    variant="primary"
                    icon="add"
                    label="Log Service"
                    onPress={() => router.push(`/log-service/${id}` as any)}
                  />
                  {(tracksMiles || tracksHrs) && (
                    <Button
                      variant="tertiary"
                      fullWidth={false}
                      style={styles.updateUsageBtn}
                      label={tracksHrs ? "Update hours →" : "Update mileage →"}
                      onPress={() => router.push(`/update-mileage/${id}` as any)}
                    />
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
                  onPress={() => { setActiveTab(tab); Haptics.selectionAsync(); }}
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
              {(loadingSchedule || refreshingSchedule) ? (
                <ScheduleSkeleton />
              ) : scheduleError ? (
                <View style={styles.scheduleError}>
                  <Icon name="alert-circle-outline" size={32} color={Colors.overdue} />
                  <Text style={styles.scheduleErrorText}>Failed to load maintenance schedule</Text>
                  <Pressable
                    style={({ pressed }) => [styles.retryBtn, { opacity: pressed ? 0.8 : 1 }]}
                    onPress={() => refetchSchedule()}
                  >
                    <Text style={styles.retryBtnText}>Try Again</Text>
                  </Pressable>
                </View>
              ) : processedScheduleTasks.length > 0 && !processedScheduleTasks.some(t => t.last_completed_date != null) ? (
                <Animated.View style={revealActive ? styles.revealOpaque : { opacity: scheduleOpacity }}>
                  {revealActive && (
                    <Reanimated.Text style={[styles.revealHeadline, revealHeadlineStyle]}>
                      Your plan is ready.
                    </Reanimated.Text>
                  )}
                  {scheduleInsight && (
                    <Pressable
                      onPress={() => { if (insightTaskName) { setHighlightedTask(insightTaskName); setTimeout(() => setHighlightedTask(null), 2000); } }}
                      style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, flexDirection: "column", alignItems: "flex-start", gap: 4 }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                        <Icon name="bulb-outline" size={16} color={Colors.textSecondary} style={{ marginTop: 1 }} />
                        <Text style={{ ...Typography.footnote, fontWeight: "500", color: Colors.textSecondary, flex: 1 }}>
                          {scheduleInsight}
                        </Text>
                      </View>
                      <Text style={{ ...Typography.caption, color: Colors.textTertiary, marginTop: 2 }}>
                        Based on your vehicle and usage
                      </Text>
                    </Pressable>
                  )}
                  <CalibrationEntryCard
                    count={estimatedTasks.length}
                    tint={Colors.vehicle}
                    onPress={() => calibrationRef.current?.present()}
                  />
                  {estimatedTasks.length === 0 && (
                  <View style={{ backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.border, padding: 12, marginHorizontal: 16, marginTop: 8, marginBottom: 12, flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                    <Icon name="information-circle-outline" size={18} color={Colors.dueSoon} style={{ marginTop: 1 }} />
                    <Text style={{ ...Typography.footnote, color: Colors.dueSoon, flex: 1 }}>
                      This schedule is estimated from your current usage. Tap any task to log your last service date for more accurate due dates.
                    </Text>
                  </View>
                  )}
                  {actionNeededTasks.length > 0 && (
                    <ScheduleSection
                      title={`Action Needed (${actionNeededTasks.length})`}
                      titleColor={Colors.overdue}
                      expanded={actionNeededExpanded}
                      onToggle={() => { setActionNeededExpanded(v => !v); Haptics.selectionAsync(); }}
                      tasks={actionNeededTasks}
                      vehicle={vehicle}
                      onMarkComplete={handleOpenMarkComplete}
                      onEditTask={handleOpenEditTask}
                      costEstimates={costEstimates}
                      estimateLocked={!estimatesUnlocked}
                      onEstimateLockPress={() => router.push("/subscription?vertical=vehicle&reason=feature_locked")}
                      onShowDifficultyInfo={() => setShowDifficultyInfo(true)}
                      highlightedTask={highlightedTask}
                      highlightedTaskId={highlightedTaskId}
                      registerRow={registerTaskRow}
                      revealEnteringFor={revealEnteringFor}
                    />
                  )}
                  <ScheduleSection
                    title={`Upcoming (${upcomingTasks.length})`}
                    expanded={upcomingExpanded}
                    onToggle={() => { setUpcomingExpanded(v => !v); Haptics.selectionAsync(); }}
                    tasks={upcomingTasks}
                    vehicle={vehicle}
                    emptyMessage="No upcoming tasks"
                    onMarkComplete={handleOpenMarkComplete}
                    onEditTask={handleOpenEditTask}
                    costEstimates={costEstimates}
                    estimateLocked={!estimatesUnlocked}
                    onEstimateLockPress={() => router.push("/subscription?vertical=vehicle&reason=feature_locked")}
                    onShowDifficultyInfo={() => setShowDifficultyInfo(true)}
                    highlightedTask={highlightedTask}
                      highlightedTaskId={highlightedTaskId}
                      registerRow={registerTaskRow}
                      revealEnteringFor={revealEnteringFor}
                  />
                  {completedTasks.length > 0 && (
                    <ScheduleSection
                      title={`Completed (${completedTasks.length})`}
                      titleColor={Colors.good}
                      expanded={completedExpanded}
                      onToggle={() => { setCompletedExpanded(v => !v); Haptics.selectionAsync(); }}
                      tasks={completedTasks}
                      vehicle={vehicle}
                      onMarkComplete={handleOpenMarkComplete}
                      onEditTask={handleOpenEditTask}
                      costEstimates={costEstimates}
                      estimateLocked={!estimatesUnlocked}
                      onEstimateLockPress={() => router.push("/subscription?vertical=vehicle&reason=feature_locked")}
                      onShowDifficultyInfo={() => setShowDifficultyInfo(true)}
                      highlightedTask={highlightedTask}
                      highlightedTaskId={highlightedTaskId}
                      registerRow={registerTaskRow}
                      revealEnteringFor={revealEnteringFor}
                    />
                  )}
                  {Object.keys(costEstimates ?? {}).length > 0 && (
                    <Text style={{ ...Typography.caption, color: Colors.textTertiary, textAlign: "center", marginTop: 12, paddingHorizontal: 16 }}>
                      Cost estimates are approximate and vary by location and shop. Not a guarantee of pricing.
                    </Text>
                  )}
                  <Pressable
                    style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, opacity: pressed || refreshingSchedule ? 0.6 : 1 }]}
                    onPress={handleRefreshSchedulePress}
                    disabled={refreshingSchedule}
                  >
                    <Icon name="refresh-outline" size={14} color={Colors.textTertiary} />
                    <Text style={{ ...Typography.caption, color: Colors.textTertiary }}>Refresh Schedule</Text>
                  </Pressable>
                </Animated.View>
              ) : processedScheduleTasks.length === 0 ? (
                <View style={{ paddingTop: 16 }}>
                  <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
                    <Text style={{ ...Typography.headline, color: Colors.text, marginBottom: 4 }}>
                      Building your maintenance plan
                    </Text>
                    <Text style={{ ...Typography.footnote, color: Colors.textTertiary }}>
                      This usually takes about 10–20 seconds
                    </Text>
                  </View>
                  {!generatingSchedule && (
                    <Button
                      variant="primary"
                      label="Generate Schedule"
                      accessibilityLabel="Generate maintenance schedule"
                      onPress={() => { generateSchedule(); }}
                      style={styles.generateScheduleBtn}
                    />
                  )}
                  <ScheduleSkeleton />
                </View>
              ) : (
                <Animated.View style={revealActive ? styles.revealOpaque : { opacity: scheduleOpacity }}>
                  {revealActive && (
                    <Reanimated.Text style={[styles.revealHeadline, revealHeadlineStyle]}>
                      Your plan is ready.
                    </Reanimated.Text>
                  )}
                  <CalibrationEntryCard
                    count={estimatedTasks.length}
                    tint={Colors.vehicle}
                    onPress={() => calibrationRef.current?.present()}
                  />
                  {actionNeededTasks.length > 0 && (
                    <ScheduleSection
                      title={`Action Needed (${actionNeededTasks.length})`}
                      titleColor={Colors.overdue}
                      expanded={actionNeededExpanded}
                      onToggle={() => { setActionNeededExpanded(v => !v); Haptics.selectionAsync(); }}
                      tasks={actionNeededTasks}
                      vehicle={vehicle}
                      onMarkComplete={handleOpenMarkComplete}
                      onEditTask={handleOpenEditTask}
                      costEstimates={costEstimates}
                      estimateLocked={!estimatesUnlocked}
                      onEstimateLockPress={() => router.push("/subscription?vertical=vehicle&reason=feature_locked")}
                      onShowDifficultyInfo={() => setShowDifficultyInfo(true)}
                      highlightedTask={highlightedTask}
                      highlightedTaskId={highlightedTaskId}
                      registerRow={registerTaskRow}
                      revealEnteringFor={revealEnteringFor}
                    />
                  )}
                  <ScheduleSection
                    title={`Upcoming (${upcomingTasks.length})`}
                    expanded={upcomingExpanded}
                    onToggle={() => { setUpcomingExpanded(v => !v); Haptics.selectionAsync(); }}
                    tasks={upcomingTasks}
                    vehicle={vehicle}
                    emptyMessage="No upcoming tasks"
                    onMarkComplete={handleOpenMarkComplete}
                    onEditTask={handleOpenEditTask}
                    costEstimates={costEstimates}
                    estimateLocked={!estimatesUnlocked}
                    onEstimateLockPress={() => router.push("/subscription?vertical=vehicle&reason=feature_locked")}
                    onShowDifficultyInfo={() => setShowDifficultyInfo(true)}
                    highlightedTask={highlightedTask}
                      highlightedTaskId={highlightedTaskId}
                      registerRow={registerTaskRow}
                      revealEnteringFor={revealEnteringFor}
                  />
                  {completedTasks.length > 0 && (
                    <ScheduleSection
                      title={`Completed (${completedTasks.length})`}
                      titleColor={Colors.good}
                      expanded={completedExpanded}
                      onToggle={() => { setCompletedExpanded(v => !v); Haptics.selectionAsync(); }}
                      tasks={completedTasks}
                      vehicle={vehicle}
                      onMarkComplete={handleOpenMarkComplete}
                      onEditTask={handleOpenEditTask}
                      costEstimates={costEstimates}
                      estimateLocked={!estimatesUnlocked}
                      onEstimateLockPress={() => router.push("/subscription?vertical=vehicle&reason=feature_locked")}
                      onShowDifficultyInfo={() => setShowDifficultyInfo(true)}
                      highlightedTask={highlightedTask}
                      highlightedTaskId={highlightedTaskId}
                      registerRow={registerTaskRow}
                      revealEnteringFor={revealEnteringFor}
                    />
                  )}
                  {Object.keys(costEstimates ?? {}).length > 0 && (
                    <Text style={{ ...Typography.caption, color: Colors.textTertiary, textAlign: "center", marginTop: 12, paddingHorizontal: 16 }}>
                      Cost estimates are approximate and vary by location and shop. Not a guarantee of pricing.
                    </Text>
                  )}
                  <Pressable
                    style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, opacity: pressed || refreshingSchedule ? 0.6 : 1 }]}
                    onPress={handleRefreshSchedulePress}
                    disabled={refreshingSchedule}
                  >
                    <Icon name="refresh-outline" size={14} color={Colors.textTertiary} />
                    <Text style={{ ...Typography.caption, color: Colors.textTertiary }}>Refresh Schedule</Text>
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
                  <Icon name="document-outline" size={36} color={Colors.textTertiary} />
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
                          router.push(`/vehicle-task-history/${id}?task=${encodeURIComponent(group.name)}` as any);
                          Haptics.selectionAsync();
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
                          <Icon name="chevron-forward" size={16} color={Colors.textTertiary} />
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
                        <Icon name="share-outline" size={16} color={Colors.textInverse} />
                        <Text style={styles.exportBtnText}>Export History</Text>
                      </>
                    )}
                  </Pressable>
                  <Text style={styles.exportSellCopy}>Documented history helps your vehicle sell for more.</Text>
                </>
              )}
            </View>
          )}
        </ScrollView>
      ) : (vehicleError || vehicleFetchStatus === "paused") ? (
        <LoadErrorState onRetry={handleVehicleRetry} title="Unable to load this vehicle" body="Your vehicle is saved and safe. Check your connection and try again." retryAccessibilityLabel="Try loading vehicle again" />
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 32 }}>
          <Text style={{ ...Typography.headline, color: Colors.text, textAlign: "center" }}>Vehicle not found</Text>
          <Text style={{ ...Typography.footnote, color: Colors.textSecondary, textAlign: "center" }}>This vehicle may have been deleted.</Text>
          <Pressable
            onPress={() => router.back()}
            style={{ paddingHorizontal: 24, paddingVertical: 12, backgroundColor: Colors.accent, borderRadius: Radius.md }}
          >
            <Text style={{ ...Typography.subheadline, fontWeight: "600", color: Colors.textInverse }}>Go Back</Text>
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
            <View style={{ width: 36, height: 4, borderRadius: Radius.sm, backgroundColor: Colors.borderSubtle, alignSelf: "center", marginBottom: 16 }} />
            <Text style={{ ...Typography.headline, fontWeight: "700", color: Colors.textPrimary, marginBottom: 16 }}>
              DIY Difficulty Levels
            </Text>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
              <Text style={{ ...Typography.caption, fontWeight: "500", color: Colors.good, backgroundColor: Colors.card, paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.sm, overflow: "hidden" }}>
                Easy DIY
              </Text>
              <Text style={{ ...Typography.footnote, color: Colors.textSecondary, flex: 1 }}>
                No special tools or experience needed. Most people can do this with basic supplies and a YouTube video. Examples: air filter, wiper blades, cabin filter.
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
              <Text style={{ ...Typography.caption, fontWeight: "500", color: Colors.dueSoon, backgroundColor: Colors.card, paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.sm, overflow: "hidden" }}>
                Moderate
              </Text>
              <Text style={{ ...Typography.footnote, color: Colors.textSecondary, flex: 1 }}>
                Requires some tools and comfort working on your vehicle. May take 1-2 hours. Examples: brake pads, spark plugs, battery replacement.
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
              <Text style={{ ...Typography.caption, fontWeight: "500", color: Colors.overdue, backgroundColor: Colors.card, paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.sm, overflow: "hidden" }}>
                Pro Recommended
              </Text>
              <Text style={{ ...Typography.footnote, color: Colors.textSecondary, flex: 1 }}>
                Complex job requiring professional tools, expertise, or safety equipment. Best left to a certified mechanic. Examples: timing belt, transmission service, suspension work.
              </Text>
            </View>
            <Pressable
              onPress={() => setShowDifficultyInfo(false)}
              style={{ width: "100%", backgroundColor: Colors.vehicle, borderRadius: Radius.md, paddingVertical: 12, marginTop: 8 }}
            >
              <Text style={{ ...Typography.subheadline, fontWeight: "600", color: Colors.white, textAlign: "center" }}>
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
            context={{ vertical: "vehicle", reason: "feature_locked" }}
            onDismiss={() => setShowPaywall(false)}
          />
        </Modal>
      )}

      <ReminderMoment
        ref={reminderRef}
        title={reminderMoment?.title ?? ""}
        statusLine={reminderMoment?.statusLine ?? ""}
        costLine={reminderMoment?.costLine ?? null}
        onMarkDone={() => {
          const t = reminderMoment?.task;
          reminderRef.current?.dismiss();
          if (t) setTimeout(() => handleOpenMarkComplete(t), 280);
        }}
        onDismiss={() => {
          if (reminderTimerRef.current) { clearTimeout(reminderTimerRef.current); reminderTimerRef.current = null; }
        }}
      />

      <CalibrationSheet
        ref={calibrationRef}
        vertical="vehicle"
        tint={Colors.vehicle}
        tasks={estimatedTasks.map((t: any) => ({
          id: t.id,
          label: t.name,
          intervalHint: formatIntervalUsage(t, vehicle) ?? (t.interval_months ? `every ${t.interval_months} months` : null),
        }))}
        onApplied={(result) => {
          refetchSchedule();
          queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          if (user?.id) scheduleMaintenanceNotifications(user.id).catch(() => {});
          if (result.applied === 0) showToast("No updates applied");
        }}
      />
    </View>
  );
}

function ScheduleSkeleton() {
  return (
    <View style={styles.skeletonContainer}>
      {[1, 2, 3, 4].map(i => (
        <View key={i} style={styles.skeletonCard}>
          <View style={{ width: 4, height: 28, borderRadius: Radius.sm, backgroundColor: Colors.surface, flexShrink: 0 }} />
          <View style={{ flex: 1, gap: 8 }}>
            <View style={styles.skeletonLine} />
            <View style={[styles.skeletonLine, { width: "55%" }]} />
          </View>
        </View>
      ))}
    </View>
  );
}


/** IDs, in render order, of the first 10 task rows that will actually be rendered in the
 *  sections that are expanded right now. Rows hidden inside collapsed sections are never
 *  snapshotted, so expanding later does not animate them. */
function revealSnapshotIds(
  actionNeeded: any[], upcoming: any[], completed: any[],
  actionExpanded: boolean, upcomingExpanded: boolean, completedExpanded: boolean,
): string[] {
  const ids: string[] = [];
  const push = (rows: any[], expanded: boolean) => {
    if (!expanded) return;
    for (const t of rows) { if (ids.length < 10) ids.push(t.id); }
  };
  push(actionNeeded, actionExpanded);
  push(upcoming, upcomingExpanded);
  push(completed, completedExpanded);
  return ids.slice(0, 10);
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
  estimateLocked,
  onEstimateLockPress,
  onShowDifficultyInfo,
  highlightedTask,
  highlightedTaskId,
  registerRow,
  revealEnteringFor,
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
  estimateLocked?: boolean;
  onEstimateLockPress?: () => void;
  onShowDifficultyInfo?: () => void;
  highlightedTask?: string | null;
  highlightedTaskId?: string | null;
  registerRow?: (id: string, node: React.ElementRef<typeof View> | null) => void;
  /** Returns the one-shot reveal animation for a row, or undefined. Consumable. */
  revealEnteringFor?: (taskId: string, index: number) => any;
}) {
  return (
    <View style={styles.scheduleGroup}>
      <Pressable style={styles.scheduleSectionHeader} onPress={onToggle} hitSlop={6}>
        <Text style={[styles.scheduleSectionTitle, titleColor ? { color: titleColor } : null]}>
          {title.toUpperCase()}
        </Text>
        <Icon
          name={expanded ? "chevron-up" : "chevron-down"}
          size={14}
          color={Colors.textTertiary}
        />
      </Pressable>
      {expanded && (
        <View>
          <Divider inset={16} />
          {tasks.length === 0 && emptyMessage ? (
            <Text style={styles.scheduleSectionEmpty}>{emptyMessage}</Text>
          ) : (
            tasks.map((task, idx) => {
              const isDeepLink = task.id === highlightedTaskId;
              const entering = revealEnteringFor?.(task.id, idx);
              return (
                <React.Fragment key={task.id}>
                  {idx > 0 ? <Divider inset={16} /> : null}
                  <View
                    ref={(node) => { registerRow?.(task.id, node); }}
                    collapsable={false}
                    pointerEvents="box-none"
                    style={{ position: "relative" }}
                  >
                    <Reanimated.View entering={entering}>
                    <ScheduleTaskCard
                      task={task}
                      vehicle={vehicle}
                      onMarkComplete={onMarkComplete}
                      onEditTask={onEditTask}
                      costEstimate={costEstimates?.[task.name.toLowerCase().trim()]}
                      estimateLocked={estimateLocked}
                      onEstimateLockPress={onEstimateLockPress}
                      onShowDifficultyInfo={onShowDifficultyInfo}
                      isHighlighted={task.name === highlightedTask}
                    />
                    <HighlightBackdrop color={Colors.accentMuted} visible={isDeepLink} />
                    </Reanimated.View>
                  </View>
                </React.Fragment>
              );
            })
          )}
        </View>
      )}
    </View>
  );
}

function ScheduleTaskCard({ task, vehicle, onMarkComplete, onEditTask, costEstimate, onShowDifficultyInfo, isHighlighted, estimateLocked, onEstimateLockPress }: {
  task: any;
  vehicle: any;
  onMarkComplete: (task: any) => void;
  onEditTask: (task: any) => void;
  costEstimate?: any;
  estimateLocked?: boolean;
  onEstimateLockPress?: () => void;
  onShowDifficultyInfo?: () => void;
  isHighlighted?: boolean;
}) {
  const isCompleted = task.status === "completed";
  const [showCompletedInfo, setShowCompletedInfo] = useState(false);
  const { animatedStyle, onPressIn, onPressOut } = usePressScale();

  function handlePress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
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

  const calibState = vehicleTaskCalibrationState(task);
  // Both estimated and calibrated rows keep the "Est." label; only confirmed drops it.
  const showEstLabel = calibState !== "confirmed";

  const dueParts: string[] = [];
  if (!isCompleted) {
    if (nextDueUsage != null) dueParts.push(`${showEstLabel ? "Est. due" : "Due"} at ${formatUsageValue(nextDueUsage, vehicle)}`);
    if (task.next_due_date != null) dueParts.push(format(parseISO(task.next_due_date), "MMM d, yyyy"));
    if (dueParts.length === 0) dueParts.push("No schedule set");
  } else if (task.last_completed_date) {
    dueParts.push(`Completed ${format(parseISO(task.last_completed_date), "MMM d, yyyy")}`);
  }
  let dueText = dueParts.join(" · ");
  // Date-only rows carry no usage part, so the label goes on the date itself.
  if (!isCompleted && showEstLabel && nextDueUsage == null && task.next_due_date != null) {
    dueText = `Est. due ${dueText}`;
  }
  let lastServicedText: string | null = null;
  if (!isCompleted && task.last_completed_date) {
    const lastDate = format(parseISO(task.last_completed_date), "MMM d, yyyy");
    const lastUsage = lastCompletedUsage != null ? ` at ${formatUsageValue(lastCompletedUsage, vehicle)}` : "";
    lastServicedText = `Last serviced ${lastDate}${lastUsage}`;
  }

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={[
        styles.scheduleCard,
        { borderLeftColor: barColor, opacity: isCompleted ? 0.85 : 1 },
        animatedStyle,
        isHighlighted && styles.scheduleCardHighlighted,
      ]}
      accessibilityRole="button"
      accessibilityLabel={isCompleted ? `${task.name} — completed` : `${task.name} — tap to mark complete`}
    >
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
        {calibState === "estimated" ? (
          <Pressable onPress={() => onMarkComplete(task)} hitSlop={6}>
            <Text style={{ ...Typography.footnote, color: Colors.vehicle, marginTop: 2 }}>
              Confirm last service →
            </Text>
          </Pressable>
        ) : null}
        {!!lastServicedText && (
          <Text style={{ ...Typography.caption, fontWeight: "600", color: Colors.textSecondary, marginTop: 4 }}>
            {lastServicedText}
          </Text>
        )}
        {estimateLocked && !isCompleted && (
          <Pressable
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              onEstimateLockPress?.();
            }}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Shop and DIY cost estimates — upgrade to unlock"
            style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap", opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: Colors.vehicleMuted, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.sm }}>
              <Text style={{ ...Typography.caption, fontWeight: "600", color: Colors.vehicle }}>Shop Cost Estimate:</Text>
              <Icon name="lock-closed" size={11} color={Colors.vehicle} />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: Colors.vehicleMuted, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.sm }}>
              <Text style={{ ...Typography.caption, fontWeight: "600", color: Colors.vehicle }}>DIY Cost Estimate:</Text>
              <Icon name="lock-closed" size={11} color={Colors.vehicle} />
            </View>
          </Pressable>
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            {!!costLine && <Icon name="cash-outline" size={12} color={Colors.good} />}
            {!!costLine && <Text style={{ ...Typography.caption, color: Colors.good }}>
              {costLine}
            </Text>}
            {costEstimate.difficulty && (
              <>
                <Text style={{ ...Typography.caption, fontWeight: "500", color: costEstimate.difficulty === 1 ? Colors.good : costEstimate.difficulty === 2 ? Colors.dueSoon : Colors.overdue, backgroundColor: Colors.card, paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.sm, overflow: "hidden" }}>
                  {costEstimate.difficulty === 1 ? "Easy DIY" : costEstimate.difficulty === 2 ? "Moderate" : "Pro"}
                </Text>
                <Pressable onPress={() => onShowDifficultyInfo?.()} hitSlop={8}>
                  <Icon name="information-circle-outline" size={14} color={Colors.textTertiary} />
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
    </AnimatedPressable>
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
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 20 }}
            >
              <Text style={[styles.sheetTitle, { marginBottom: 0, flex: 1, textAlign: "center" }]} numberOfLines={2}>{editName}</Text>
              <Icon name="pencil-outline" size={14} color={Colors.textTertiary} />
            </Pressable>
          )}

          <ScrollView style={styles.sheetScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={[styles.sheetFields, { paddingBottom: 8 }]}>

              {/* Interval row — tappable to expand editor */}
              <Pressable
                style={({ pressed }) => [{
                  flexDirection: "row" as const, alignItems: "center" as const,
                  justifyContent: "space-between" as const,
                  backgroundColor: Colors.surface, borderRadius: Radius.md, padding: 16,
                  borderWidth: 1, borderColor: showIntervalEditor ? Colors.accent : Colors.border,
                  opacity: pressed ? 0.8 : 1,
                }]}
                onPress={() => setShowIntervalEditor(v => !v)}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Icon name="time-outline" size={18} color={Colors.textSecondary} />
                  <Text style={{ ...Typography.subheadline, color: Colors.text }}>{intervalText}</Text>
                </View>
                <Icon name={showIntervalEditor ? "chevron-up" : "chevron-down"} size={16} color={Colors.textTertiary} />
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
                              paddingHorizontal: 16, paddingVertical: 8, borderRadius: Radius.lg,
                              borderWidth: 1, opacity: pressed ? 0.8 : 1,
                              borderColor: editMiles === val && !useCustomMiles ? Colors.accent : Colors.border,
                              backgroundColor: editMiles === val && !useCustomMiles ? Colors.accentMuted : Colors.surface,
                            }]}
                            onPress={() => handleMilesPreset(val)}
                          >
                            <Text style={{
                              ...Typography.footnote,
                              fontWeight: "500",
                              color: editMiles === val && !useCustomMiles ? Colors.accent : Colors.textSecondary,
                            }}>
                              {val.toLocaleString()}
                            </Text>
                          </Pressable>
                        ))}
                        <Pressable
                          style={({ pressed }) => [{
                            paddingHorizontal: 16, paddingVertical: 8, borderRadius: Radius.lg,
                            borderWidth: 1, opacity: pressed ? 0.8 : 1,
                            borderColor: useCustomMiles ? Colors.accent : Colors.border,
                            backgroundColor: useCustomMiles ? Colors.accentMuted : Colors.surface,
                          }]}
                          onPress={() => { setUseCustomMiles(true); setChangeMethod("custom"); }}
                        >
                          <Text style={{
                            ...Typography.footnote,
                            fontWeight: "500",
                            color: useCustomMiles ? Colors.accent : Colors.textSecondary,
                          }}>Custom</Text>
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
                            paddingHorizontal: 16, paddingVertical: 8, borderRadius: Radius.lg,
                            borderWidth: 1, opacity: pressed ? 0.8 : 1,
                            borderColor: editMonths === val && !useCustomMonths ? Colors.accent : Colors.border,
                            backgroundColor: editMonths === val && !useCustomMonths ? Colors.accentMuted : Colors.surface,
                          }]}
                          onPress={() => handleMonthsPreset(val)}
                        >
                          <Text style={{
                            ...Typography.footnote,
                            fontWeight: "500",
                            color: editMonths === val && !useCustomMonths ? Colors.accent : Colors.textSecondary,
                          }}>
                            {val} mo
                          </Text>
                        </Pressable>
                      ))}
                      <Pressable
                        style={({ pressed }) => [{
                          paddingHorizontal: 16, paddingVertical: 8, borderRadius: Radius.lg,
                          borderWidth: 1, opacity: pressed ? 0.8 : 1,
                          borderColor: useCustomMonths ? Colors.accent : Colors.border,
                          backgroundColor: useCustomMonths ? Colors.accentMuted : Colors.surface,
                        }]}
                        onPress={() => { setUseCustomMonths(true); setChangeMethod("custom"); }}
                      >
                        <Text style={{
                          ...Typography.footnote,
                          fontWeight: "500",
                          color: useCustomMonths ? Colors.accent : Colors.textSecondary,
                        }}>Custom</Text>
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
                    backgroundColor: Colors.surface, borderRadius: Radius.md, paddingVertical: 12,
                    borderWidth: 1, borderColor: Colors.border, opacity: pressed ? 0.8 : 1,
                  }]}
                  onPress={() => { onClose(); onMarkComplete(task); }}
                >
                  <Icon name="checkmark-circle-outline" size={18} color={Colors.good} />
                  <Text style={{ ...Typography.subheadline, fontWeight: "500", color: Colors.good }}>Mark as Done</Text>
                </Pressable>
              )}

              {/* Delete Task */}
              <Pressable
                style={({ pressed }) => [{
                  flexDirection: "row" as const, alignItems: "center" as const,
                  justifyContent: "center" as const, gap: 8,
                  borderRadius: Radius.md, paddingVertical: 12, borderWidth: 1,
                  borderColor: Colors.overdue + "40", backgroundColor: Colors.card,
                  opacity: pressed ? 0.8 : 1,
                }]}
                onPress={() => onDelete(task)}
              >
                <Icon name="trash-outline" size={16} color={Colors.overdue} />
                <Text style={{ ...Typography.subheadline, fontWeight: "500", color: Colors.overdue }}>Delete Task</Text>
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
              style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 }}
            >
              <View style={{
                width: 24, height: 24, borderRadius: Radius.sm, borderWidth: 2,
                borderColor: diy ? Colors.accent : Colors.border,
                backgroundColor: diy ? Colors.accent : "transparent",
                alignItems: "center", justifyContent: "center",
              }}>
                {diy && <Icon name="checkmark" size={16} color={Colors.textInverse} />}
              </View>
              <Text style={{ ...Typography.footnote, fontWeight: "500", color: Colors.text }}>I did this myself</Text>
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
                  <Icon name="checkmark" size={16} color={Colors.textInverse} />
                  <Text style={styles.sheetSaveText}>Mark as Done</Text>
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
  const [walletToastVisible, setWalletToastVisible] = useState(false);
  const [walletToastTitle, setWalletToastTitle] = useState("");
  const [walletToastSubtitle, setWalletToastSubtitle] = useState<string | undefined>(undefined);
  const [walletToastIsError, setWalletToastIsError] = useState(false);

  function showWalletToast(title: string, subtitle: string | undefined, isError: boolean) {
    setWalletToastTitle(title);
    setWalletToastSubtitle(subtitle);
    setWalletToastIsError(isError);
    if (isError) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setWalletToastVisible(true);
    setTimeout(() => setWalletToastVisible(false), 2800);
  }

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
      showWalletToast("Copy didn't work", "Give it another shot.", true);
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
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength === 0) throw new Error("Empty image file");

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
      showWalletToast(
        "Couldn't save document",
        "Check your connection and try again. You can also pick a smaller photo.",
        true,
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
              showWalletToast("Photo didn't delete", "Try again in a moment.", true);
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
                onError={() => {
                  setViewingPhoto(null);
                  showWalletToast("Can't load photo", "The image couldn't be loaded. Try re-uploading it.", true);
                }}
              />
              <Text style={walletStyles.photoViewerHint}>Tap anywhere to close</Text>
            </View>
          ) : null}
        </Pressable>
      </Modal>
      <Text style={{ ...Typography.caption, color: Colors.textTertiary, textAlign: "center", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
        Photos stored here are for personal reference only. Check your local laws regarding acceptable identification documents.
      </Text>
      <SaveToast visible={walletToastVisible} message={walletToastTitle} subtitle={walletToastSubtitle} isError={walletToastIsError} />
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
            <Icon name="trash-outline" size={16} color={Colors.overdue} />
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
        <Icon name="camera-outline" size={28} color={Colors.textTertiary} />
        <Text style={walletStyles.slotName}>{label}</Text>
        <Text style={walletStyles.slotHint}>Tap to add photo</Text>
      </Pressable>
    </View>
  );
}

const walletStyles = StyleSheet.create({
  container: { gap: 16 },
  loading: { paddingVertical: 40, alignItems: "center" },
  slotEmpty: {
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.border,
    minHeight: 160,
    backgroundColor: Colors.surface,
    overflow: "hidden",
  },
  slotCopyBlock: {
    alignSelf: "stretch",
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 8,
    alignItems: "center",
  },
  slotCopyLink: {
    ...Typography.footnote,
    fontWeight: "600",
    color: Colors.textInverse,
    backgroundColor: Colors.accent,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: Radius.md,
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
  slotName: { ...Typography.subheadline, fontWeight: "600", color: Colors.text },
  slotHint: { ...Typography.footnote, color: Colors.textSecondary },
  slotFilled: {
    borderRadius: Radius.lg,
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
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  slotLabelText: { ...Typography.footnote, fontWeight: "600", color: Colors.text },
  slotLoading: {
    borderRadius: Radius.lg,
    height: 160,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: Colors.surface,
  },
  slotLoadingText: { ...Typography.footnote, color: Colors.textSecondary },
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
    ...Typography.footnote,
    fontWeight: "500",
    position: "absolute",
    bottom: 48,
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
  headerTitle: { ...Typography.title2, fontWeight: "600", color: Colors.text, textAlign: "center" },
  headerTrim: { ...Typography.caption, color: Colors.textSecondary, textAlign: "center" },
  headerMileageRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 },
  headerMileage: { ...Typography.subheadline, color: Colors.textTertiary },
  deleteVehicleBtn: {
    width: 34, height: 34, borderRadius: Radius.md,
    backgroundColor: Colors.card, alignItems: "center", justifyContent: "center",
  },
  scroll: { paddingHorizontal: 20, paddingTop: 16, gap: 12 },
  vehicleCard: {
    gap: 12,
  },
  vehicleFullName: { ...Typography.title2, color: Colors.text },
  vehicleMeta: { ...Typography.footnote, color: Colors.textSecondary },
  updateUsageBtn: { alignSelf: "center" },
  revealOpaque: { opacity: 1 },
  revealHeadline: {
    ...Typography.title3,
    color: Colors.text,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  generateScheduleBtn: { marginTop: 16, marginHorizontal: 16 },
  tabs: {
    flexDirection: "row",
    backgroundColor: Colors.background,
    paddingTop: 4,
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center", position: "relative" },
  tabActive: {},
  tabUnderline: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    height: 2, backgroundColor: Colors.accent, borderRadius: Radius.sm,
  },
  tabText: { ...Typography.footnote, fontWeight: "500", color: Colors.textTertiary },
  tabTextActive: { fontWeight: "600", color: Colors.text },
  tasksContainer: { gap: 12 },
  taskGroup: { gap: 8 },
  taskGroupHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  taskGroupDot: { width: 6, height: 6, borderRadius: Radius.pill },
  taskGroupTitle: {
    ...Typography.caption,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  taskCard: {
    flexDirection: "row", alignItems: "center", backgroundColor: Colors.card,
    borderRadius: Radius.md, padding: 12, gap: 12, borderWidth: 1, borderColor: Colors.border,
  },
  taskCardLeft: { flex: 1 },
  taskName: { ...Typography.subheadline, fontWeight: "500", color: Colors.text },
  taskMeta: { flexDirection: "row", gap: 8, marginTop: 4, flexWrap: "wrap" },
  taskDue: { ...Typography.caption, fontWeight: "500" },
  taskInterval: { ...Typography.caption, color: Colors.textTertiary },
  taskCost: { ...Typography.caption, color: Colors.textTertiary },
  completeBtn: {
    width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.card,
    alignItems: "center", justifyContent: "center",
  },
  emptyTasks: { alignItems: "center", paddingVertical: 32, gap: 8 },
  emptyTasksText: { ...Typography.footnote, color: Colors.textSecondary },
  emptyTasksSubtext: {
    ...Typography.footnote,
    color: Colors.textTertiary,
    textAlign: "center",
  },
  exportBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: Colors.vehicle, borderRadius: Radius.md, paddingVertical: 12,
  },
  exportBtnText: { ...Typography.footnote, fontWeight: "600", color: Colors.textInverse },
  exportSellCopy: {
    ...Typography.caption,
    color: Colors.textSecondary,
    textAlign: "center",
    marginTop: 8,
  },
  historyContainer: { gap: 16 },
  historySummaryBar: {
    flexDirection: "row", backgroundColor: Colors.card, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border, padding: 16,
    alignItems: "center", justifyContent: "space-around",
  },
  historySummaryStat: { alignItems: "center", gap: 4 },
  historySummaryValue: { ...Typography.title3, fontWeight: "700", color: Colors.text },
  historySummaryLabel: { ...Typography.caption, color: Colors.textSecondary },
  historySummaryDivider: { width: 1, height: 36, backgroundColor: Colors.border },
  historyGroupList: { gap: 12 },
  historyGroupCard: {
    flexDirection: "row", alignItems: "center", backgroundColor: Colors.card,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border,
    padding: 16, minHeight: 44, gap: 12,
  },
  historyGroupCardLeft: { flex: 1, gap: 4 },
  historyGroupCardName: { ...Typography.subheadline, fontWeight: "600", color: Colors.text },
  historyGroupCardMeta: { ...Typography.footnote, color: Colors.textSecondary },
  historyGroupCardProvider: { ...Typography.footnote, color: Colors.textTertiary },
  historyGroupCardFooter: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  historyGroupCardCount: { ...Typography.caption, color: Colors.textTertiary },
  historyGroupCardTotal: { ...Typography.caption, fontWeight: "500", color: Colors.textSecondary },
  historyGroupCardRight: { alignItems: "flex-end", gap: 8, flexShrink: 0 },
  historyGroupCardCost: { ...Typography.headline, fontWeight: "700", color: Colors.text },

  scheduleContainer: { gap: 16 },
  scheduleGroup: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.borderSubtle,
    overflow: "hidden",
  },
  scheduleSectionHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12,
  },
  scheduleSectionTitle: {
    ...Typography.footnote,
    fontWeight: "600",
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  scheduleSectionEmpty: {
    ...Typography.footnote,
    color: Colors.textTertiary,
    textAlign: "center",
    paddingVertical: 20,
  },
  scheduleCard: {
    flexDirection: "row", alignItems: "center", gap: 16,
    paddingHorizontal: 16, paddingVertical: 12,
    minHeight: 44,
    borderLeftWidth: 4,
  },
  scheduleCardHighlighted: { backgroundColor: Colors.accentMuted },
  scheduleCardBody: { flex: 1, gap: 4 },
  scheduleCardName: {
    ...Typography.headline,
    color: Colors.text,
  },
  scheduleCardNameDone: {
    ...Typography.footnote,
    color: Colors.textTertiary,
  },
  scheduleCardDue: {
    ...Typography.footnote,
    color: Colors.textSecondary,
  },
  scheduleCardDueDone: {
    ...Typography.caption,
    color: Colors.textTertiary,
  },
  scheduleCardCompletedInfo: {
    ...Typography.footnote,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  scheduleEmpty: {
    alignItems: "center", paddingVertical: 40, paddingHorizontal: 20, gap: 8,
  },
  scheduleEmptyTitle: {
    ...Typography.subheadline,
    fontWeight: "500",
    color: Colors.textSecondary,
    textAlign: "center",
  },
  scheduleEmptySubtitle: {
    ...Typography.footnote,
    color: Colors.textTertiary,
    textAlign: "center",
  },
  generateBtn: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.accent,
    borderRadius: Radius.md, paddingHorizontal: 24, paddingVertical: 12, marginTop: 8,
  },
  generateBtnText: { ...Typography.footnote, fontWeight: "600", color: Colors.textInverse },
  scheduleError: { alignItems: "center", paddingVertical: 40, gap: 12 },
  scheduleErrorText: {
    ...Typography.footnote,
    color: Colors.textSecondary,
    textAlign: "center",
  },
  retryBtn: {
    backgroundColor: Colors.surface, borderRadius: Radius.md, paddingHorizontal: 20, paddingVertical: 8,
    borderWidth: 1, borderColor: Colors.border, marginTop: 4,
  },
  retryBtnText: { ...Typography.footnote, fontWeight: "600", color: Colors.text },
  skeletonContainer: { gap: 0, backgroundColor: Colors.card, borderRadius: Radius.lg, overflow: "hidden", borderWidth: 1, borderColor: Colors.border },
  skeletonCard: {
    flexDirection: "row", alignItems: "center", gap: 16,
    paddingHorizontal: 16, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  skeletonLine: {
    height: 14, borderRadius: Radius.sm, backgroundColor: Colors.surface, width: "80%",
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
    width: 36, height: 4, borderRadius: Radius.sm,
    backgroundColor: Colors.border, alignSelf: "center", marginBottom: 16,
  },
  sheetTitle: {
    ...Typography.headline,
    color: Colors.text,
    marginBottom: 20,
    textAlign: "center",
  },
  sheetScroll: { maxHeight: 400 },
  sheetFields: { gap: 16 },
  sheetField: { gap: 8 },
  sheetFieldLabel: {
    ...Typography.caption,
    fontWeight: "600",
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  sheetFieldOptional: {
    ...Typography.caption,
    color: Colors.textTertiary,
    textTransform: "none",
  },
  sheetInput: {
    ...Typography.subheadline,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sheetInputMultiline: {
    minHeight: 64, textAlignVertical: "top",
  },
  dateStepper: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border, overflow: "hidden",
  },
  dateStepBtn: {
    width: 44, height: 46, alignItems: "center", justifyContent: "center",
  },
  dateStepValue: {
    ...Typography.subheadline,
    fontWeight: "500",
    flex: 1,
    textAlign: "center",
    color: Colors.text,
  },
  dateQuickRow: {
    flexDirection: "row", gap: 8, marginTop: 8,
  },
  dateQuickBtn: {
    flex: 1, paddingVertical: 8, borderRadius: Radius.md,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    alignItems: "center",
  },
  dateQuickBtnActive: {
    backgroundColor: Colors.accentMuted, borderColor: Colors.accent,
  },
  dateQuickText: {
    ...Typography.footnote,
    fontWeight: "500",
    color: Colors.textSecondary,
  },
  dateQuickTextActive: {
    fontWeight: "600",
    color: Colors.accent,
  },
  sheetActions: {
    flexDirection: "row", gap: 12, marginTop: 24,
  },
  sheetCancelBtn: {
    flex: 1, paddingVertical: 12, borderRadius: Radius.md, alignItems: "center",
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
  },
  sheetCancelText: {
    ...Typography.subheadline,
    fontWeight: "500",
    color: Colors.textSecondary,
  },
  sheetSaveBtn: {
    flex: 2, paddingVertical: 12, borderRadius: Radius.md,
    backgroundColor: Colors.accent, alignItems: "center", justifyContent: "center",
    flexDirection: "row", gap: 8,
  },
  sheetSaveText: {
    ...Typography.subheadline,
    fontWeight: "600",
    color: Colors.textInverse,
  },
});
