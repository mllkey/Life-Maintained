import React, { useState, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { Typography } from "@/constants/typography";
import { Radius } from "@/constants/radius";
import { Icon } from "@/components/ui/Icon";
import {
  calibrateVehicleTasks,
  calibratePropertyTasks,
  type CalibrateItem,
  type CalibrateTasksResult,
} from "@/lib/rpc";

export type CalibrationSheetHandle = {
  present: () => void;
  dismiss: () => void;
};

export type CalibrationSheetTask = {
  id: string;
  /** Display name: vehicle task `name`, property task `task`. */
  label: string;
  /** e.g. "every 5,000 miles" / "Annually" — optional context line. */
  intervalHint?: string | null;
};

type Choice = "recent" | "while_back" | "not_sure";

const CHOICES: { key: Choice; label: string }[] = [
  { key: "recent", label: "Done recently" },
  { key: "while_back", label: "A while back" },
  { key: "not_sure", label: "Not sure" },
];

export default forwardRef<
  CalibrationSheetHandle,
  {
    vertical: "vehicle" | "property";
    tasks: CalibrationSheetTask[];
    tint: string;
    onApplied: (result: Extract<CalibrateTasksResult, { ok: true }>) => void;
  }
>(function CalibrationSheet({ vertical, tasks, tint, onApplied }, ref) {
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  // Synchronous single-flight guard: React state alone cannot stop a second
  // tap that lands before the pending re-render.
  const applyingRef = useRef(false);

  const translateY = useSharedValue(600);
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  useImperativeHandle(ref, () => ({
    present: () => {
      // Fresh session: chips reset to "Not sure". Failure/retry preserves
      // chips only while the sheet stays open.
      setChoices({});
      setErrorText(null);
      setVisible(true);
      translateY.value = withSpring(0, { damping: 22, stiffness: 240, mass: 0.9 });
    },
    dismiss: () => {
      if (pending) return;
      translateY.value = withTiming(600, { duration: 180 });
      setTimeout(() => setVisible(false), 190);
    },
  }));

  const stagedItems: CalibrateItem[] = tasks
    .filter(t => choices[t.id] === "recent" || choices[t.id] === "while_back")
    .map(t => ({ task_id: t.id, choice: choices[t.id] as CalibrateItem["choice"] }));

  const canApply = stagedItems.length > 0 && !pending;

  const close = useCallback(() => {
    if (pending) return;
    translateY.value = withTiming(600, { duration: 180 });
    setTimeout(() => setVisible(false), 190);
  }, [pending, translateY]);

  const setChoice = useCallback((taskId: string, c: Choice) => {
    Haptics.selectionAsync();
    setChoices(prev => ({ ...prev, [taskId]: c }));
  }, []);

  async function apply() {
    if (!canApply || applyingRef.current) return;
    applyingRef.current = true;
    setPending(true);
    setErrorText(null);
    const fn = vertical === "vehicle" ? calibrateVehicleTasks : calibratePropertyTasks;
    try {
      const { data, error } = await fn(stagedItems);
      if (error || !data) {
        setErrorText("Couldn't save. Check your connection and try again.");
        setPending(false);
        applyingRef.current = false;
        return;
      }
      if (!data.ok) {
        setErrorText("Couldn't save. Please try again.");
        setPending(false);
        applyingRef.current = false;
        return;
      }
      // Success — including applied=0 with skips (rows changed underneath us;
      // the screen's onApplied shows "No updates applied" for that case).
      if (data.applied > 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      onApplied(data);
      setPending(false);
      applyingRef.current = false;
      translateY.value = withTiming(600, { duration: 180 });
      setTimeout(() => setVisible(false), 190);
    } catch {
      setErrorText("Couldn't save. Check your connection and try again.");
      setPending(false);
      applyingRef.current = false;
    }
  }

  if (!visible) return null;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={close}
      statusBarTranslucent
    >
      <Pressable
        style={styles.backdrop}
        onPress={close}
        disabled={pending}
        accessibilityLabel="Close"
      />
      <Animated.View
        style={[styles.sheet, { paddingBottom: insets.bottom + 16 }, sheetStyle]}
      >
        <View style={styles.grabber} />
        <Text style={styles.title}>Confirm history</Text>
        <Text style={styles.subtitle}>
          When was each of these last done? "Done recently" starts a fresh maintenance cycle from today; "A while back" assumes you're about halfway through it.
        </Text>

        <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 8 }}>
          {tasks.map(t => (
            <View key={t.id} style={styles.taskRow}>
              <Text style={styles.taskName} numberOfLines={1}>{t.label}</Text>
              {t.intervalHint ? (
                <Text style={styles.taskHint}>{t.intervalHint}</Text>
              ) : null}
              <View style={styles.chipRow}>
                {CHOICES.map(c => {
                  const selected = (choices[t.id] ?? "not_sure") === c.key;
                  return (
                    <Pressable
                      key={c.key}
                      onPress={() => setChoice(t.id, c.key)}
                      disabled={pending}
                      style={[
                        styles.chip,
                        selected && { backgroundColor: tint + "26", borderColor: tint },
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text
                        style={[styles.chipText, selected && { color: tint, fontWeight: "600" }]}
                      >
                        {c.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>

        {errorText ? (
          <View style={styles.errorRow}>
            <Icon name="cloud-offline-outline" size={16} color={Colors.overdue} />
            <Text style={styles.errorText}>{errorText}</Text>
          </View>
        ) : null}

        <Text style={styles.exactDateHint}>
          Know the exact date? You can log it from the task list later for a more precise schedule.
        </Text>

        <Pressable
          onPress={apply}
          disabled={!canApply}
          style={[
            styles.applyButton,
            { backgroundColor: tint },
            !canApply && { opacity: 0.4 },
          ]}
          accessibilityRole="button"
        >
          {pending ? (
            <ActivityIndicator color={Colors.background} />
          ) : (
            <Text style={styles.applyText}>
              {errorText ? "Retry" : "Apply"}
            </Text>
          )}
        </Pressable>
        <Pressable onPress={close} disabled={pending} style={styles.notNow}>
          <Text style={[styles.notNowText, pending && { opacity: 0.4 }]}>Not now</Text>
        </Pressable>
      </Animated.View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.card,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingHorizontal: 16,
    paddingTop: 8,
    maxHeight: "82%",
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    marginBottom: 12,
  },
  title: { ...Typography.title3, color: Colors.text, fontWeight: "700" },
  subtitle: { ...Typography.footnote, color: Colors.textSecondary, marginTop: 4, marginBottom: 12 },
  list: { flexGrow: 0 },
  taskRow: { paddingVertical: 10 },
  taskName: { ...Typography.subheadline, color: Colors.text, fontWeight: "600" },
  taskHint: { ...Typography.caption, color: Colors.textTertiary, marginTop: 1 },
  chipRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  chipText: { ...Typography.footnote, color: Colors.textSecondary },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  exactDateHint: { ...Typography.caption, color: Colors.textTertiary, marginTop: 10, textAlign: "center" },
  errorText: { ...Typography.footnote, color: Colors.overdue, flex: 1 },
  applyButton: {
    marginTop: 12,
    borderRadius: Radius.md,
    paddingVertical: 14,
    alignItems: "center",
  },
  applyText: { ...Typography.body, color: Colors.background, fontWeight: "700" },
  notNow: { alignItems: "center", paddingVertical: 12 },
  notNowText: { ...Typography.footnote, color: Colors.textSecondary },
});
