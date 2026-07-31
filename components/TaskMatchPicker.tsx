import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetScrollView,
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import type { MatchCandidate } from "@/lib/serviceMatcher";

/**
 * Confirmation sheet for a REVIEW match in the log-service save flow.
 *
 * Structurally identical to components/ReminderMoment.tsx - the app's in-screen
 * sheet - so the two read as one product: BottomSheetModal + fixed snapPoints +
 * BottomSheetBackdrop(appearsOnIndex 0 / disappearsOnIndex -1 / opacity 0.5) +
 * BottomSheetView with paddingBottom 24 + insets.bottom.
 *
 * The sheet is presentational. Every async decision - completion, the single
 * automatic retry, outcome classification - is owned by the screen, which drives
 * `busy` and `errorText`. That keeps the picker unmount-safe and keeps one
 * owner for the operation id.
 *
 * Match scores are deliberately never rendered. They are an engine internal; a
 * user shown "0.62" would be asked to audit a number the product cannot explain.
 */

export type TaskMatchPickerHandle = {
  present: () => void;
  dismiss: () => void;
};

interface TaskMatchPickerProps {
  /**
   * "match" confirms a REVIEW against ranked candidates (default, unchanged).
   * "attach" shows the FULL task list for a service that matched nothing:
   * no ranking tag, a scrollable list, and honest attach copy. Same selection
   * contract - the screen still owns every async decision.
   */
  mode?: "match" | "attach";
  serviceName: string;
  candidates: MatchCandidate[];
  busy: boolean;
  workingTaskId: string | null;
  /**
   * Once an attempt returns UNKNOWN the write may already have landed, so the
   * choice is frozen to that task. Selecting a different one would mint a new
   * (task_id, operation_id) key and could complete two tasks from one item,
   * with the first invisible to the outcome list and to undo.
   */
  lockedTaskId: string | null;
  errorText: string | null;
  onSelect: (taskId: string, taskName: string) => void;
  onRetry: () => void;
  onSkip: () => void;
  /**
   * Fires for EVERY dismissal, including the programmatic one. The screen
   * decides whether that dismissal was the user's; a sheet closing because the
   * flow moved on must never answer for the item that replaced it.
   */
  onSheetDismiss: () => void;
}

const MAX_VISIBLE_CANDIDATES = 4;

/**
 * Match mode keeps the original static list. Attach mode shows every task, so
 * the list scrolls inside a bounded height while the sheet stays fixed-snap.
 */
function ListWrap({ isAttach, children }: { isAttach: boolean; children: React.ReactNode }) {
  if (!isAttach) return <View style={styles.list}>{children}</View>;
  return (
    <BottomSheetScrollView
      style={styles.attachScroll}
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </BottomSheetScrollView>
  );
}

