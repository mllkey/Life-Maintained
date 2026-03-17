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
import Svg, { Circle, Defs, RadialGradient, Stop, G, Path } from "react-native-svg";

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

// ─── Voice Orb (SVG-based — true radial-gradient glow + shockwave pulses) ────

// Generates a slightly organic closed ring path: 12 control points evenly
// spaced around a circle of baseRadius from center (150,150), each with a
// ±3 px random radial offset, connected with smooth quadratic bezier curves.
function computeOrganicPath(offsets: number[]): string {
  const N = 12;
  const cx = 150, cy = 150, baseR = 45;
  const pts = offsets.map((off, i) => {
    const angle = (i / N) * Math.PI * 2 - Math.PI / 2;
    const r = baseR + off;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });
  const m0 = mid(pts[N - 1], pts[0]);
  let d = `M ${m0.x.toFixed(2)} ${m0.y.toFixed(2)} `;
  for (let i = 0; i < N; i++) {
    const p = pts[i];
    const nm = mid(p, pts[(i + 1) % N]);
    d += `Q ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${nm.x.toFixed(2)} ${nm.y.toFixed(2)} `;
  }
  return d + "Z";
}

type OrbPulse = {
  id: number;
  startTime: number;
  maxRadius: number;
  basePath: string;
};

type OrbPulseRender = {
  id: number;
  basePath: string;
  transform: string;
  glowStroke: number;
  coreStroke: number;
  glowOp: number;
  coreOp: number;
};

type OrbAnimState = {
  orbRadius: number;
  bgScale: number;
  pulses: OrbPulseRender[];
};

const PULSE_DURATION = 1400;
const ORB_SVG_SIZE   = 300;
const ORB_CENTER     = 150; // cx = cy = ORB_SVG_SIZE / 2

type OrbProps = { amplitudeRef: React.MutableRefObject<number>; isRecording: boolean };

