import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Platform,
  ActivityIndicator,
  Modal,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ReceiptScanButton from "@/components/ReceiptScanButton";
import Paywall from "@/components/Paywall";
import ScanPackModal, { type ScanPackModalHandle } from "@/components/ScanPackModal";
import { isFreeTier } from "@/lib/subscription";
import { ReceiptScanResult } from "@/lib/receiptScanner";
import { scheduleMaintenanceNotifications } from "@/lib/notificationScheduler";
import DatePicker from "@/components/DatePicker";
import { parseISO, format } from "date-fns";
import { SaveToast } from "@/components/SaveToast";
import { CATEGORY_GROUPS } from "@/lib/maintenanceMatcher";
import { resolveTrackingMode, isHoursTracked, isMileageTracked } from "@/lib/usageHelpers";
import { updateVehicleUsage } from "@/lib/vehicleUsageHelper";
import { sha256OfBytes } from "@/lib/receiptVerification";
import Tooltip, { TOOLTIP_IDS } from "@/components/Tooltip";
import * as Sentry from "@sentry/react-native";
import { matchServiceToTask, type MatchCandidate } from "@/lib/serviceMatcher";
import {
  completeVehicleTaskIdempotent,
  undoVehicleCompletions,
  type CompleteVehicleTaskIdempotentArgs,
  type TaskCompletionSnapshot,
} from "@/lib/rpc";
import { newOperationId } from "@/lib/operationId";
import { resumeMode, resumePrompt, rewritePendingRemainder, mergeCarriedItems, carriedCreatedAt, saveTimePriorNeedsHold, defusePendingSave, rebindItem, settleItem, type PendingSaveItem, type PendingSaveRecord } from "@/lib/pendingSave";
import { writePendingSave, readPendingSave, clearPendingSave } from "@/lib/pendingSaveStore";
import { planToast, type CompletionOutcome } from "@/lib/saveOutcome";
import { showUndoToast } from "@/components/UndoToast";
import TaskMatchPicker, { type TaskMatchPickerHandle } from "@/components/TaskMatchPicker";

type PricingInsight = {
  cost: number | null;
  provider: string | null;
  assetName: string;
  date: string | null;
};

type ScannedItem = { name: string; cost: number | null; details: string | null };

/**
 * Save-flow phases.
 *
 *   checking - the durable recovery record is being read. The form paints
 *              LOCKED, so a resume can never race a fresh edit.
 *   editing  - the only actionable phase.
 *   asking   - an out-of-window recovery record needs a decision.
 *   saving   - from the save tap through the toast. This screen is registered
 *              presentation "fullScreenModal" with headerShown false, so the
 *              close control is the only dismissal affordance and it is
 *              disabled here. Once the log insert resolves the phase is
 *              terminal: the screen never returns to "editing".
 */
type SavePhase = "checking" | "editing" | "asking" | "saving";

type PickerAnswer =
  | { kind: "select"; taskId: string; taskName: string }
  | { kind: "skip" };

type TaskChip = { id: string; name: string };

/** Chips are ordered by due date, so the soonest are the ones worth surfacing. */
const MAX_TASK_CHIPS = 10;
/** Sequential confirmations per save. Past this, REVIEW entries are disclosed as a count. */
const MAX_PICKERS_PER_SAVE = 2;
/** One automatic same-id retry. The id is stable, so a replay is idempotent server-side. */
const AUTO_RETRY_DELAY_MS = 400;
/** The undo toast is root-hosted and survives navigation, so the screen can leave promptly. */
const BACK_NAV_UNDO_MS = 1200;
/** A screen-local toast dies with the screen; a disclosed loss must stay readable. */
const BACK_NAV_SAVE_MS = 2400;
/** The attach offer needs a real decision window - matches the undo toast. */
const ATTACH_TOAST_MS = 6000;
/**
 * Bounded wait for a session refresh before a resume decision. Expiry alone is
 * not proof of a dead session, but an unconfirmed one must not run silently.
 */
