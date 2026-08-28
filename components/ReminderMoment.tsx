import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "@/constants/colors";
import { Icon } from "@/components/ui/Icon";
import { Typography } from "@/constants/typography";
import { Radius } from "@/constants/radius";

export type ReminderMomentHandle = {
  present: () => void;
  dismiss: () => void;
};

interface ReminderMomentProps {
  title: string;
  statusLine: string;
  costLine: string | null;
  onMarkDone: () => void;
  onDismiss: () => void;
  accent?: string;
  ringBg?: string;
  ringBorder?: string;
}

export default forwardRef<ReminderMomentHandle, ReminderMomentProps>(function ReminderMoment(
  { title, statusLine, costLine, onMarkDone, onDismiss, accent = Colors.accent, ringBg = Colors.accentLight, ringBorder = Colors.accentMuted },
  ref,
) {
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
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.5} pressBehavior="close" />
    ),
    [],
  );

  const handleStyle = useMemo(
    () => ({ backgroundColor: Colors.cardElevated, borderTopLeftRadius: 24, borderTopRightRadius: 24 }),
    [],
  );
  const handleIndicatorStyle = useMemo(() => ({ backgroundColor: Colors.border, width: 36, height: 4 }), []);
  const backgroundStyle = useMemo(() => ({ backgroundColor: Colors.cardElevated }), []);
  const snapPoints = useMemo(() => ["44%"], []);

  return (
    <BottomSheetModal
      ref={sheetRef}
      index={0}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      backgroundStyle={backgroundStyle}
      handleStyle={handleStyle}
      handleIndicatorStyle={handleIndicatorStyle}
      onDismiss={onDismiss}
    >
      <BottomSheetView style={[styles.content, { paddingBottom: 24 + insets.bottom }]}>
        <View style={[styles.iconWrap, { backgroundColor: ringBg, borderColor: ringBorder }]}>
          <Icon name="shield-checkmark-outline" size={26} color={accent} />
        </View>
        <Text style={[styles.eyebrow, { color: accent }]}>FLAGGED FOR YOU</Text>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        <Text style={styles.statusLine}>{statusLine}</Text>
        {costLine ? (
          <View style={styles.costRow}>
            <Icon name="cash-outline" size={14} color={Colors.good} />
            <Text style={styles.costText}>Typical {costLine}</Text>
          </View>
        ) : null}
        {costLine ? <Text style={styles.costCaption}>Estimate — varies by shop and location</Text> : null}
        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, { backgroundColor: accent, opacity: pressed ? 0.85 : 1 }]}
            onPress={onMarkDone}
            accessibilityRole="button"
            accessibilityLabel="Mark as done"
          >
            <Icon name="checkmark" size={18} color={Colors.textInverse} />
            <Text style={styles.primaryText}>Mark as Done</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.secondaryBtn, { opacity: pressed ? 0.7 : 1 }]}
            onPress={() => sheetRef.current?.dismiss()}
            accessibilityRole="button"
            accessibilityLabel="Not now"
          >
            <Text style={styles.secondaryText}>Not now</Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 4, alignItems: "center", gap: 8 },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: Radius.lg,
    backgroundColor: Colors.accentLight,
    borderWidth: 1,
    borderColor: Colors.accentMuted,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  eyebrow: {
    ...Typography.caption, fontWeight: "600", color: Colors.accent,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  title: { ...Typography.title2, color: Colors.text, textAlign: "center" },
  statusLine: { ...Typography.footnote, fontWeight: "500", color: Colors.overdue, textAlign: "center" },
  costRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  costText: { ...Typography.footnote, fontWeight: "500", color: Colors.good },
  costCaption: { ...Typography.caption, color: Colors.textTertiary },
  actions: { width: "100%", gap: 12, marginTop: 16 },
  primaryBtn: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.lg,
    height: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryText: { ...Typography.subheadline, fontWeight: "600", color: Colors.textInverse },
  secondaryBtn: { height: 44, alignItems: "center", justifyContent: "center" },
  secondaryText: { ...Typography.subheadline, fontWeight: "500", color: Colors.textSecondary },
});
