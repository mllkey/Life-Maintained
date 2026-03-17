import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Animated,
  Easing,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { matchAndUpdateVehicleTask, matchAndUpdatePropertyTask } from "@/lib/maintenanceMatcher";
import { scheduleMaintenanceNotifications } from "@/lib/notificationScheduler";

type RecordPhase =
  | "idle"
  | "recording"
  | "transcribing"
  | "type"
  | "processing"
  | "results"
  | "error";

type ExtractedItem = {
  category: "vehicle" | "property" | "health";
  asset_id: string | null;
  asset_name: string;
  service_name: string;
  service_date: string;
  cost: number | null;
  mileage: number | null;
  provider_name: string | null;
  notes: string | null;
  confidence: "high" | "medium" | "low";
};

// ─── Wave Bars (ambient decoration for text input mode) ─────────────────────

const BAR_DURATIONS = [420, 620, 370, 700, 310, 530, 460];
const BAR_DELAYS    = [0,   120, 240, 60,  180, 320, 80 ];

function WaveBar({ index }: { index: number }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const duration = BAR_DURATIONS[index] ?? 400;
    const delay    = BAR_DELAYS[index]    ?? 0;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 1,
          duration,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(anim, {
          toValue: 0,
          duration,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ])
    );

    const timeout = setTimeout(() => loop.start(), delay);
    return () => {
      clearTimeout(timeout);
      loop.stop();
    };
  }, []);

  const height = anim.interpolate({ inputRange: [0, 1], outputRange: [8, 32] });

  return (
    <Animated.View
      style={{ width: 4, height, borderRadius: 2, backgroundColor: Colors.accent }}
    />
  );
}

function WaveBars() {
  return (
    <View style={styles.waveContainer}>
      {[0, 1, 2, 3, 4, 5, 6].map(i => (
        <WaveBar key={i} index={i} />
      ))}
    </View>
  );
}

// ─── Concentric Glowing Rings ─────────────────────────────────────────────────

const RING_DEFS = [
  { radius: 50,  bw: 2.5, hexOpacity: "CC", scaleMin: 0.90, scaleMax: 1.15, delay:   0, phaseOffset: 0    },
  { radius: 80,  bw: 2.0, hexOpacity: "99", scaleMin: 0.92, scaleMax: 1.12, delay:  60, phaseOffset: 200  },
  { radius: 115, bw: 1.5, hexOpacity: "66", scaleMin: 0.94, scaleMax: 1.10, delay: 120, phaseOffset: 400  },
  { radius: 155, bw: 1.0, hexOpacity: "4D", scaleMin: 0.95, scaleMax: 1.08, delay: 180, phaseOffset: 600  },
  { radius: 200, bw: 1.0, hexOpacity: "33", scaleMin: 0.96, scaleMax: 1.05, delay: 240, phaseOffset: 800  },
] as const;

type RingsProps = { amplitudeRef: React.MutableRefObject<number>; isRecording: boolean };