const SESSION_CONFIRM_TIMEOUT_MS = 6000;
const SESSION_EXPIRY_MARGIN_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatNextDue(applied: TaskCompletionSnapshot): string | null {
  if (applied.next_due_miles != null) {
    return `Next due at ${Number(applied.next_due_miles).toLocaleString()} mi`;
  }
  if (applied.next_due_hours != null) {
    return `Next due at ${Number(applied.next_due_hours).toLocaleString()} hrs`;
  }
  if (applied.next_due_date) {
    return `Next due ${new Date(applied.next_due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  }
  return null;
}

export default function LogServiceScreen() {
  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  const insets = useSafeAreaInsets();
  const { user, profile, session, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  const scrollRef = useRef<any>(null);
  const scrollOffset = useRef(0);
  const [showPaywall, setShowPaywall] = useState(false);
  const scanPackModalRef = useRef<ScanPackModalHandle>(null);
  const [task, setTask] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [mileage, setMileage] = useState("");
  const [cost, setCost] = useState("");
  const [provider, setProvider] = useState("");
  const [notes, setNotes] = useState("");
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [editingField, setEditingField] = useState<{ index: number; field: "name" | "cost" } | null>(null);
  const [ocrApplied, setOcrApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiptLocalUri, setReceiptLocalUri] = useState<string | null>(null);
  // Verification capture only. Carries the hash of the bytes this save actually
  // uploaded from the upload site to the insert; never gates a save.
  const receiptShaRef = useRef<string | null>(null);
  const [receiptWarning, setReceiptWarning] = useState(false);
  const [historicalReceiptDate, setHistoricalReceiptDate] = useState<string | null>(null);
  const [pricingInsight, setPricingInsight] = useState<PricingInsight | null>(null);
  const insightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [vehicleType, setVehicleType] = useState<string | null>(null);
  const [vehicleData, setVehicleData] = useState<any>(null);
  const [trackingMode, setTrackingMode] = useState<string | null>(null);
  const [hoursReading, setHoursReading] = useState("");
  const [successToastVisible, setSuccessToastVisible] = useState(false);
  const [successToastTitle, setSuccessToastTitle] = useState("");
  const [successToastSubtitle, setSuccessToastSubtitle] = useState<string | undefined>(undefined);
  const [scanPackOpenErrorVisible, setScanPackOpenErrorVisible] = useState(false);
  const [mismatchInfo, setMismatchInfo] = useState<{ description: string; scan: ReceiptScanResult } | null>(null);
  const [pendingMileageChip, setPendingMileageChip] = useState<number | null>(null);
  const [phase, setPhase] = useState<SavePhase>("checking");
  const [resumeAsk, setResumeAsk] = useState<{ rec: PendingSaveRecord; title: string; detail: string } | null>(null);
  /** The recovery check runs exactly once per mount, after auth hydration settles. */
  const recoveryStartedRef = useRef(false);
  /**
   * In-memory shadow of the remainder this session last decided (a preserved
   * record, or null after a clear or an explicit discard).
   */
  const pendingRemainderRef = useRef<PendingSaveRecord | null>(null);
  /**
   * True once THIS SESSION has adjudicated the prior - the save flow decided
   * the remainder, or the user explicitly discarded. From that point the
   * shadow is the authoritative truth, including "none", and the save path
   * never falls back to disk: a fallback there could resurrect a record the
   * user just discarded behind a failed storage clear.
   */
  const priorAdjudicatedRef = useRef(false);
  const [directTask, setDirectTask] = useState<TaskChip | null>(null);
  const [pickerService, setPickerService] = useState("");
  const [pickerCandidates, setPickerCandidates] = useState<MatchCandidate[]>([]);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [pickerWorkingTaskId, setPickerWorkingTaskId] = useState<string | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const pickerRef = useRef<TaskMatchPickerHandle>(null);
  const pickerResolveRef = useRef<((answer: PickerAnswer) => void) | null>(null);
  // True while a sheet is believed to be on screen. Cleared by whichever side
  // closes it, so every dismissal event is attributable to exactly one item.
  const pickerOpenRef = useRef(false);
  // Resolver for a close WE asked for. Its presence is what distinguishes a
  // programmatic dismissal from the user closing the sheet, so a late callback
  // can never be mistaken for an answer.
  const pickerDismissAckRef = useRef<(() => void) | null>(null);
  const [pickerLockedTaskId, setPickerLockedTaskId] = useState<string | null>(null);
  const lastPickRef = useRef<{ taskId: string; taskName: string } | null>(null);
  // Synchronous re-entry guard. `locked` is closure state and is still false on
  // a second tap in the same frame, which would commit the log twice.
  const savingRef = useRef(false);

  // A counter, not a boolean: presenting is a request we make once per item,
  // while dismissing is imperative and always awaited. A boolean would make
  // "close" a render-driven side effect we cannot attribute.
  const [pickerRequest, setPickerRequest] = useState(0);

  // Attach-by-hand affordance (Packet D). Context is retained ONLY when the
  // toast offers Attach: the settled NONE item, the save's record (for date
  // and meters), and the task list already fetched by this save.
  const [attachToastVisible, setAttachToastVisible] = useState(false);
  const attachCtxRef = useRef<{ item: PendingSaveItem; rec: PendingSaveRecord; tasks: TaskChip[] } | null>(null);
  const attachNavTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pickerMode, setPickerMode] = useState<"match" | "attach">("match");

  /** The form starts locked and is unlocked only once the recovery check clears. */
  const locked = phase !== "editing";

  // Presentation runs from an effect so the sheet always commits with the
  // current service name and candidate list. Dismissal is never driven from
  // here - see runPicker, where every close is awaited.
  useEffect(() => {
    if (pickerRequest > 0) pickerRef.current?.present();
  }, [pickerRequest]);

  // An awaited confirmation must never outlive the screen. Settling it as a skip
  // lets the flow finish its own teardown instead of hanging on a dead promise.
  useEffect(() => {
    return () => {
      if (attachNavTimerRef.current) { clearTimeout(attachNavTimerRef.current); attachNavTimerRef.current = null; }
      pickerOpenRef.current = false;
      const ack = pickerDismissAckRef.current;
      pickerDismissAckRef.current = null;
      if (ack) ack();
      if (pickerResolveRef.current) {
        // DIAG-1 (temporary): a teardown that answers a live picker is exactly
        // the invisible adjudication we are hunting.
        Sentry.captureMessage("log_service diag teardown_resolved_picker", {
          level: "info", tags: { area: "pending_save_diag", op: "teardown_resolved_picker" }, extra: { vehicleId },
        });
      }
      const resolve = pickerResolveRef.current;
      pickerResolveRef.current = null;
      if (resolve) resolve({ kind: "skip" });
    };
  }, []);

  function fireSuccessToast(title: string, subtitle?: string, warn?: boolean) {
    setSuccessToastTitle(title);
    setSuccessToastSubtitle(subtitle);
    Haptics.notificationAsync(
      warn ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success,
    ).catch(() => {});
    setSuccessToastVisible(true);
    setTimeout(() => setSuccessToastVisible(false), 2800);
  }

  useEffect(() => {
    if (!vehicleId) return;
    supabase
      .from("vehicles")
      .select("vehicle_type, tracking_mode, hours, mileage, year, make, model, nickname")
      .eq("id", vehicleId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setVehicleType(data.vehicle_type);
          setTrackingMode(data.tracking_mode);
          setVehicleData(data);
        }
      });
  }, [vehicleId]);

  const usageMode = resolveTrackingMode({ vehicle_type: vehicleType, tracking_mode: trackingMode as import("@/lib/usageHelpers").TrackingMode | null });

  const itemsTotal = scannedItems.length > 0
    ? scannedItems.reduce((sum, item) => sum + (item.cost ?? 0), 0)
    : null;

  // Chips are this vehicle's REAL tasks, so a tap binds identity rather than
  // text. Key, select and ordering mirror the canonical query in
  // app/vehicle/[id].tsx, which means this screen shares that cache instead of
  // shadowing it with a narrower row shape.
  const { data: chipRows } = useQuery({
    queryKey: ["user_vehicle_maintenance_tasks", vehicleId],
    queryFn: async () => {
      const uid = user?.id;
      if (!uid) return [];
      const { data, error: chipErr } = await supabase
        .from("user_vehicle_maintenance_tasks")
        .select("*")
        .eq("vehicle_id", vehicleId)
        .eq("user_id", uid)
        .order("next_due_date", { ascending: true, nullsFirst: false });
      if (chipErr) throw chipErr;
      return data ?? [];
    },
    enabled: !!user && !!vehicleId,
  });

  const taskChips: TaskChip[] = useMemo(() => {
    const out: TaskChip[] = [];
    for (const row of chipRows ?? []) {
      if (out.length >= MAX_TASK_CHIPS) break;
      if (typeof row.name === "string" && row.name.trim().length > 0) {
        out.push({ id: row.id, name: row.name.trim() });
      }
    }
    return out;
  }, [chipRows]);

  /**
   * A session is CONFIRMED when its expiry sits comfortably in the future, or
   * a bounded refresh proves it. An unconfirmed session must never start a
   * silent resume: every completion would resolve unknown against a dead auth
   * state, burning the automatic attempt on a run that cannot succeed.
   */
  async function confirmSession(): Promise<boolean> {
    const live = session;
    if (live && typeof live.expires_at === "number" && live.expires_at * 1000 > Date.now() + SESSION_EXPIRY_MARGIN_MS) {
      return true;
    }
    try {
      const refreshed = await Promise.race([
        supabase.auth.refreshSession().then(r => r.data.session),
        new Promise<null>(resolve => setTimeout(() => resolve(null), SESSION_CONFIRM_TIMEOUT_MS)),
      ]);
      return !!(refreshed && typeof refreshed.expires_at === "number" && refreshed.expires_at * 1000 > Date.now() + SESSION_EXPIRY_MARGIN_MS);
    } catch {
      return false;
    }
  }

  // A recovery record means a log committed whose task updates never ran. The
  // lock is already held (phase starts "checking"), so nothing is actionable
  // while this resolves. The check waits for auth hydration and runs once per
  // mount: a silent resume starts only on a confirmed session, and an
  // unconfirmed one falls to the ask overlay, where both choices stay
  // non-destructive.
  useEffect(() => {
    if (!user || !vehicleId || authLoading) return;
    if (recoveryStartedRef.current) return;
    recoveryStartedRef.current = true;
    let cancelled = false;
    (async () => {
      // DIAG-1 (temporary): observe every recovery branch.
      Sentry.captureMessage("log_service diag recovery_run", {
        level: "info", tags: { area: "pending_save_diag", op: "recovery_run" }, extra: { vehicleId },
      });
      const rec = await readPendingSave(user.id, vehicleId);
      if (cancelled) return;
      if (!rec) {
        Sentry.captureMessage("log_service diag recovery_rec_null", {
          level: "info", tags: { area: "pending_save_diag", op: "recovery_rec_null" }, extra: { vehicleId },
        });
        setPhase("editing");
        return;
      }
      const confirmed = await confirmSession();
      if (cancelled) return;
      if (confirmed && resumeMode(rec, Date.now()) === "silent") {
        Sentry.captureMessage("log_service diag recovery_silent", {
          level: "info", tags: { area: "pending_save_diag", op: "recovery_silent" }, extra: { vehicleId, items: rec.items.length },
        });
        savingRef.current = true;
        setPhase("saving");
        void runSaveFlow(rec, false, true, new Set<string>());
      } else {
        if (!confirmed) {
          Sentry.captureMessage("log_service session unconfirmed", {
            tags: { area: "log_service_recovery", arm: "session_unconfirmed" },
            extra: { vehicleId },
          });
        }
        Sentry.captureMessage("log_service diag recovery_ask", {
          level: "info", tags: { area: "pending_save_diag", op: "recovery_ask" }, extra: { vehicleId, confirmed },
        });
        const prompt = resumePrompt(rec);
        setResumeAsk({ rec, title: prompt.title, detail: prompt.detail });
        setPhase("asking");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, vehicleId, authLoading]);

  useEffect(() => {
    if (insightTimerRef.current) clearTimeout(insightTimerRef.current);
    const trimmed = task.trim();
    if (!trimmed || trimmed.length < 3 || !user) {
      setPricingInsight(null);
      return;
    }
    insightTimerRef.current = setTimeout(async () => {
      try {
        const { data: otherLogs } = await supabase
          .from("maintenance_logs")
          .select("*")
          .eq("user_id", user.id)
          .order("service_date", { ascending: false })
          .limit(100);

        const relevantLogs = (otherLogs ?? []).filter(
          l => l.vehicle_id !== vehicleId
        );
        if (relevantLogs.length === 0) { setPricingInsight(null); return; }

        const norm = (s: string) =>
          s.toLowerCase().replace(/[&,.()\-\/+]/g, " ").replace(/\s+/g, " ").trim();
        const serviceNorm = norm(trimmed);

        let bestLog: any = null;
        let bestScore = 0;
        for (const log of relevantLogs) {
          const logNorm = norm(log.service_name ?? "");
          let score = 0;
          const sWords = serviceNorm.split(" ").filter(w => w.length >= 3);
          const lWords = logNorm.split(" ").filter(w => w.length >= 3);
          for (const sw of sWords) {
            if (lWords.some(lw => lw === sw || lw.includes(sw) || sw.includes(lw))) score += 2;
          }
          for (const group of CATEGORY_GROUPS) {
            const svcHas = group.some(kw => serviceNorm.includes(kw));
            const logHas = group.some(kw => logNorm.includes(kw));
            if (svcHas && logHas) score += 3;
          }
          if (score >= 3 && score > bestScore) { bestScore = score; bestLog = log; }
        }

        if (!bestLog) { setPricingInsight(null); return; }

        let assetName = "another asset";
        if (bestLog.vehicle_id) {
          const { data: veh } = await supabase
            .from("vehicles")
            .select("year, make, model, nickname")
            .eq("id", bestLog.vehicle_id)
            .maybeSingle();
          if (veh) assetName = veh.nickname ?? `${veh.year} ${veh.make} ${veh.model}`;
        } else if (bestLog.property_id) {
          const { data: prop } = await supabase
            .from("properties")
            .select("name")
            .eq("id", bestLog.property_id)
            .maybeSingle();
          if (prop) assetName = prop.name;
        }

        setPricingInsight({
          cost: bestLog.cost,
          provider: bestLog.provider_name,
          assetName,
          date: bestLog.service_date,
        });
      } catch {
        setPricingInsight(null);
      }
    }, 700);
    return () => { if (insightTimerRef.current) clearTimeout(insightTimerRef.current); };
  }, [task, user?.id, vehicleId]);

  function handleScanComplete(result: ReceiptScanResult) {
    setMismatchInfo(null);
    setPendingMileageChip(null);
    // The server debits at complete regardless of what the user does with the
    // result, so the credit-aware quota refresh happens here, before any branching.
    if (!result.error) {
      queryClient.invalidateQueries({ queryKey: ["scan-quota"] });
    }
    if (result.vehicle_mismatch && result.vehicle) {
      setMismatchInfo({ description: result.vehicle, scan: result });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      return;
    }
    applyScanFields(result, false);
  }

  function handleMismatchUseAnyway() {
    if (!mismatchInfo) return;
    const scan = mismatchInfo.scan;
    setMismatchInfo(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    applyScanFields(scan, true);
  }

  function handleMismatchDiscard() {
    setMismatchInfo(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }

  function applyScanFields(result: ReceiptScanResult, chipAllMileage: boolean) {
    if (__DEV__) {
      console.log("Scan result:", JSON.stringify(result));
      console.log("Scan result fields - task:", result.task, "serviceType:", result.serviceType, "cost:", result.cost, "provider:", result.provider, "mileage:", result.mileage, "date:", result.date);
    }
    if (result.date) setDate(result.date);
    if (result.mileage != null) {
      if (vehicleData && isMileageTracked(vehicleData)) {
        const currentMiles = typeof vehicleData.mileage === "number" ? vehicleData.mileage : null;
        if (!chipAllMileage && currentMiles != null && result.mileage <= currentMiles) {
          setMileage(String(result.mileage));
        } else {
          setPendingMileageChip(result.mileage);
        }
      } else if (!vehicleData) {
        setPendingMileageChip(result.mileage);
      }
    }
    if (result.provider) setProvider(result.provider);
    if (result.localUri) setReceiptLocalUri(result.localUri);

    if (result.items && result.items.length > 1) {
      setScannedItems(result.items);
      setCost(result.cost != null ? String(result.cost) : "");
      setTask(result.task || "");
    } else {
      if (result.task) setTask(result.task);
      else if (result.serviceType) setTask(result.serviceType);
      if (result.cost != null) setCost(String(result.cost));
      setScannedItems([]);
    }

    if (!result.error) {
      setOcrApplied(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    if (result.date) {
      const scannedMs = parseISO(result.date).getTime();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      if (!isNaN(scannedMs) && Date.now() - scannedMs > thirtyDaysMs) {
        setHistoricalReceiptDate(result.date);
      } else {
        setHistoricalReceiptDate(null);
      }
    } else {
      setHistoricalReceiptDate(null);
    }
    setReceiptWarning(false);
  }

  async function uploadReceiptImage(localUri: string, userId: string, assetId: string): Promise<string | null> {
    try {
      const timestamp = Date.now();
      const path = `${userId}/vehicle/${assetId}/${timestamp}.jpg`;
      const response = await fetch(localUri);
      if (!response.ok) throw new Error("Could not read receipt file");
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength === 0) throw new Error("Empty receipt file");
      // Hash the exact bytes handed to .upload() below - same buffer, no re-read,
      // no re-encode. Returns null on any failure; capture never blocks a save.
      const receiptSha = await sha256OfBytes(arrayBuffer);
      receiptShaRef.current = receiptSha;
      const { data, error: uploadErr } = await supabase.storage
        .from("receipts")
        .upload(path, arrayBuffer, { contentType: "image/jpeg", upsert: false });
      if (uploadErr) throw uploadErr;
      return data.path;
    } catch (err) {
      console.error("Receipt upload failed:", err);
      return null;
    }
  }

  function updateItem(index: number, patch: Partial<ScannedItem>) {
    setScannedItems(prev => prev.map((item, i) => i === index ? { ...item, ...patch } : item));
  }

  function deleteItem(index: number) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditingField(null);
    setScannedItems(prev => prev.filter((_, i) => i !== index));
  }

  function addItem() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newIndex = scannedItems.length;
    setScannedItems(prev => [...prev, { name: "", cost: null, details: null }]);
    setEditingField({ index: newIndex, field: "name" });
  }

  function startMultiService() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const parsed = cost.trim() ? parseFloat(cost.replace(/,/g, "")) : NaN;
    const seed: ScannedItem = {
      name: task.trim(),
      cost: Number.isFinite(parsed) ? parsed : null,
      details: notes.trim() || null,
    };
    const hasSeed = seed.name.length > 0 || seed.cost != null || (seed.details?.length ?? 0) > 0;
    if (hasSeed) {
      setScannedItems([seed, { name: "", cost: null, details: null }]);
      setEditingField({ index: 1, field: "name" });
    } else {
      setScannedItems([{ name: "", cost: null, details: null }]);
      setEditingField({ index: 0, field: "name" });
    }
  }

  // ---------------------------------------------------------------------------
  // P1 commit -> P2 resolve + complete -> P3 side effects -> P4 toast -> P5 exit
  // ---------------------------------------------------------------------------

  function answerPicker(answer: PickerAnswer) {
    const resolve = pickerResolveRef.current;
    pickerResolveRef.current = null;
    if (resolve) resolve(answer);
  }

  function waitForPickerAnswer(): Promise<PickerAnswer> {
    return new Promise<PickerAnswer>(resolve => {
      pickerResolveRef.current = resolve;
    });
  }

  /**
   * The sheet reports every dismissal, including the one the flow triggers when
   * it moves to the next item. Only a dismissal while we still believe the sheet
   * is open is the user's, and only that one answers.
   */
  function handleSheetDismiss() {
    const ack = pickerDismissAckRef.current;
    if (ack) {
      // We asked for this close. Release the handoff and answer for no one.
      pickerDismissAckRef.current = null;
      pickerOpenRef.current = false;
      ack();
      return;
    }
    if (!pickerOpenRef.current) return;
    // Nobody asked, so the user closed a sheet that was on screen. That is a
    // skip for the item currently showing, and only for that item.
    pickerOpenRef.current = false;
    answerPicker({ kind: "skip" });
  }

  /**
   * P3. The six invalidations and the reschedule run CONCURRENTLY, each with its
   * own tagged catch. Nothing downstream awaits this: a stalled invalidation
   * must never delay the toast, the exit, or an undo result.
   *
   * Detached by construction - this is also the undo path's rerun, where the
   * screen may already be unmounted - so it touches only the query client, the
   * scheduler and Sentry. No state setters, no mounted refs.
   */
  function fireSideEffects(userId: string, vid: string) {
    const steps: { tag: string; run: () => Promise<unknown> }[] = [
      { tag: "maintenance_logs", run: () => queryClient.invalidateQueries({ queryKey: ["maintenance_logs", vid] }) },
      { tag: "vehicle", run: () => queryClient.invalidateQueries({ queryKey: ["vehicle", vid] }) },
      { tag: "user_vehicle_maintenance_tasks", run: () => queryClient.invalidateQueries({ queryKey: ["user_vehicle_maintenance_tasks", vid] }) },
      { tag: "vehicles", run: () => queryClient.invalidateQueries({ queryKey: ["vehicles"] }) },
      { tag: "mileage_vehicles", run: () => queryClient.invalidateQueries({ queryKey: ["mileage_vehicles"] }) },
      { tag: "dashboard", run: () => queryClient.invalidateQueries({ queryKey: ["dashboard"] }) },
      { tag: "reschedule", run: () => scheduleMaintenanceNotifications(userId) },
    ];
    for (const step of steps) {
      try {
        Promise.resolve(step.run()).catch(stepErr => {
          Sentry.captureException(stepErr, { tags: { area: "log_service_p3" }, extra: { step: step.tag, vehicleId: vid } });
        });
      } catch (stepErr) {
        Sentry.captureException(stepErr, { tags: { area: "log_service_p3" }, extra: { step: step.tag, vehicleId: vid } });
      }
    }
  }

  /**
   * One completion against complete_vehicle_task v6.
   *
   * A thrown or transport-level result is UNKNOWN, never "failed" - the write
   * may well have landed, and claiming otherwise would invite a duplicate. One
   * automatic same-id retry runs first; the operation id is stable per item, so
   * a replay is idempotent rather than a second advance. idempotency_mismatch
   * and explicit_date_required are hard failures: the request itself was wrong,
   * so retrying would only repeat it.
   */
  async function completeOne(
    item: PendingSaveItem,
    taskId: string,
    taskName: string,
    explicit: boolean,
    rec: PendingSaveRecord,
  ): Promise<CompletionOutcome> {
    // A carried item completes against ITS OWN save's date and meters - the
    // values stamped when its record was first written - never the values of
    // the save that happened to carry it. The operation id is stable, so a
    // replay must present identical arguments.
    const itemDate = item.completedDate ?? rec.completedDate;
    const itemMiles = item.milesVal !== undefined ? item.milesVal : rec.milesVal;
    const itemHours = item.hoursVal !== undefined ? item.hoursVal : rec.hoursVal;
    const args: CompleteVehicleTaskIdempotentArgs = {
      p_task_id: taskId,
      p_operation_id: item.opId,
      p_completed_date: itemDate,
      p_skip_log: true,
    };
    if (itemMiles != null && Number.isFinite(itemMiles)) args.p_mileage = itemMiles;
    if (itemHours != null && Number.isFinite(itemHours)) args.p_hours = itemHours;

    async function attempt() {
      try {
        const { data, error: rpcErr } = await completeVehicleTaskIdempotent(args);
        if (rpcErr || !data) return null;
        return data;
      } catch {
        return null;
      }
    }

    let result = await attempt();
    if (!result) {
      await sleep(AUTO_RETRY_DELAY_MS);
      result = await attempt();
    }
    if (!result) return { kind: "unknown", taskId, taskName, explicit };

    if (typeof result !== "object" || Array.isArray(result)) {
      // Not an object. Nothing can be read off it, including with `in`.
      Sentry.captureException(new Error("complete_vehicle_task non-object payload"), {
        tags: { area: "log_service_completion", arm: "non_object" },
        extra: { taskId, operationId: item.opId, serviceName: item.serviceName },
      });
      return { kind: "unknown", taskId, taskName, explicit };
    }

    if ("error" in result) {
      // Only these two arms are definitive rejections. Any other error value is
      // a shape we do not understand, and an unrecognised response is not proof
      // the write failed - calling it "failed" would deny a write that may have
      // landed.
      const hard = result.error === "idempotency_mismatch" || result.error === "explicit_date_required";
      Sentry.captureException(new Error(`complete_vehicle_task ${String(result.error)}`), {
        tags: { area: "log_service_completion", arm: hard ? String(result.error) : "unrecognised_error" },
        extra: { taskId, operationId: item.opId, serviceName: item.serviceName },
      });
      if (hard) return { kind: "failed", taskId, taskName, explicit };
      return { kind: "unknown", taskId, taskName, explicit };
    }
    if (
      typeof result.completion_event_id !== "string" ||
      result.completion_event_id.length === 0 ||
      (result.event_status !== "applied" && result.event_status !== "undone") ||
      !result.applied ||
      typeof result.applied !== "object"
    ) {
      // Shape we cannot trust. Claiming a completion here would put an
      // unusable id into the undo batch; claiming a failure would deny a write
      // that may have landed. Unknown is the only honest answer.
      Sentry.captureException(new Error("complete_vehicle_task malformed payload"), {
        tags: { area: "log_service_completion", arm: "malformed" },
        extra: { taskId, operationId: item.opId, serviceName: item.serviceName },
      });
      return { kind: "unknown", taskId, taskName, explicit };
    }
    if (result.event_status === "undone") {
      return { kind: "consumed_undone", taskId, taskName };
    }
    return {
      kind: "completed",
      taskId,
      taskName,
      eventId: result.completion_event_id,
      nextDue: formatNextDue(result.applied),
    };
  }

  /**
   * One REVIEW confirmation. Retry reuses the same task and the same operation
   * id. Continuing AFTER an attempt keeps that attempt's outcome - the user was
   * told something was tried - while continuing without attempting returns null
   * and is disclosed as a review count instead.
   */
  async function runPicker(
    item: PendingSaveItem,
    candidates: MatchCandidate[],
    rec: PendingSaveRecord,
    persistBinding: (bound: PendingSaveItem) => Promise<boolean>,
  ): Promise<CompletionOutcome | null> {
    setPickerService(item.serviceName);
    setPickerCandidates(candidates);
    setPickerError(null);
    setPickerBusy(false);
    setPickerWorkingTaskId(null);
    lastPickRef.current = null;
    setPickerLockedTaskId(null);
    pickerOpenRef.current = true;
    pickerDismissAckRef.current = null;
    setPickerRequest(n => n + 1);

    let settled: CompletionOutcome | null = null;
    let lastAttempt: CompletionOutcome | null = null;

    for (;;) {
      const answer = await waitForPickerAnswer();
      if (answer.kind === "skip") break;

      lastPickRef.current = { taskId: answer.taskId, taskName: answer.taskName };
      setPickerBusy(true);
      setPickerWorkingTaskId(answer.taskId);
      setPickerError(null);

      const bound = { ...item, directTaskId: answer.taskId, directTaskName: answer.taskName };
      const durable = await persistBinding(bound);
      if (!durable) {
        // No durable binding, no RPC - same write-ahead rule as the auto
        // path. The user can try the same task again or skip; skipping is a
        // disclosed decision.
        Sentry.captureMessage("log_service binding unpersisted", {
          tags: { area: "log_service_recovery", arm: "binding_unpersisted" },
          extra: { vehicleId, decision: "picker" },
        });
        setPickerBusy(false);
        setPickerWorkingTaskId(null);
        setPickerError("Couldn't start that update safely. Try again or skip.");
        continue;
      }
      const outcome = await completeOne(bound, answer.taskId, answer.taskName, true, rec);

      setPickerBusy(false);
      setPickerWorkingTaskId(null);

      if (outcome.kind === "failed") {
        // Hard rejection - the identical request would be rejected identically.
        // It goes straight to the outcome list; the toast names it.
        lastAttempt = outcome;
        break;
      }
      if (outcome.kind === "unknown") {
        // The write may have landed. Retrying the SAME task replays one
        // idempotency key; choosing another task would mint a second one and
        // could complete two tasks from one item, with the first invisible to
        // both the outcome list and undo.
        lastAttempt = outcome;
        setPickerLockedTaskId(answer.taskId);
        setPickerError("We couldn't confirm that update. Try again, or continue and check Tasks.");
        continue;
      }
      settled = outcome;
      break;
    }

    // Only close a sheet that is still open, and only while awaiting that exact
    // close. If the user already dismissed it there is nothing to ask for -
    // asking anyway is what let a straggling event answer for the next item.
    if (pickerOpenRef.current) {
      pickerOpenRef.current = false;
      await new Promise<void>(resolve => {
        pickerDismissAckRef.current = resolve;
        pickerRef.current?.dismiss();
      });
    }
    return settled ?? lastAttempt;
  }

  /**
   * Attach-by-hand for a save whose only item matched no tracked task. Runs
   * the SAME confirmation machinery as a REVIEW - write-ahead binding, the
   * item's stable operation id, the unknown-retry lock - against the full
   * task list. The log is already committed; this only updates the chosen
   * task.
   */
  async function runAttachFlow() {
    const ctx = attachCtxRef.current;
    attachCtxRef.current = null;
    if (!ctx || !user || !vehicleId) return;
    const userId = user.id;
    const vid = vehicleId;
    const attachRec: PendingSaveRecord = { ...ctx.rec, items: [ctx.item] };
    let attachItems = attachRec.items;
    async function persistAttachBinding(bound: PendingSaveItem): Promise<boolean> {
      attachItems = rebindItem(attachItems, bound);
      const next: PendingSaveRecord = { ...attachRec, items: attachItems };
      const landed = (await writePendingSave(userId, vid, next)) || (await writePendingSave(userId, vid, next));
      if (!landed) {
        Sentry.captureMessage("log_service binding unpersisted", {
          tags: { area: "log_service_recovery", arm: "binding_unpersisted" },
          extra: { vehicleId: vid, decision: "attach" },
        });
      }
      return landed;
    }
    const candidates: MatchCandidate[] = ctx.tasks.map(t => ({
      taskId: t.id,
      taskName: t.name,
      score: 0,
      component: null,
      action: null,
    }));
    setPickerMode("attach");
    const outcome = await runPicker(ctx.item, candidates, attachRec, persistAttachBinding);
    setPickerMode("match");
    if (outcome && outcome.kind === "unknown") {
      // The write may have landed. The bound record stays durable so the next
      // open replays the SAME task deterministically; the loss is disclosed.
      fireSuccessToast(ctx.item.serviceName + " logged", "Couldn't confirm " + outcome.taskName + ". Check Tasks.", true);
      setTimeout(() => router.back(), BACK_NAV_SAVE_MS);
      return;
    }
    if (outcome || attachItems !== attachRec.items) {
      // A settled decision - completed or hard-failed - or a written binding
      // whose attempt the user then abandoned must not resurrect as a resume.
      // Clear; on a failed clear, overwrite with an empty defused image, which
      // parses back as no record.
      const cleared = await clearPendingSave(userId, vid);
      if (!cleared) {
        const empty: PendingSaveRecord = { ...attachRec, items: [] };
        const defusedOk = (await writePendingSave(userId, vid, defusePendingSave(empty, Date.now())))
          || (await writePendingSave(userId, vid, defusePendingSave(empty, Date.now())));
        if (!defusedOk) {
          Sentry.captureMessage("log_service settled clear unpersisted", {
            tags: { area: "log_service_recovery", arm: "settled_clear_unpersisted" },
            extra: { vehicleId: vid, attach: true },
          });
        }
      }
    }
    if (outcome && outcome.kind === "completed") {
      const eventIds = [outcome.eventId];
      showUndoToast({
        message: outcome.taskName + " marked complete",
        subtitle: outcome.nextDue ?? undefined,
        onUndo: async () => {
          try {
            const { data, error: undoErr } = await undoVehicleCompletions(eventIds);
            if (undoErr || !data) return { ok: false, message: "Couldn't undo. Check your connection." };
            if (data.ok) {
              fireSideEffects(userId, vid);
              return { ok: true };
            }
            if (data.error === "conflict") return { ok: false, message: "That task changed since you saved. Check Tasks." };
            if (data.error === "not_found") return { ok: false, message: "Those updates are no longer available to undo." };
            return { ok: false, message: "Couldn't undo. Please try again." };
          } catch {
            return { ok: false, message: "Couldn't undo. Check your connection." };
          }
        },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      fireSideEffects(userId, vid);
      setTimeout(() => router.back(), BACK_NAV_UNDO_MS);
      return;
    }
    if (outcome && outcome.kind === "failed") {
      fireSuccessToast(ctx.item.serviceName + " logged", "Couldn't update " + outcome.taskName + ". Check Tasks.", true);
      setTimeout(() => router.back(), BACK_NAV_SAVE_MS);
      return;
    }
    // consumed_undone cannot occur here - a NONE item's operation was never
    // consumed - and a skip is a decision: the log is saved, leave quietly.
    router.back();
  }

  function handleAttachPress() {
    if (attachNavTimerRef.current) {
      clearTimeout(attachNavTimerRef.current);
      attachNavTimerRef.current = null;
    }
    setAttachToastVisible(false);
    Haptics.selectionAsync().catch(() => {});
    void runAttachFlow();
  }

  /**
   * P2 through P5 for a record that has already committed. A fresh save and a
   * resume both land here, so the two paths are identical by construction
   * rather than by discipline.
   */
  async function runSaveFlow(rec: PendingSaveRecord, receiptFailed: boolean, isResume: boolean, holdKeys: ReadonlySet<string>) {
    if (!user || !vehicleId) return;
    const userId = user.id;
    const vid = vehicleId;

    const outcomes: CompletionOutcome[] = [];
    /**
     * Items whose adjudication is still open - unknown writes and items never
     * matched at all - carried forward so a transient outage cannot erase
     * replay intent. Every settled outcome stays out: completed, hard-failed,
     * consumed, skipped, and disclosed review drops are decisions, not losses.
     */
    const kept: PendingSaveItem[] = [];
    let durableItems = rec.items.slice();
    /**
     * Write-ahead binding. A match-derived completion may only run AFTER the
     * chosen task is durable on the item: if the process dies mid-RPC, the
     * next resume replays the SAME task deterministically instead of matching
     * again - a second pass could choose a different task and advance both
     * tasks under one operation id.
     */
    async function persistItemBinding(bound: PendingSaveItem): Promise<boolean> {
      durableItems = rebindItem(durableItems, bound);
      const next: PendingSaveRecord = { ...rec, items: durableItems };
      return (await writePendingSave(userId, vid, next)) || (await writePendingSave(userId, vid, next));
    }
    /**
     * Settle checkpoint. A decided item leaves the durable image immediately,
     * so neither a crash nor a failed final write can resurrect settled or
     * declined work. An empty image serializes to a row the total parser
     * rejects, which reads back as no record - clear-by-overwrite. Failures
     * are non-gating: the end-of-flow rewrite is the catch-all, and each miss
     * is reported.
     */
    async function settleDurable(itemKey: string): Promise<void> {
      durableItems = settleItem(durableItems, itemKey);
      const next: PendingSaveRecord = { ...rec, items: durableItems };
      const landed = (await writePendingSave(userId, vid, next)) || (await writePendingSave(userId, vid, next));
      if (!landed) {
        Sentry.captureMessage("log_service checkpoint unpersisted", {
          tags: { area: "log_service_recovery", arm: "checkpoint_unpersisted" },
          extra: { vehicleId: vid, itemKey },
        });
      }
    }
    let droppedReviewCount = 0;
    let matchingUnavailable = false;
    const noneItems: PendingSaveItem[] = [];

    // Direct bindings resolve BEFORE the task fetch. A chip tap already carries
    // the task identity, so a matcher or fetch outage cannot cost the user a
    // completion they explicitly chose.
    const unbound: PendingSaveItem[] = [];
    for (const item of rec.items) {
      if (holdKeys.has(item.itemKey)) {
        // Discovered at save time, outside the silent window, never confirmed
        // this session. Preserved for the next open's ask - not executed
        // behind the user's back.
        kept.push(item);
        continue;
      }
      if (item.directTaskId && item.directTaskName) {
        const outcome = await completeOne(item, item.directTaskId, item.directTaskName, true, rec);
        outcomes.push(outcome);
        if (outcome.kind === "unknown") kept.push(item);
        else await settleDurable(item.itemKey);
      } else {
        unbound.push(item);
      }
    }

    let tasks: TaskChip[] | null = null;
    if (unbound.length > 0) {
      try {
        const { data, error: taskErr } = await supabase
          .from("user_vehicle_maintenance_tasks")
          .select("id, name")
          .eq("vehicle_id", vid)
          .eq("user_id", userId)
          .order("name");
        if (taskErr) throw taskErr;
        tasks = (data ?? [])
          .filter(row => typeof row.name === "string" && row.name.trim().length > 0)
          .map(row => ({ id: row.id, name: row.name.trim() }));
        if (tasks.length === 0) {
          // Zero rows for a vehicle is anomalous - the schedule guarantees a
          // floor of required tasks - so this is an unavailable matcher, not a
          // genuine everything-maps-to-nothing result.
          matchingUnavailable = true;
          tasks = null;
          Sentry.captureMessage("log_service task fetch zero rows", {
            tags: { area: "log_service_task_fetch", arm: "zero_rows" },
            extra: { vehicleId: vid },
          });
        }
      } catch (taskErr) {
        // Caught on its own: this costs matching and confirmation only. P3, P4
        // and P5 still run, and the loss is disclosed rather than swallowed.
        matchingUnavailable = true;
        tasks = null;
        Sentry.captureException(taskErr, { tags: { area: "log_service_task_fetch" }, extra: { vehicleId: vid } });
      }
    }

    // A resume can run before the vehicle read lands, and vehicle_type is the
    // matcher's only hint. Resolve it on demand rather than match without it.
    let ownerType = vehicleType;
    if (tasks && ownerType == null) {
      try {
        const { data } = await supabase
          .from("vehicles")
          .select("vehicle_type")
          .eq("id", vid)
          .maybeSingle();
        if (data && typeof data.vehicle_type === "string") ownerType = data.vehicle_type;
      } catch {
        // Hint only. Matching proceeds without it.
      }
    }

    if (tasks) {
      const reviews: { item: PendingSaveItem; candidates: MatchCandidate[] }[] = [];
      for (const item of unbound) {
        const match = matchServiceToTask(item.serviceName, tasks, ownerType);
        if (match.decision === "AUTO" && match.task) {
          const bound = { ...item, directTaskId: match.task.taskId, directTaskName: match.task.taskName };
          const durable = await persistItemBinding(bound);
          if (!durable) {
            // No durable binding, no RPC: an unexecuted item cannot
            // double-advance. Preserved in memory; the end-of-flow ladder
            // retries persistence, and disclosure covers the rest.
            Sentry.captureMessage("log_service binding unpersisted", {
              tags: { area: "log_service_recovery", arm: "binding_unpersisted" },
              extra: { vehicleId: vid, decision: "auto" },
            });
            droppedReviewCount++;
            kept.push(bound);
          } else {
            const outcome = await completeOne(bound, match.task.taskId, match.task.taskName, false, rec);
            outcomes.push(outcome);
            if (outcome.kind === "unknown") kept.push(bound);
            else await settleDurable(bound.itemKey);
          }
        } else if (match.decision === "REVIEW") {
          // A REVIEW with nothing to choose from is not a question worth asking.
          if (match.candidates.length === 0) {
            droppedReviewCount++;
            await settleDurable(item.itemKey);
          } else {
            reviews.push({ item, candidates: match.candidates });
          }
        } else {
          // NONE is not a loss: the service genuinely maps to no tracked
          // task. It is decided, so it leaves the durable image now. Retained
          // in memory so a clean save can disclose it - and, when it is the
          // only one, offer to attach it by hand.
          noneItems.push(item);
          await settleDurable(item.itemKey);
        }
      }
      for (let i = 0; i < reviews.length; i++) {
        if (i >= MAX_PICKERS_PER_SAVE) {
          droppedReviewCount++;
          await settleDurable(reviews[i].item.itemKey);
          continue;
        }
        const outcome = await runPicker(reviews[i].item, reviews[i].candidates, rec, persistItemBinding);
        if (outcome) {
          outcomes.push(outcome);
          if (outcome.kind === "unknown") {
            kept.push({ ...reviews[i].item, directTaskId: outcome.taskId, directTaskName: outcome.taskName });
          } else {
            await settleDurable(reviews[i].item.itemKey);
          }
        } else {
          droppedReviewCount++;
          await settleDurable(reviews[i].item.itemKey);
        }
      }
    }

    if (tasks === null && unbound.length > 0) {
      // Never matched at all. These items carry forward exactly as written so
      // a later open can adjudicate them for real.
      for (const item of unbound) kept.push(item);
    }

    // The record is rewritten down to the still-open remainder. Clearing with
    // open items would forfeit the replay guarantee; keeping settled items
    // would resume finished work. An empty remainder clears.
    const remainder = rewritePendingRemainder(rec, kept);
    pendingRemainderRef.current = remainder;
    priorAdjudicatedRef.current = true;
    if (remainder) {
      const wrote = (await writePendingSave(userId, vid, remainder))
        || (await writePendingSave(userId, vid, remainder));
      if (wrote) {
        Sentry.captureMessage("log_service remainder preserved", {
          tags: { area: "log_service_recovery", arm: "remainder_preserved" },
          extra: { vehicleId: vid, itemCount: remainder.items.length, isResume },
        });
      } else {
        // The disk still holds the last durable image. Write-ahead binding
        // guarantees every attempted item is bound there, and settle
        // checkpoints removed decided items as they settled - so what
        // survives is the reduced remainder up to any checkpoint that itself
        // failed (each miss is reported). Clearing would erase open unknown
        // outcomes.
        Sentry.captureMessage("log_service remainder write failed", {
          tags: { area: "log_service_recovery", arm: "remainder_write_failed_stuck" },
          extra: { vehicleId: vid, itemCount: remainder.items.length, isResume },
        });
      }
    } else {
      const cleared = await clearPendingSave(userId, vid);
      if (!cleared) {
        // Overwrite with the defused CURRENT durable image, never the original
        // rec - restoring rec would strip write-ahead bindings and reopen the
        // second-matching-pass hazard. With checkpoints the image is usually
        // already empty, and an empty image reads back as no record.
        const walImage: PendingSaveRecord = { ...rec, items: durableItems };
        const defusedOk = (await writePendingSave(userId, vid, defusePendingSave(walImage, Date.now())))
          || (await writePendingSave(userId, vid, defusePendingSave(walImage, Date.now())));
        if (!defusedOk) {
          Sentry.captureMessage("log_service settled clear unpersisted", {
            tags: { area: "log_service_recovery", arm: "settled_clear_unpersisted" },
            extra: { vehicleId: vid },
          });
        }
      }
    }

    fireSideEffects(userId, vid);

    const plan = planToast({
      outcomes,
      receiptFailed,
      droppedReviewCount,
      matchingUnavailable,
      noneCount: noneItems.length,
      firstServiceName: rec.items[0]?.serviceName ?? "Service",
    });

    if (plan.kind === "undo") {
      const eventIds = plan.eventIds;
      showUndoToast({
        message: plan.message,
        subtitle: plan.subtitle,
        onUndo: async () => {
          try {
            const { data, error: undoErr } = await undoVehicleCompletions(eventIds);
            if (undoErr || !data) return { ok: false, message: "Couldn't undo. Check your connection." };
            if (data.ok) {
              // Resolve on the server's answer. The host races onUndo against a
              // 10s timeout, so awaiting the rerun could report a real undo as a
              // failure.
              fireSideEffects(userId, vid);
              return { ok: true };
            }
            if (data.error === "conflict") return { ok: false, message: "That task changed since you saved. Check Tasks." };
            if (data.error === "not_found") return { ok: false, message: "Those updates are no longer available to undo." };
            return { ok: false, message: "Couldn't undo. Please try again." };
          } catch {
            return { ok: false, message: "Couldn't undo. Check your connection." };
          }
        },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (isResume && remainder) {
        // A resume still holding open items hands the screen back instead of
        // ejecting - an eject here replays a doomed open-fail-exit loop.
        savingRef.current = false;
        setPhase("editing");
      } else {
        setTimeout(() => router.back(), BACK_NAV_UNDO_MS);
      }
    } else if (plan.offerAttach && remainder === null && tasks && tasks.length > 0 && noneItems.length === 1 && !isResume) {
      // The one thing that happened is a service that maps to no tracked task.
      // The toast tells that truth and offers to attach it by hand; the screen
      // holds until the offer is answered or expires. Success haptic - nothing
      // failed.
      attachCtxRef.current = { item: noneItems[0], rec, tasks };
      setSuccessToastTitle(plan.message);
      setSuccessToastSubtitle(plan.subtitle);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setAttachToastVisible(true);
      attachNavTimerRef.current = setTimeout(() => {
        attachNavTimerRef.current = null;
        attachCtxRef.current = null;
        setAttachToastVisible(false);
        setTimeout(() => router.back(), 220);
      }, ATTACH_TOAST_MS);
    } else {
      // planToast only reaches this arm with zero confirmed completions. A
      // material-fact subtitle warns; a NONE disclosure is informational and
      // keeps the success haptic - nothing failed.
      fireSuccessToast(plan.message, plan.subtitle, !!plan.subtitle && !plan.noneDisclosed);
      if (isResume && remainder) {
        savingRef.current = false;
        setPhase("editing");
      } else {
        setTimeout(() => router.back(), plan.subtitle ? BACK_NAV_SAVE_MS : BACK_NAV_UNDO_MS);
      }
    }
  }

  async function handleSave() {
    if (locked || savingRef.current) return;
    if (!user || !vehicleId) return;
    savingRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    // The lock is taken at the SAVE TAP, before any await. Only a pre-commit
    // validation stop gives it back.
    setPhase("saving");
    setError(null);
    setReceiptWarning(false);

    const validItems = scannedItems.filter(item => item.name.trim().length > 0);
    if (scannedItems.length > 0 && validItems.length === 0) {
      setError("Please add a name for at least one service");
      savingRef.current = false;
      setPhase("editing");
      return;
    }
    if (scannedItems.length === 0 && !task.trim()) {
      setError("Service description is required");
      savingRef.current = false;
      setPhase("editing");
      return;
    }

    let milesVal: number | null = null;
    let hoursVal: number | null = null;
    if (usageMode === "both") {
      if (mileage.trim()) milesVal = parseInt(mileage.replace(/,/g, ""), 10);
      if (hoursReading.trim()) hoursVal = parseFloat(hoursReading.replace(/,/g, ""));
    } else if (usageMode === "hours") {
      if (mileage.trim()) hoursVal = parseFloat(mileage.replace(/,/g, ""));
    } else if (usageMode === "mileage") {
      if (mileage.trim()) milesVal = parseInt(mileage.replace(/,/g, ""), 10);
    }
    // An unparseable reading is no reading. It must not reach the durable record
    // as NaN, where it would round-trip through JSON as a silent null anyway.
    if (milesVal != null && !Number.isFinite(milesVal)) milesVal = null;
    if (hoursVal != null && !Number.isFinite(hoursVal)) hoursVal = null;
    const logMeter = milesVal ?? hoursVal ?? null;
    const completedDate = date || new Date().toISOString().split("T")[0];

    let storedReceiptPath: string | null = null;
    let receiptFailed = false;
    receiptShaRef.current = null;
    if (receiptLocalUri) {
      storedReceiptPath = await uploadReceiptImage(receiptLocalUri, user.id, vehicleId);
      if (!storedReceiptPath) {
        receiptFailed = true;
        setReceiptWarning(true);
      }
    }

    // P1. The insert is the commit point.
    try {
      if (scannedItems.length > 0) {
        const rows = validItems.map(item => ({
          user_id: user.id,
          vehicle_id: vehicleId,
          service_name: item.name.trim(),
          service_date: completedDate,
          mileage: logMeter,
          cost: item.cost,
          provider_name: provider.trim() || null,
          notes: item.details || null,
          receipt_url: storedReceiptPath,
          // Verification capture. The hash describes the stored bytes, so it is
          // carried only when a receipt actually landed. Source stays null: the
          // camera/library choice lives inside the scan button and never reaches
          // this write site, and an unknown origin is recorded, never guessed.
          receipt_sha256: storedReceiptPath ? receiptShaRef.current : null,
          receipt_source: null,
          client_logged_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));
        const { error: insertErr } = await supabase.from("maintenance_logs").insert(rows);
        if (insertErr) throw insertErr;
      } else {
        const parsedCost = cost.trim() ? parseFloat(cost.replace(/,/g, "")) : null;
        const { error: insertErr } = await supabase.from("maintenance_logs").insert({
          user_id: user.id,
          vehicle_id: vehicleId,
          service_name: task.trim(),
          service_date: completedDate,
          mileage: logMeter,
          cost: parsedCost != null && Number.isFinite(parsedCost) ? parsedCost : null,
          provider_name: provider.trim() || null,
          notes: notes.trim() || null,
          receipt_url: storedReceiptPath,
          receipt_sha256: storedReceiptPath ? receiptShaRef.current : null,
          receipt_source: null,
          client_logged_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        if (insertErr) throw insertErr;
      }
    } catch (insertErr) {
      // Nothing committed. This is the ONLY path back to an editable screen.
      Sentry.captureException(insertErr, { tags: { area: "log_service_commit" }, extra: { vehicleId } });
      setError("Couldn't save that just now. Please try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      savingRef.current = false;
      setPhase("editing");
      return;
    }

    // COMMITTED. The screen is terminal from here: it reports and exits. A
    // failed receipt is now a committed outcome carried by the outcome list, not
    // a reason to hand back an editable form that would log the service twice.
    const names = scannedItems.length > 0 ? validItems.map(item => item.name.trim()) : [task.trim()];
    const items: PendingSaveItem[] = names.map((name, index) => {
      const entry: PendingSaveItem = { itemKey: `item:${index}`, serviceName: name, opId: newOperationId() };
      if (index === 0 && scannedItems.length === 0 && directTask && directTask.name === name) {
        entry.directTaskId = directTask.id;
        entry.directTaskName = directTask.name;
      }
      return entry;
    });
    // A prior remainder for this vehicle is folded into the new record rather
    // than clobbered - overwriting it would erase the replay intent the
    // recovery path just preserved. The in-memory shadow is consulted first,
    // so a failed storage read cannot masquerade as "no remainder"; the disk
    // read is the fallback for a remainder this session never saw. Carried
    // items keep their opIds and their own completion arguments, and the
    // merged record keeps the OLDEST anchor so stale carried work ages into
    // the confirm path instead of regaining a silent-resume window.
    // Three-state prior resolution. Once this session adjudicated, the shadow
    // is authoritative - including "none" after a discard, where a disk
    // fallback could resurrect the very record the user removed. The disk is
    // consulted only for a prior this session genuinely never observed.
    const prior = priorAdjudicatedRef.current
      ? pendingRemainderRef.current
      : await readPendingSave(user.id, vehicleId);
    const carried = mergeCarriedItems(prior, items);
    // A stale prior this session never adjudicated is carried but HELD: its
    // items skip execution and land in the remainder under the original
    // anchor, so the next open runs the standard confirmation ask for them.
    const holdKeys = new Set<string>();
    if (saveTimePriorNeedsHold(prior, priorAdjudicatedRef.current, Date.now())) {
      for (let i = items.length; i < carried.length; i++) holdKeys.add(carried[i].itemKey);
    }
    const rec: PendingSaveRecord = {
      v: 1,
      createdAt: carriedCreatedAt(prior, Date.now()),
      completedDate,
      milesVal,
      hoursVal,
      receiptPath: storedReceiptPath,
      items: carried,
    };
    // Written post-commit, so its existence always means exactly one thing: the
    // log landed and the task updates may not have. The write is observed with
    // one bounded retry: if it cannot land, this run still executes from the
    // in-memory record, and the store has already reported the failure.
    const recorded = (await writePendingSave(user.id, vehicleId, rec))
      || (await writePendingSave(user.id, vehicleId, rec));

    // The odometer write is non-blocking - it can never make a committed log
    // look failed, and completions carry their own meter values.
    Promise.resolve(
      updateVehicleUsage(
        vehicleId,
        milesVal,
        hoursVal,
        date || new Date().toISOString(),
        vehicleData?.mileage ?? null,
        vehicleData?.hours ?? null,
      ),
    ).catch(usageErr => {
      Sentry.captureException(usageErr, { tags: { area: "log_service_usage" }, extra: { vehicleId } });
    });

    if (!recorded) {
      // Task mutations without a durable record are unrecoverable on process
      // death: no replay, no adjudication, silent partial completion. The log
      // itself is committed and disclosed; the updates are matched from Tasks.
      Sentry.captureMessage("log_service initial record unpersisted", {
        tags: { area: "log_service_recovery", arm: "initial_record_unpersisted" },
        extra: { vehicleId, itemCount: rec.items.length },
      });
      fireSuccessToast("Service logged.", "Couldn't start task updates safely. Match them from Tasks.", true);
      setTimeout(() => router.back(), BACK_NAV_SAVE_MS);
      return;
    }
    await runSaveFlow(rec, receiptFailed, false, holdKeys);
  }

  function handleResumeContinue() {
    if (!resumeAsk || savingRef.current) return;
    savingRef.current = true;
    const rec = resumeAsk.rec;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setResumeAsk(null);
    setPhase("saving");
    void runSaveFlow(rec, false, true, new Set<string>());
  }

  async function handleResumeDiscard() {
    // Same synchronous guard as Continue: two taps in one frame must not both
    // win, or a discard could unlock the screen while a resume is running.
    if (!user || !vehicleId || savingRef.current) return;
    savingRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // Overlay goes first so the buttons cannot be tapped again behind the await.
    setResumeAsk(null);
    // Clears only the recovery record. The logged service itself is untouched.
    const cleared = await clearPendingSave(user.id, vehicleId);
    if (!cleared && resumeAsk) {
      // A failed removal leaves a zombie row a LATER mount would read fresh.
      // Defusing rewrites it with an anchor past the silent window, so the
      // worst outcome of broken storage is one extra ask - never a silent
      // replay of items the user explicitly discarded. The write is observed
      // and retried; if neither removal nor defusing lands, the decision is
      // honored for this session and the gap is DISCLOSED, not papered over.
      const defused = (await writePendingSave(user.id, vehicleId, defusePendingSave(resumeAsk.rec, Date.now())))
        || (await writePendingSave(user.id, vehicleId, defusePendingSave(resumeAsk.rec, Date.now())));
      if (!defused) {
        Sentry.captureMessage("log_service discard unpersisted", {
          tags: { area: "log_service_recovery", arm: "discard_unpersisted" },
          extra: { vehicleId },
        });
        setError("Couldn't discard those earlier updates. They may still apply automatically next time.");
      }
    }
    // The user's decision IS the adjudication, whether or not the storage
    // clear landed. Session truth is now "no remainder": the save path will
    // not fall back to disk and resurrect a discarded record, and a fresh
    // save's write replaces any zombie row a failed clear left behind.
    pendingRemainderRef.current = null;
    priorAdjudicatedRef.current = true;
    savingRef.current = false;
    setPhase("editing");
  }

  return (
    <BottomSheetModalProvider>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.container, { backgroundColor: Colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.closeBtn, { opacity: locked ? 0.35 : pressed ? 0.6 : 1 }]}
            disabled={locked}
            accessibilityRole="button"
            accessibilityLabel="Close"
            accessibilityState={{ disabled: locked }}
          >
            <Ionicons name="close" size={22} color={Colors.text} />
          </Pressable>
          <Text style={styles.title}>Log Service</Text>
          <Pressable
            style={({ pressed }) => [styles.saveBtn, { opacity: pressed || locked ? 0.8 : 1 }]}
            onPress={handleSave}
            disabled={locked}
            accessibilityRole="button"
            accessibilityLabel="Log service"
            accessibilityState={{ disabled: locked, busy: phase === "saving" }}
          >
            {phase === "saving" ? <ActivityIndicator size="small" color={Colors.textInverse} /> : <Text style={styles.saveBtnText}>Log Service</Text>}
          </Pressable>
        </View>

        <ScrollView
          ref={scrollRef}
          pointerEvents={locked ? "none" : "auto"}
          style={phase === "saving" ? styles.scrollLocked : undefined}
          onScroll={e => { scrollOffset.current = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={Colors.overdue} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Tooltip
            id={TOOLTIP_IDS.LOG_SERVICE_INTRO}
            message="Log a service manually, or tap the camera icon to scan a receipt and we'll fill everything in."
            icon="scan-outline"
            delay={500}
          />

          <View style={styles.fieldGroup}>
            <Text style={styles.groupLabel}>Receipt</Text>
            {ocrApplied ? (
              <View style={styles.ocrSuccess}>
                <Ionicons name="checkmark-circle" size={14} color={Colors.good} />
                <Text style={styles.ocrSuccessText}>Receipt scanned. Fields auto-filled below.</Text>
              </View>
            ) : null}

            {mismatchInfo ? (
              <View style={styles.mismatchCard}>
                <Ionicons name="alert-circle" size={16} color={Colors.dueSoon} style={{ marginTop: 1 }} />
                <View style={{ flex: 1, gap: 10 }}>
                  <Text style={styles.mismatchText}>
                    This receipt looks like it's for a {mismatchInfo.description} — not your {vehicleData?.nickname || [vehicleData?.year, vehicleData?.make, vehicleData?.model].filter(Boolean).join(" ") || "this vehicle"}.
                  </Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Pressable style={({ pressed }) => [styles.mismatchBtn, { opacity: pressed ? 0.8 : 1 }]} onPress={handleMismatchUseAnyway}>
                      <Text style={styles.mismatchBtnText}>Use anyway</Text>
                    </Pressable>
                    <Pressable style={({ pressed }) => [styles.mismatchBtnGhost, { opacity: pressed ? 0.8 : 1 }]} onPress={handleMismatchDiscard}>
                      <Text style={styles.mismatchBtnGhostText}>Discard</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ) : null}

            {isFreeTier(profile) ? (
              <Pressable
                style={styles.scanGateBtn}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setShowPaywall(true);
                }}
              >
                <Ionicons name="camera-outline" size={16} color={Colors.accent} />
                <Text style={styles.scanGateBtnText}>Scan Receipt</Text>
                <View style={styles.scanLockedBadge}>
                  <Ionicons name="lock-closed" size={10} color={Colors.textInverse} />
                  <Text style={styles.scanLockedText}>Upgrade</Text>
                </View>
              </Pressable>
            ) : (
              <ReceiptScanButton
                assetType="vehicle"
                assetId={vehicleId}
                onScanComplete={handleScanComplete}
                onScanLimitReached={() => setShowPaywall(true)}
                onPaidUserAtCap={() => {
                  const opened = scanPackModalRef.current?.present();
                  if (!opened) {
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
                    setScanPackOpenErrorVisible(true);
                    setTimeout(() => setScanPackOpenErrorVisible(false), 2800);
                  }
                }}
              />
            )}
          </View>

          {scannedItems.length > 0 && (
            <View style={styles.fieldGroup}>
              <Text style={styles.groupLabel}>Services ({scannedItems.length})</Text>

              {scannedItems.map((item, index) => (
                <View key={index} style={styles.itemRow}>
                  <View style={styles.itemLeft}>
                    {editingField?.index === index && editingField?.field === "name" ? (
                      <TextInput
                        autoFocus
                        style={styles.itemEditInput}
                        value={item.name}
                        onChangeText={text => updateItem(index, { name: text })}
                        onBlur={() => setEditingField(null)}
                        returnKeyType="done"
                        onSubmitEditing={() => setEditingField(null)}
                        placeholderTextColor={Colors.textTertiary}
                        placeholder="Service name"
                      />
                    ) : (
                      <Pressable onPress={() => { setEditingField({ index, field: "name" }); Haptics.selectionAsync(); }}>
                        <Text style={styles.itemName}>{item.name || "Tap to name"}</Text>
                        {item.details && (
                          <Text style={styles.itemDetails}>{item.details}</Text>
                        )}
                      </Pressable>
                    )}
                  </View>

                  <View style={styles.itemRight}>
                    {editingField?.index === index && editingField?.field === "cost" ? (
                      <TextInput
                        autoFocus
                        style={styles.itemCostInput}
                        value={item.cost != null ? String(item.cost) : ""}
                        onChangeText={text => updateItem(index, { cost: text ? parseFloat(text) : null })}
                        onBlur={() => setEditingField(null)}
                        onSubmitEditing={() => setEditingField(null)}
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                        placeholder="0.00"
                        placeholderTextColor={Colors.textTertiary}
                      />
                    ) : (
                      <Pressable onPress={() => { setEditingField({ index, field: "cost" }); Haptics.selectionAsync(); }}>
                        <Text style={[styles.itemCost, item.cost == null && styles.itemCostEmpty]}>
                          {item.cost != null ? `$${item.cost.toFixed(2)}` : "$ -"}
                        </Text>
                      </Pressable>
                    )}

                    <Pressable
                      onPress={() => deleteItem(index)}
                      style={styles.itemDeleteBtn}
                      hitSlop={8}
                    >
                      <Ionicons name="close-circle" size={18} color={Colors.textTertiary} />
                    </Pressable>
                  </View>
                </View>
              ))}

              <Pressable
                style={({ pressed }) => [styles.addItemBtn, { opacity: pressed ? 0.7 : 1 }]}
                onPress={addItem}
              >
                <Ionicons name="add-circle-outline" size={16} color={Colors.accent} />
                <Text style={styles.addItemText}>Add Item</Text>
              </Pressable>

              <Text style={styles.itemHint}>
                Tap any name or cost to edit. Each item saves as a separate log entry.
              </Text>
            </View>
          )}

          {scannedItems.length === 0 && (
            <View style={styles.fieldGroup}>
              <Text style={styles.groupLabel}>Service Type</Text>
              {taskChips.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickPicks}>
                  {taskChips.map(chip => {
                    const selected = directTask?.id === chip.id && task === chip.name;
                    return (
                      <Pressable
                        key={chip.id}
                        style={[styles.quickPick, selected && styles.quickPickSelected]}
                        onPress={() => {
                          setTask(chip.name);
                          setDirectTask(chip);
                          Haptics.selectionAsync().catch(() => {});
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={chip.name}
                        accessibilityState={{ selected }}
                      >
                        <Text style={[styles.quickPickText, selected && styles.quickPickTextSelected]}>{chip.name}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}
              <TextInput
                style={styles.input}
                value={task}
                onChangeText={text => {
                  // Any manual edit drops the identity binding. A chip taps one
                  // specific task; typed text is a claim the matcher must earn.
                  setDirectTask(null);
                  setTask(text);
                }}
                placeholder={taskChips.length > 0 ? "Or describe the service..." : "What did you have done?"}
                placeholderTextColor={Colors.textTertiary}
                returnKeyType="done"
              />
              <Pressable
                style={({ pressed }) => [styles.addItemBtn, { opacity: pressed ? 0.7 : 1 }]}
                onPress={startMultiService}
              >
                <Ionicons name="add-circle-outline" size={16} color={Colors.accent} />
                <Text style={styles.addItemText}>Add another service</Text>
              </Pressable>
            </View>
          )}

          <View style={styles.fieldGroup}>
            <Text style={styles.groupLabel}>Details</Text>
            <View style={styles.row}>
              <Field label="Date" style={{ flex: 1 }}>
                <DatePicker
                  value={date}
                  onChange={setDate}
                  maximumDate={new Date()}
                  onClose={() => { const y = scrollOffset.current; setTimeout(() => { scrollRef.current?.scrollTo({ y, animated: false }); }, 100); }}
                />
                {historicalReceiptDate && (
                  <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.needsAttention, marginTop: 4 }}>
                    {`This receipt is from ${format(parseISO(historicalReceiptDate), "MMM d, yyyy")}. It will be logged as a historical service.`}
                  </Text>
                )}
              </Field>
              {vehicleData && (isMileageTracked(vehicleData) || isHoursTracked(vehicleData)) && usageMode !== "both" && (
                <Field label={isHoursTracked(vehicleData) ? "Hours" : "Mileage"} style={{ flex: 1 }}>
                  <TextInput
                    style={styles.input}
                    value={mileage}
                    onChangeText={(t) => {
                      if (/[eE]/.test(t)) return;
                      const n = parseFloat(t.replace(/,/g, ""));
                      if (!isNaN(n) && n > 999999) return;
                      setMileage(t);
                    }}
                    placeholder={isHoursTracked(vehicleData) ? "e.g. 150" : "45000"}
                    placeholderTextColor={Colors.textTertiary}
                    keyboardType={isHoursTracked(vehicleData) ? "decimal-pad" : "numeric"}
                  />
                </Field>
              )}
              {usageMode === "both" && (
                <>
                  <Field label="Mileage" style={{ flex: 1 }}>
                    <TextInput
                      style={styles.input}
                      value={mileage}
                      onChangeText={(t) => {
                        if (/[eE]/.test(t)) return;
                        const n = parseInt(t.replace(/,/g, ""), 10);
                        if (!isNaN(n) && n > 999999) return;
                        setMileage(t);
                      }}
                      placeholder="45000"
                      placeholderTextColor={Colors.textTertiary}
                      keyboardType="numeric"
                    />
                  </Field>
                  <Field label="Hours" style={{ flex: 1 }}>
                    <TextInput
                      style={styles.input}
                      value={hoursReading}
                      onChangeText={(t) => {
                        if (/[eE]/.test(t)) return;
                        const n = parseFloat(t.replace(/,/g, ""));
                        if (!isNaN(n) && n > 999999) return;
                        setHoursReading(t);
                      }}
                      placeholder="e.g. 125.5"
                      placeholderTextColor={Colors.textTertiary}
                      keyboardType="decimal-pad"
                    />
                  </Field>
                </>
              )}
            </View>
            {pendingMileageChip != null ? (
              <Pressable
                style={({ pressed }) => [styles.mileageChip, { opacity: pressed ? 0.8 : 1 }]}
                onPress={() => { setMileage(String(pendingMileageChip)); setPendingMileageChip(null); Haptics.selectionAsync().catch(() => {}); }}
              >
                <Ionicons name="speedometer-outline" size={14} color={Colors.accent} />
                <Text style={styles.mileageChipText}>Receipt shows {pendingMileageChip.toLocaleString()} mi — tap to use</Text>
              </Pressable>
            ) : null}
            <View style={styles.row}>
              <Field label={scannedItems.length > 0 ? "Total Cost" : "Cost ($)"} style={{ flex: 1 }}>
                <TextInput
                  style={[styles.input, scannedItems.length > 0 && styles.inputDerived]}
                  value={scannedItems.length > 0
                    ? (itemsTotal != null ? itemsTotal.toFixed(2) : "")
                    : cost}
                  onChangeText={scannedItems.length > 0 ? undefined : setCost}
                  editable={scannedItems.length === 0}
                  placeholder="0.00"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="decimal-pad"
                />
              </Field>
              <Field label="Provider" style={{ flex: 1 }}>
                <TextInput
                  style={styles.input}
                  value={provider}
                  onChangeText={setProvider}
                  placeholder="Jiffy Lube, etc."
                  placeholderTextColor={Colors.textTertiary}
                  autoCapitalize="words"
                />
              </Field>
            </View>
          </View>

          {pricingInsight && scannedItems.length === 0 && (
            <PricingInsightBanner insight={pricingInsight} />
          )}

          {scannedItems.length === 0 && (
            <View style={styles.fieldGroup}>
              <Text style={styles.groupLabel}>Notes</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={notes}
                onChangeText={setNotes}
                placeholder="Additional notes..."
                placeholderTextColor={Colors.textTertiary}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>
          )}
        </ScrollView>
      </View>
      {showPaywall && (
        <Modal visible animationType="slide" onRequestClose={() => { setShowPaywall(false); const y = scrollOffset.current; setTimeout(() => { scrollRef.current?.scrollTo({ y, animated: false }); }, 100); }}>
          <Paywall
            canDismiss
            context={{ vertical: "scans", reason: "limit_reached" }}
            onDismiss={() => { setShowPaywall(false); const y = scrollOffset.current; setTimeout(() => { scrollRef.current?.scrollTo({ y, animated: false }); }, 100); }}
          />
        </Modal>
      )}
      <ScanPackModal
        ref={scanPackModalRef}
        onClose={() => {}}
        onSuccess={() => {}}
      />
      {resumeAsk && (
        <View style={styles.resumeOverlay}>
          <View style={styles.resumeCard}>
            <View style={styles.resumeIcon}>
              <Ionicons name="time-outline" size={24} color={Colors.accent} />
            </View>
            <Text style={styles.resumeTitle}>{resumeAsk.title}</Text>
            <Text style={styles.resumeDetail}>{resumeAsk.detail}</Text>
            <Text style={styles.resumeNote}>Your service is already saved. This only updates the matching tasks.</Text>
            <Pressable
              style={({ pressed }) => [styles.resumePrimary, { opacity: pressed ? 0.85 : 1 }]}
              onPress={handleResumeContinue}
              accessibilityRole="button"
              accessibilityLabel="Finish updating"
            >
              <Text style={styles.resumePrimaryText}>Finish updating</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.resumeSecondary, { opacity: pressed ? 0.7 : 1 }]}
              onPress={handleResumeDiscard}
              accessibilityRole="button"
              accessibilityLabel="Discard"
            >
              <Text style={styles.resumeSecondaryText}>Discard</Text>
            </Pressable>
          </View>
        </View>
      )}
      <TaskMatchPicker
        ref={pickerRef}
        mode={pickerMode}
        serviceName={pickerService}
        candidates={pickerCandidates}
        busy={pickerBusy}
        workingTaskId={pickerWorkingTaskId}
        lockedTaskId={pickerLockedTaskId}
        errorText={pickerError}
        onSelect={(taskId, taskName) => answerPicker({ kind: "select", taskId, taskName })}
        onRetry={() => {
          const last = lastPickRef.current;
          if (last) answerPicker({ kind: "select", taskId: last.taskId, taskName: last.taskName });
        }}
        onSkip={() => {
          // The button answers directly; the sheet is closed by runPicker, which
          // is the only place allowed to request a dismissal.
          answerPicker({ kind: "skip" });
        }}
        onSheetDismiss={handleSheetDismiss}
      />
      <SaveToast visible={successToastVisible} message={successToastTitle} subtitle={successToastSubtitle} />
      <SaveToast
        visible={attachToastVisible}
        message={successToastTitle}
        subtitle={successToastSubtitle}
        actionLabel="Attach to task"
        onAction={handleAttachPress}
      />
      <SaveToast visible={scanPackOpenErrorVisible} message="Couldn't open scan packs. Please try again." isError />
    </KeyboardAvoidingView>
    </BottomSheetModalProvider>
  );
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: any }) {
  return (
    <View style={[{ gap: 5 }, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function PricingInsightBanner({ insight }: { insight: PricingInsight }) {
  const dateStr = insight.date
    ? format(parseISO(insight.date), "MMM yyyy")
    : null;

  const parts: string[] = [];
  if (insight.cost != null) parts.push(`$${insight.cost.toFixed(2)}`);
  if (insight.provider) parts.push(`at ${insight.provider}`);
  parts.push(`on your ${insight.assetName}`);
  if (dateStr) parts.push(`(${dateStr})`);

  const label = insight.cost != null
    ? `You paid ${parts.join(" ")}`
    : `Previously logged ${parts.join(" ")}`;

  return (
    <View style={insightStyles.banner}>
      <Ionicons name="information-circle-outline" size={14} color={Colors.accent} style={{ flexShrink: 0, marginTop: 1 }} />
      <Text style={insightStyles.text} numberOfLines={2}>{label}</Text>
    </View>
  );
}

const insightStyles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    backgroundColor: Colors.accentMuted,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: Colors.accent + "33",
  },
  text: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    lineHeight: 17,
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
  },
  closeBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  saveBtn: { backgroundColor: Colors.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 6 },
  saveBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  scroll: { paddingHorizontal: 20, paddingTop: 16, gap: 20 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.overdueMuted, borderRadius: 10, padding: 12 },
  errorText: { flex: 1, fontSize: 13, color: Colors.overdue, fontFamily: "Inter_400Regular" },
  fieldGroup: { gap: 10 },
  groupLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.textTertiary, textTransform: "uppercase", letterSpacing: 1.5 },
  quickPicks: { gap: 8, paddingBottom: 4 },
  quickPick: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  quickPickSelected: { backgroundColor: Colors.vehicleMuted, borderColor: Colors.vehicle },
  quickPickText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  quickPickTextSelected: { color: Colors.vehicle },
  row: { flexDirection: "row", gap: 10 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  input: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
  },
  inputDerived: {
    color: Colors.textSecondary,
    backgroundColor: Colors.background,
  },
  textArea: { height: 80, paddingTop: 12 },
  ocrSuccess: { flexDirection: "row", alignItems: "center", gap: 6 },
  ocrSuccessText: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.good },
  scanGateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.accentLight,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Colors.accent + "33",
  },
  scanGateBtnText: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.accent },
  scanLockedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.accent,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  scanLockedText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  scanBadgeRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 6 },
  scanBadgeText: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.dueSoon },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  itemLeft: { flex: 1 },
  itemRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  itemName: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.text },
  itemDetails: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textTertiary, marginTop: 2 },
  itemCost: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.accent },
  itemCostEmpty: { color: Colors.textTertiary, fontFamily: "Inter_400Regular" },
  itemEditInput: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.text,
    borderBottomWidth: 1,
    borderBottomColor: Colors.accent,
    paddingVertical: 2,
    minWidth: 80,
  },
  itemCostInput: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.accent,
    borderBottomWidth: 1,
    borderBottomColor: Colors.accent,
    paddingVertical: 2,
    textAlign: "right",
    minWidth: 54,
  },
  itemDeleteBtn: {
    alignItems: "center",
    justifyContent: "center",
  },
  addItemBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.accentMuted,
    borderStyle: "dashed",
    justifyContent: "center",
  },
  addItemText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.accent },
  itemHint: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  mismatchCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.dueSoon + "55",
  },
  mismatchText: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.text, lineHeight: 18 },
  mismatchBtn: { backgroundColor: Colors.accent, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  mismatchBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  mismatchBtnGhost: { backgroundColor: Colors.card, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: Colors.border },
  mismatchBtnGhostText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  mileageChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: Colors.accentLight,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.accent + "33",
  },
  mileageChipText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.accent },
  scrollLocked: { opacity: 0.45 },
  resumeOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    backgroundColor: "rgba(12, 17, 27, 0.82)",
    zIndex: 900,
  },
  resumeCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: Colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 14,
  },
  resumeIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    backgroundColor: Colors.accentLight,
    borderWidth: 1,
    borderColor: Colors.accentMuted,
  },
  resumeTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
    textAlign: "center",
    marginTop: 14,
  },
  resumeDetail: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    textAlign: "center",
    marginTop: 6,
  },
  resumeNote: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textTertiary,
    textAlign: "center",
    marginTop: 10,
    lineHeight: 17,
  },
  resumePrimary: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
  resumePrimaryText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  resumeSecondary: { height: 44, alignItems: "center", justifyContent: "center", marginTop: 2 },
  resumeSecondaryText: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
});

