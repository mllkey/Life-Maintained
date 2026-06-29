import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";

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
}

export default forwardRef<ReminderMomentHandle, ReminderMomentProps>(function ReminderMoment(
  { title, statusLine, costLine, onMarkDone, onDismiss },
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
    () => ({ backgroundColor: Colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24 }),
    [],
  );
  const handleIndicatorStyle = useMemo(() => ({ backgroundColor: Colors.border, width: 36, height: 4 }), []);
  const backgroundStyle = useMemo(() => ({ backgroundColor: Colors.card }), []);
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
        <View style={styles.iconWrap}>
          <Ionicons name="shield-checkmark-outline" size={26} color={Colors.accent} />
        </View>
        <Text style={styles.eyebrow}>FLAGGED FOR YOU</Text>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        <Text style={styles.statusLine}>{statusLine}</Text>
        {costLine ? (
          <View style={styles.costRow}>
            <Ionicons name="cash-outline" size={14} color={Colors.good} />
            <Text style={styles.costText}>Typical {costLine}</Text>
          </View>
        ) : null}
        {costLine ? <Text style={styles.costCaption}>Estimate — varies by shop and location</Text> : null}
        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, { opacity: pressed ? 0.85 : 1 }]}
            onPress={onMarkDone}
            accessibilityRole="button"
            accessibilityLabel="Mark this service done"
          >
            <Ionicons name="checkmark" size={18} color={Colors.textInverse} />
            <Text style={styles.primaryText}>Mark it done</Text>
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
  content: { paddingHorizontal: 20, paddingTop: 4, alignItems: "center", gap: 6 },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: Colors.accentLight,
    borderWidth: 1,
    borderColor: Colors.accentMuted,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  eyebrow: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.accent,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.text, textAlign: "center" },
  statusLine: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.overdue, textAlign: "center" },
  costRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  costText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.good },
  costCaption: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
  actions: { width: "100%", gap: 10, marginTop: 16 },
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