function ConcentricRings({ amplitudeRef, isRecording }: RingsProps) {
  const ringScales = useRef(RING_DEFS.map(() => new Animated.Value(1.0))).current;
  const bgScale    = useRef(new Animated.Value(1.0)).current;
  const coreOpacity = useRef(new Animated.Value(0.5)).current;

  const idleLoopRefs = useRef<(Animated.CompositeAnimation | null)[]>([null, null, null, null, null]);
  const bgLoopRef    = useRef<Animated.CompositeAnimation | null>(null);
  const phaseTimers  = useRef<ReturnType<typeof setTimeout>[]>([]);
  const ampTimers    = useRef<ReturnType<typeof setTimeout>[]>([]);
  const rafRef       = useRef<number | null>(null);
  const lastAmp      = useRef(-1);

  // Background glow always pulses (4s loop)
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bgScale, { toValue: 1.05, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(bgScale, { toValue: 0.95, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    bgLoopRef.current = loop;
    loop.start();
    return () => loop.stop();
  }, []);

  // Switch between idle breathing and live amplitude mode
  useEffect(() => {
    if (isRecording) {
      stopIdleBreathing();
      startAmplitudeTracking();
    } else {
      stopAmplitudeTracking();
      startIdleBreathing();
    }
    return () => {
      stopIdleBreathing();
      stopAmplitudeTracking();
    };
  }, [isRecording]);

  function startIdleBreathing() {
    stopIdleBreathing();
    Animated.timing(coreOpacity, { toValue: 0.5, duration: 300, useNativeDriver: true }).start();
    RING_DEFS.forEach((cfg, i) => {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(ringScales[i], { toValue: cfg.scaleMax, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(ringScales[i], { toValue: cfg.scaleMin, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      );
      idleLoopRefs.current[i] = loop;
      const t = setTimeout(() => loop.start(), cfg.phaseOffset);
      phaseTimers.current.push(t);
    });
  }

  function stopIdleBreathing() {
    phaseTimers.current.forEach(clearTimeout);
    phaseTimers.current = [];
    idleLoopRefs.current.forEach(l => l?.stop());
    idleLoopRefs.current = [null, null, null, null, null];
  }

  function startAmplitudeTracking() {
    lastAmp.current = -1;
    function loop() {
      const amp = amplitudeRef.current;
      if (Math.abs(amp - lastAmp.current) > 0.01) {
        lastAmp.current = amp;
        ampTimers.current.forEach(clearTimeout);
        ampTimers.current = [];
        RING_DEFS.forEach((cfg, i) => {
          const target = cfg.scaleMin + amp * (cfg.scaleMax - cfg.scaleMin);
          const t = setTimeout(() => {
            Animated.timing(ringScales[i], { toValue: target, duration: 80, useNativeDriver: true }).start();
          }, cfg.delay);
          ampTimers.current.push(t);
        });
        const opTarget = amp > 0.6 ? 0.7 : 0.5;
        Animated.timing(coreOpacity, { toValue: opTarget, duration: 80, useNativeDriver: true }).start();
      }
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
  }

  function stopAmplitudeTracking() {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    ampTimers.current.forEach(clearTimeout);
    ampTimers.current = [];
  }

  const SZ = 460;

  return (
    <View style={{ width: SZ, height: SZ, alignItems: "center", justifyContent: "center" }}>
      {/* Background glow — behind everything */}
      <Animated.View style={{
        position:        "absolute",
        width:           280,
        height:          280,
        borderRadius:    140,
        backgroundColor: Colors.accent + "0A",
        transform:       [{ scale: bgScale }],
      }} />

      {/* 5 concentric rings */}
      {RING_DEFS.map((cfg, i) => (
        <Animated.View
          key={i}
          style={{
            position:    "absolute",
            width:       cfg.radius * 2,
            height:      cfg.radius * 2,
            borderRadius: cfg.radius,
            borderWidth:  cfg.bw,
            borderColor:  Colors.accent + cfg.hexOpacity,
            transform:   [{ scale: ringScales[i] }],
          }}
        />
      ))}

      {/* Center: outer glow disc */}
      <View style={{
        position:        "absolute",
        width:           80,
        height:          80,
        borderRadius:    40,
        backgroundColor: Colors.accent + "26",
      }} />

      {/* Center: solid core (opacity-animated) */}
      <Animated.View style={{
        position:        "absolute",
        width:           56,
        height:          56,
        borderRadius:    28,
        backgroundColor: Colors.accent,
        opacity:         coreOpacity,
      }} />

      {/* Mic icon — always on top */}
      <View style={{ position: "absolute", alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="mic" size={24} color="#fff" />
      </View>
    </View>
  );
}

// ─── Field Row ───────────────────────────────────────────────────────────────

function FieldRow({
  label, value, onChange, placeholder, keyboard, prefix, suffix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboard?: "default" | "decimal-pad" | "number-pad";
  prefix?: string;
  suffix?: string;
}) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldInputWrap}>
        {!!prefix && <Text style={styles.fieldAffix}>{prefix}</Text>}
        <TextInput
          style={styles.fieldInput}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={Colors.textTertiary}
          keyboardType={keyboard ?? "default"}
        />
        {!!suffix && <Text style={styles.fieldAffix}>{suffix}</Text>}
      </View>
    </View>
  );
}

// ─── Confirm Card ────────────────────────────────────────────────────────────

function ConfirmCard({
  item, userId, onDone,
}: {
  item: ExtractedItem;
  userId: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [serviceName, setServiceName] = useState(item.service_name);
  const [date, setDate] = useState(item.service_date);
  const [cost, setCost] = useState(item.cost != null ? String(item.cost) : "");
  const [mileage, setMileage] = useState(item.mileage != null ? String(item.mileage) : "");
  const [provider, setProvider] = useState(item.provider_name ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [cardError, setCardError] = useState("");

  const isVehicle = item.category === "vehicle";
  const catIcon = item.category === "vehicle" ? "car-outline" : item.category === "property" ? "home-outline" : "heart-outline";
  const catColor = item.category === "vehicle" ? Colors.blue : item.category === "property" ? Colors.good : Colors.health;

  async function handleSave() {
    if (item.category === "health") {
      setCardError("Health logging from voice is coming soon. Use the Health tab for now.");
      return;
    }
    if (!serviceName.trim()) { setCardError("Service name is required"); return; }
    setSaving(true);
    setCardError("");
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const now = new Date().toISOString();
      const { error: insertErr } = await supabase.from("maintenance_logs").insert({
        user_id: userId,
        vehicle_id: isVehicle && item.asset_id ? item.asset_id : null,
        property_id: item.category === "property" && item.asset_id ? item.asset_id : null,
        service_name: serviceName.trim(),
        service_date: date || now.split("T")[0],
        mileage: mileage ? parseInt(mileage) : null,
        cost: cost ? parseFloat(cost) : null,
        provider_name: provider.trim() || null,
        notes: notes.trim() || null,
        receipt_url: null,
        created_at: now,
        updated_at: now,
      });
      if (insertErr) throw insertErr;

      if (isVehicle && item.asset_id && mileage) {
        await supabase.from("vehicles").update({
          mileage: parseInt(mileage),
          updated_at: now,
        }).eq("id", item.asset_id);
        await supabase.from("vehicle_mileage_history").insert({
          vehicle_id: item.asset_id,
          mileage: parseInt(mileage),
          recorded_at: date || now,
          created_at: now,
        });
      }

      if (isVehicle && item.asset_id) {
        try {
          await matchAndUpdateVehicleTask(
            item.asset_id,
            serviceName.trim(),
            date || now.split("T")[0],
            mileage ? parseInt(mileage) : null,
          );
        } catch (matchErr) {
          console.error("matchAndUpdateVehicleTask failed (non-blocking):", matchErr);
        }
      } else if (item.category === "property" && item.asset_id) {
        try {
          await matchAndUpdatePropertyTask(
            item.asset_id,
            serviceName.trim(),
            date || now.split("T")[0],
          );
        } catch (matchErr) {
          console.error("matchAndUpdatePropertyTask failed (non-blocking):", matchErr);
        }
      }

      try {
        await scheduleMaintenanceNotifications(userId);
      } catch (notifErr) {
        console.error("scheduleMaintenanceNotifications failed (non-blocking):", notifErr);
      }

      queryClient.invalidateQueries({ queryKey: ["maintenance_logs"] });
      queryClient.invalidateQueries({ queryKey: ["maintenance_logs", item.asset_id] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard_spending"] });
      queryClient.invalidateQueries({ queryKey: ["mileage_vehicles"] });
      if (isVehicle && item.asset_id) {
        queryClient.invalidateQueries({ queryKey: ["vehicles"] });
        queryClient.invalidateQueries({ queryKey: ["user_vehicle_maintenance_tasks", item.asset_id] });
      } else if (item.category === "property" && item.asset_id) {
        queryClient.invalidateQueries({ queryKey: ["properties"] });
        queryClient.invalidateQueries({ queryKey: ["property_tasks", item.asset_id] });
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onDone();
    } catch (err) {
      console.error("ConfirmCard save error:", err);
      setCardError("Save failed. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.confirmCard}>
      <View style={styles.confirmCardHeader}>
        <View style={[styles.confirmCatIcon, { backgroundColor: catColor + "22" }]}>
          <Ionicons name={catIcon as any} size={15} color={catColor} />
        </View>
        <Text style={styles.confirmAssetName} numberOfLines={1}>{item.asset_name || "Unknown"}</Text>
        {item.confidence === "low" && (
          <View style={styles.confirmLowBadge}>
            <Ionicons name="alert-circle-outline" size={11} color={Colors.dueSoon} />
            <Text style={styles.confirmLowBadgeText}>Please verify</Text>
          </View>
        )}
      </View>

      <View style={styles.confirmFields}>
        <FieldRow label="Service" value={serviceName} onChange={setServiceName} placeholder="e.g. Oil Change" />
        <FieldRow label="Date" value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
        <FieldRow label="Cost" value={cost} onChange={setCost} placeholder="0.00" keyboard="decimal-pad" prefix="$" />
        {isVehicle && (
          <FieldRow label="Mileage" value={mileage} onChange={setMileage} placeholder="0" keyboard="number-pad" suffix=" mi" />
        )}
        <FieldRow label="Provider" value={provider} onChange={setProvider} placeholder="Shop or clinic name" />
        <FieldRow label="Notes" value={notes} onChange={setNotes} placeholder="Optional" />
      </View>

      {!!cardError && <Text style={styles.confirmCardError}>{cardError}</Text>}

      <View style={styles.confirmActions}>
        <Pressable style={styles.confirmDiscardBtn} onPress={onDone} disabled={saving}>
          <Text style={styles.confirmDiscardText}>Discard</Text>
        </Pressable>
        <Pressable
          style={[styles.confirmSaveBtn, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.confirmSaveBtnText}>Save</Text>}
        </Pressable>
      </View>
    </View>
  );
}

// ─── LogSheet ────────────────────────────────────────────────────────────────

export function LogSheet({
  visible, onClose, userId,
}: {
  visible: boolean;
  onClose: () => void;
  userId: string;
}) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<RecordPhase>("idle");
  const [text, setText] = useState("");
  const [items, setItems] = useState<ExtractedItem[]>([]);
  const [doneCount, setDoneCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  // Normalized 0-1 amplitude written by metering updates, read by WaveformCircle each RAF frame
  const amplitudeRef = useRef<number>(0);
  const recordingRef = useRef<Audio.Recording | null>(null);

  // Reset when sheet becomes visible or hidden
  useEffect(() => {
    if (visible) {
      setPhase("idle");
      setText("");
      setItems([]);
      setDoneCount(0);
      setErrorMsg("");
      amplitudeRef.current = 0;
    } else {
      safeStopRecording();
      amplitudeRef.current = 0;
    }
  }, [visible]);

  async function safeStopRecording() {
    const rec = recordingRef.current;
    if (!rec) return;
    recordingRef.current = null;
    try {
      await rec.stopAndUnloadAsync();
    } catch (_) {}
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    } catch (_) {}
  }

  async function handleStartRecording() {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        setPhase("type");
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });

      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync({
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      });
      rec.setOnRecordingStatusUpdate((status) => {
        if (status.isRecording && status.metering !== undefined) {
          amplitudeRef.current = Math.max(0, (status.metering + 60) / 60);
        }
      });
      rec.setProgressUpdateInterval(100);
      await rec.startAsync();

      recordingRef.current = rec;
      setPhase("recording");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (err) {
      console.error("[LogSheet] Start recording error:", err);
      setPhase("type");
    }
  }

  async function handleStopRecording() {
    const rec = recordingRef.current;
    if (!rec) { setPhase("type"); return; }

    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      recordingRef.current = null;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      amplitudeRef.current = 0;

      setPhase("transcribing");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await handleTranscribe(uri);
    } catch (err) {
      console.error("[LogSheet] Stop recording error:", err);
      recordingRef.current = null;
      setPhase("type");
    }
  }

  async function handleTranscribe(uri: string | null) {
    if (!uri) {
      setPhase("type");
      return;
    }
    try {
      const fileContent = await FileSystem.readAsStringAsync(uri, {
        encoding: "base64" as any,
      });
      const { data, error } = await supabase.functions.invoke("transcribe-audio", {
        body: { audio: fileContent, mimeType: "audio/m4a" },
      });
      if (error || data?.error) {
        console.error("[transcribe] error:", error ?? data?.error);
        setErrorMsg("Transcription failed. You can type your log below.");
        setText("");
        setPhase("type");
        return;
      }
      const transcribed: string = data?.text ?? "";
      setText(transcribed);
      setPhase("type");
    } catch (err) {
      console.error("[transcribe] caught:", err);
      setErrorMsg("Transcription failed. You can type your log below.");
      setText("");
      setPhase("type");
    }
  }

  function handleClose() {
    safeStopRecording();
    amplitudeRef.current = 0;
    setText("");
    setPhase("idle");
    setItems([]);
    setDoneCount(0);
    setErrorMsg("");
    onClose();
  }

  async function handleProcess() {
    if (!text.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPhase("processing");
    try {
      const { data, error } = await supabase.functions.invoke("extract-maintenance-data", {
        body: { text: text.trim() },
      });

      console.log("[extract-maintenance-data] data:", JSON.stringify(data));
      console.log("[extract-maintenance-data] error:", error);

      if (error) {
        const msg = (error as any)?.message ?? String(error);
        console.error("[extract-maintenance-data] invoke error:", msg);
        setErrorMsg(`Error: ${msg}`);
        setPhase("error");
        return;
      }

      if (data?.error) {
        console.error("[extract-maintenance-data] function error:", data.error);
        setErrorMsg(`Error: ${data.error}`);
        setPhase("error");
        return;
      }

      const extracted: ExtractedItem[] = data?.items ?? [];
      if (extracted.length === 0) {
        setErrorMsg("No maintenance items found. Try adding more detail (e.g. service type, vehicle, mileage).");
        setPhase("error");
        return;
      }
      setItems(extracted);
      setDoneCount(0);
      setPhase("results");
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error("[extract-maintenance-data] caught:", msg);
      setErrorMsg(`Error: ${msg}`);
      setPhase("error");
    }
  }

  function markDone() {
    const next = doneCount + 1;
    setDoneCount(next);
    if (next >= items.length) {
      setTimeout(handleClose, 500);
    }
  }

  const isRecordingPhase = phase === "idle" || phase === "recording" || phase === "transcribing";
  const isTextPhase = phase === "type" || phase === "error";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={{ flex: 1 }}>

        {/* ── Recording overlay (idle / recording / transcribing) ── */}
        {isRecordingPhase && (
          <View style={[styles.recordingScreen, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}>
            {/* Close button */}
            <View style={styles.recordingTopBar}>
              <Pressable onPress={handleClose} hitSlop={12} style={styles.recordingCloseBtn}>
                <Ionicons name="close" size={22} color={Colors.textTertiary} />
              </Pressable>
            </View>

            {/* Center: waveform + status text */}
            <View style={styles.recordingCenter}>
              <ConcentricRings amplitudeRef={amplitudeRef} isRecording={phase === "recording"} />

              <Text style={[
                styles.recordingStatus,
                phase === "recording" && { color: "#fff" },
              ]}>
                {phase === "idle"
                  ? "Tap to start"
                  : phase === "recording"
                    ? "Listening..."
                    : "Transcribing..."}
              </Text>
            </View>

            {/* Bottom: mic button + type-instead */}
            <View style={styles.recordingBottom}>
              {phase === "transcribing" ? (
                <View style={styles.transcribingRow}>
                  <ActivityIndicator size="small" color={Colors.accent} />
                  <Text style={styles.transcribingText}>Processing audio...</Text>
                </View>
              ) : (
                <>
                  <Pressable
                    style={[
                      styles.recordingBtn,
                      phase === "recording" && styles.recordingBtnStop,
                    ]}
                    onPress={phase === "idle" ? handleStartRecording : handleStopRecording}
                  >
                    <Ionicons
                      name={phase === "idle" ? "mic" : "stop"}
                      size={28}
                      color="#fff"
                    />
                  </Pressable>
                  <Pressable onPress={() => setPhase("type")} hitSlop={8}>
                    <Text style={styles.typeInsteadText}>Type instead →</Text>
                  </Pressable>
                </>
              )}
            </View>
          </View>
        )}

        {/* ── Text / Processing / Results (bottom sheet) ── */}
        {!isRecordingPhase && (
          <>
            <Pressable style={styles.sheetOverlay} onPress={handleClose} />
            <KeyboardAvoidingView
              behavior={Platform.OS === "ios" ? "padding" : "height"}
              style={styles.sheetKAV}
            >
              <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
                <View style={styles.sheetHandleBar} />

                <View style={styles.sheetHeader}>
                  <View style={styles.sheetIconWrap}>
                    <Ionicons name="mic-outline" size={17} color={Colors.accent} />
                  </View>
                  <Text style={styles.sheetTitle}>Log Maintenance</Text>
                  <Pressable onPress={handleClose} hitSlop={10} style={styles.sheetCloseBtn}>
                    <Ionicons name="close" size={20} color={Colors.textTertiary} />
                  </Pressable>
                </View>

                {isTextPhase && (
                  <View style={{ gap: 12 }}>
                    {phase === "error" && (
                      <View style={styles.sheetErrorBanner}>
                        <Ionicons name="alert-circle-outline" size={14} color={Colors.overdue} />
                        <Text style={styles.sheetErrorText}>{errorMsg}</Text>
                      </View>
                    )}
                    {errorMsg !== "" && phase === "type" && (
                      <View style={styles.sheetErrorBanner}>
                        <Ionicons name="alert-circle-outline" size={14} color={Colors.overdue} />
                        <Text style={styles.sheetErrorText}>{errorMsg}</Text>
                      </View>
                    )}
                    <View>
                      <WaveBars />
                      <TextInput
                        style={styles.sheetTextInput}
                        value={text}
                        onChangeText={setText}
                        placeholder="Tap 🎤 on keyboard to dictate, or type here"
                        placeholderTextColor={Colors.textTertiary}
                        multiline
                        numberOfLines={4}
                        autoFocus
                        textAlignVertical="top"
                        returnKeyType="default"
                      />
                      <Text style={styles.sheetHint}>Use your keyboard{"'"}s microphone button to speak</Text>
                    </View>
                    <Pressable
                      style={[styles.sheetProcessBtn, !text.trim() && { opacity: 0.45 }]}
                      onPress={handleProcess}
                      disabled={!text.trim()}
                    >
                      <Ionicons name="sparkles-outline" size={15} color="#fff" />
                      <Text style={styles.sheetProcessBtnText}>Process</Text>
                    </Pressable>
                  </View>
                )}

                {phase === "processing" && (
                  <View style={styles.sheetProcessing}>
                    <ActivityIndicator size="small" color={Colors.accent} />
                    <Text style={styles.sheetProcessingText}>Analyzing...</Text>
                  </View>
                )}

                {phase === "results" && (
                  <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 500 }}>
                    {items.map((item, idx) => (
                      <ConfirmCard key={idx} item={item} userId={userId} onDone={markDone} />
                    ))}
                  </ScrollView>
                )}
              </View>
            </KeyboardAvoidingView>
          </>
        )}
      </View>
    </Modal>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Recording overlay
  recordingScreen: {
    flex: 1,
    backgroundColor: "rgba(12,17,27,0.97)",
    justifyContent: "space-between",
  },
  recordingTopBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  recordingCloseBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: Colors.surface,
  },
  recordingCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 32,
  },
  recordingStatus: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textSecondary,
    textAlign: "center",
  },
  recordingBottom: {
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 20,
  },
  recordingBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  recordingBtnStop: {
    backgroundColor: Colors.overdue,
    shadowColor: Colors.overdue,
  },
  typeInsteadText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
  },
  transcribingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 20,
  },
  transcribingText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },

  // Bottom sheet
  sheetOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheetKAV: {
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 20,
  },
  sheetHandleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: "center",
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sheetIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: Colors.accentMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetTitle: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  sheetCloseBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  waveContainer: {
    height: 120,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  sheetTextInput: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
    minHeight: 96,
    textAlignVertical: "top",
  },
  sheetHint: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textTertiary,
    textAlign: "center",
    marginTop: 8,
  },
  sheetProcessBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: Colors.accent,
    borderRadius: 12,
    height: 46,
  },
  sheetProcessBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  sheetProcessing: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 24,
  },
  sheetProcessingText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },
  sheetErrorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: Colors.overdueMuted,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(255,69,58,0.25)",
  },
  sheetErrorText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.overdue,
    lineHeight: 18,
  },

  // Confirm card
  confirmCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    gap: 12,
    marginBottom: 10,
  },
  confirmCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  confirmCatIcon: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  confirmAssetName: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  confirmLowBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.dueSoonMuted,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
  },
  confirmLowBadgeText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    color: Colors.dueSoon,
  },
  confirmFields: {
    gap: 8,
  },
  confirmActions: {
    flexDirection: "row",
    gap: 10,
    paddingTop: 2,
  },
  confirmDiscardBtn: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  confirmDiscardText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },
  confirmSaveBtn: {
    flex: 2,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.accent,
  },
  confirmSaveBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  confirmCardError: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.overdue,
  },

  // Field row
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 36,
  },
  fieldLabel: {
    width: 66,
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
    flexShrink: 0,
  },
  fieldInputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 9,
    height: 36,
  },
  fieldInput: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
    height: 36,
  },
  fieldAffix: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textTertiary,
    flexShrink: 0,
  },
});