function VoiceOrb({ amplitudeRef, isRecording }: OrbProps) {
  const [anim, setAnim] = useState<OrbAnimState>({
    orbRadius: 40,
    bgScale: 1.0,
    pulses: [],
  });

  const pulsesRef      = useRef<OrbPulse[]>([]);
  const lastSpawnRef   = useRef<number>(0);
  const lastFrameRef   = useRef<number>(0);
  const lastStateRef   = useRef<number>(0);
  const rafRef         = useRef<number | null>(null);
  const mountedRef     = useRef(true);
  const isRecordingRef = useRef(isRecording);

  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);

  useEffect(() => {
    mountedRef.current = true;

    function frame(timestamp: number) {
      if (!mountedRef.current) return;
      lastFrameRef.current = timestamp;

      const now       = timestamp;
      const amp       = amplitudeRef.current;
      const recording = isRecordingRef.current;

      // ── Orb radius ──────────────────────────────────────────────────────────
      const newOrbRadius = recording
        ? 30 + amp * 20                                          // 30–50 live
        : 40 + Math.sin((now / 2500) * Math.PI * 2) * 4;        // 36–44 idle

      // ── Background scale (5 s, 0.97–1.03) ──────────────────────────────────
      const newBgScale = 1.0 + Math.sin((now / 5000) * Math.PI * 2) * 0.03;

      // ── Spawn pulse ─────────────────────────────────────────────────────────
      const spawnInterval = recording ? (amp > 0.6 ? 200 : 700) : 2500;
      if (now - lastSpawnRef.current > spawnInterval && pulsesRef.current.length < 5) {
        const maxR    = recording && amp > 0.6 ? 150 : 100;
        const offsets = Array.from({ length: 12 }, () => (Math.random() - 0.5) * 6);
        pulsesRef.current = [
          ...pulsesRef.current,
          { id: now, startTime: now, maxRadius: maxR, basePath: computeOrganicPath(offsets) },
        ];
        lastSpawnRef.current = now;
      }

      // ── Expire pulses ────────────────────────────────────────────────────────
      pulsesRef.current = pulsesRef.current.filter(p => now - p.startTime < PULSE_DURATION);

      // ── Throttle state update to ~30 fps ────────────────────────────────────
      if (now - lastStateRef.current >= 33) {
        lastStateRef.current = now;
        const C = ORB_CENTER;

        const pulses: OrbPulseRender[] = pulsesRef.current.map(p => {
          const t   = Math.min((now - p.startTime) / PULSE_DURATION, 1);
          const tE  = 1 - Math.pow(1 - t, 2);                // quadratic ease-out
          const scale = 1 + tE * (p.maxRadius / 45 - 1);     // 1 → maxRadius/45

          // Scale the path around the SVG center: translate(cx*(1-s), cy*(1-s)) scale(s)
          const tx        = C * (1 - scale);
          const transform = `translate(${tx.toFixed(3)}, ${tx.toFixed(3)}) scale(${scale.toFixed(4)})`;

          // Stroke widths compensate for scale so the visual weight is consistent
          const designStroke = 3 - 2.5 * t;  // 3 → 0.5
          return {
            id:          p.id,
            basePath:    p.basePath,
            transform,
            glowStroke:  8 / scale,
            coreStroke:  designStroke / scale,
            glowOp:      0.3 * (1 - tE),
            coreOp:      0.5 * (1 - tE),
          };
        });

        setAnim({ orbRadius: newOrbRadius, bgScale: newBgScale, pulses });
      }

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);

    return () => {
      mountedRef.current = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      pulsesRef.current   = [];
      lastSpawnRef.current = 0;
      lastStateRef.current = 0;
    };
  }, []); // intentional empty deps — reads isRecording and amplitude via refs

  const C = ORB_CENTER;
  const bgTx = C * (1 - anim.bgScale);

  return (
    <View style={{ width: ORB_SVG_SIZE, height: ORB_SVG_SIZE, alignItems: "center", justifyContent: "center" }}>
      <Svg width={ORB_SVG_SIZE} height={ORB_SVG_SIZE} viewBox="0 0 300 300">
        <Defs>
          {/* Orb: accent at center, fully transparent at edge → true glow */}
          <RadialGradient id="orbGrad" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
            <Stop offset="0%"   stopColor={Colors.accent} stopOpacity={1} />
            <Stop offset="100%" stopColor={Colors.accent} stopOpacity={0} />
          </RadialGradient>
          {/* Background: very faint accent halo */}
          <RadialGradient id="bgGlow" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
            <Stop offset="0%"   stopColor={Colors.accent} stopOpacity={0.05} />
            <Stop offset="100%" stopColor={Colors.accent} stopOpacity={0} />
          </RadialGradient>
        </Defs>

        {/* Background glow — slowly scales 0.97–1.03 on 5 s loop */}
        <Circle
          cx={C} cy={C} r={130}
          fill="url(#bgGlow)"
          transform={`translate(${bgTx.toFixed(3)}, ${bgTx.toFixed(3)}) scale(${anim.bgScale.toFixed(4)})`}
        />

        {/* Shockwave pulses — glow layer behind core layer */}
        {anim.pulses.map(p => (
          <G key={p.id} transform={p.transform}>
            {/* Glow: thick, very faint stroke for bloom effect */}
            <Path
              d={p.basePath}
              fill="none"
              stroke={Colors.accent}
              strokeWidth={p.glowStroke}
              strokeOpacity={p.glowOp}
            />
            {/* Core: thin, bright stroke */}
            <Path
              d={p.basePath}
              fill="none"
              stroke={Colors.accent}
              strokeWidth={p.coreStroke}
              strokeOpacity={p.coreOp}
            />
          </G>
        ))}

        {/* Center orb — radial gradient fills a softly breathing circle */}
        <Circle cx={C} cy={C} r={anim.orbRadius} fill="url(#orbGrad)" />
      </Svg>

      {/* Mic icon — native View floating over the SVG */}
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
              <VoiceOrb amplitudeRef={amplitudeRef} isRecording={phase === "recording"} />

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