export default forwardRef<TaskMatchPickerHandle, TaskMatchPickerProps>(function TaskMatchPicker(
  { mode = "match", serviceName, candidates, busy, workingTaskId, lockedTaskId, errorText, onSelect, onRetry, onSkip, onSheetDismiss },
  ref,
) {
  const isAttach = mode === "attach";
  const insets = useSafeAreaInsets();
  const sheetRef = useRef<BottomSheetModal>(null);

  useImperativeHandle(
    ref,
    () => ({
      present: () => {
        sheetRef.current?.present();
      },
      dismiss: () => {
        sheetRef.current?.dismiss();
      },
    }),
    [],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.5}
        pressBehavior={busy ? "none" : "close"}
      />
    ),
    [busy],
  );

  const handleStyle = useMemo(
    () => ({ backgroundColor: Colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24 }),
    [],
  );
  const handleIndicatorStyle = useMemo(() => ({ backgroundColor: Colors.border, width: 36, height: 4 }), []);
  const backgroundStyle = useMemo(() => ({ backgroundColor: Colors.card }), []);

  const visible = useMemo(
    () => (isAttach ? candidates : candidates.slice(0, MAX_VISIBLE_CANDIDATES)),
    [candidates, isAttach],
  );

  const snapPoints = useMemo(() => {
    const rowCap = isAttach ? 6 : MAX_VISIBLE_CANDIDATES;
    const rows = Math.min(Math.max(visible.length, 1), rowCap);
    const base = 42 + rows * 8;
    const pct = errorText ? base + 10 : base;
    return [String(isAttach ? Math.min(pct, 82) : pct) + "%"];
  }, [visible.length, errorText, isAttach]);

  return (
    <BottomSheetModal
      ref={sheetRef}
      index={0}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose={!busy}
      backdropComponent={renderBackdrop}
      backgroundStyle={backgroundStyle}
      handleStyle={handleStyle}
      handleIndicatorStyle={handleIndicatorStyle}
      onDismiss={onSheetDismiss}
    >
      <BottomSheetView style={[styles.content, { paddingBottom: 24 + insets.bottom }]}>
        <View style={styles.iconWrap}>
          <Ionicons name={isAttach ? "link-outline" : "git-compare-outline"} size={26} color={Colors.accent} />
        </View>
        <Text style={styles.eyebrow}>{isAttach ? "ATTACH TO A TASK" : "CONFIRM THE MATCH"}</Text>
        <Text style={styles.title} numberOfLines={2}>{serviceName}</Text>
        <Text style={styles.subtitle}>{isAttach ? "Choose the task this covered." : "Which task did this cover?"}</Text>

        <ListWrap isAttach={isAttach}>
          {visible.map((c, i) => {
            const working = busy && workingTaskId === c.taskId;
            const frozenOut = lockedTaskId !== null && lockedTaskId !== c.taskId;
            const rowDisabled = busy || frozenOut;
            return (
              <Pressable
                key={c.taskId}
                disabled={rowDisabled}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  onSelect(c.taskId, c.taskName);
                }}
                accessibilityRole="button"
                accessibilityLabel={c.taskName}
                accessibilityState={{ disabled: rowDisabled }}
                style={({ pressed }) => [
                  styles.row,
                  working ? styles.rowWorking : null,
                  { opacity: frozenOut ? 0.35 : pressed || (busy && !working) ? 0.6 : 1 },
                ]}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowName} numberOfLines={2}>{c.taskName}</Text>
                  {i === 0 && !errorText && !isAttach ? <Text style={styles.rowTag}>Closest match</Text> : null}
                </View>
                {working ? (
                  <ActivityIndicator size="small" color={Colors.accent} />
                ) : (
                  <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
                )}
              </Pressable>
            );
          })}
        </ListWrap>

        {errorText ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={15} color={Colors.needsAttention} style={styles.errorIcon} />
            <Text style={styles.errorText}>{errorText}</Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          {errorText ? (
            <Pressable
              disabled={busy}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                onRetry();
              }}
              accessibilityRole="button"
              accessibilityLabel="Try again"
              accessibilityState={{ disabled: busy }}
              style={({ pressed }) => [styles.primaryBtn, { opacity: pressed || busy ? 0.85 : 1 }]}
            >
              <Text style={styles.primaryText}>Try again</Text>
            </Pressable>
          ) : null}
          <Pressable
            disabled={busy}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              onSkip();
            }}
            accessibilityRole="button"
            accessibilityLabel={isAttach ? "Don't attach" : "Continue without confirmation"}
            accessibilityState={{ disabled: busy }}
            style={({ pressed }) => [styles.secondaryBtn, { opacity: pressed || busy ? 0.7 : 1 }]}
          >
            <Text style={styles.secondaryText}>{isAttach ? "Don't attach" : "Continue without confirmation"}</Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  content: { paddingHorizontal: 24, paddingTop: 4, alignItems: "stretch" },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    backgroundColor: Colors.accentLight,
    borderWidth: 1,
    borderColor: Colors.accentMuted,
  },
  eyebrow: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    color: Colors.accent,
    letterSpacing: 1.5,
    textAlign: "center",
    marginTop: 12,
  },
  title: {
    fontSize: 19,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
    textAlign: "center",
    marginTop: 6,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    textAlign: "center",
    marginTop: 4,
  },
  list: { marginTop: 16, gap: 8 },
  attachScroll: { flexGrow: 0, maxHeight: 372 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 54,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  rowWorking: { borderColor: Colors.accent },
  rowText: { flex: 1 },
  rowName: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.text },
  rowTag: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textTertiary, marginTop: 2 },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    marginTop: 12,
    backgroundColor: Colors.needsAttentionMuted,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  errorIcon: { flexShrink: 0, marginTop: 1 },
  errorText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
    lineHeight: 17,
  },
  actions: { marginTop: 16, gap: 4 },
  primaryBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    height: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  secondaryBtn: { height: 44, alignItems: "center", justifyContent: "center" },
  secondaryText: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
});
