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
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";

export type ServicePredictionSheetHandle = {
  present: () => void;
  dismiss: () => void;
};

export type ServicePredictionSheetData = {
  name: string;
  vehicleLabel: string;
  intervalLabel: string;
  dueLabel: string;
  dueColor: string;
  costLabel: string | null;
};

interface ServicePredictionSheetProps {
  data: ServicePredictionSheetData | null;
  onLogService: () => void;
  onViewVehicle: () => void;
}

export default forwardRef<ServicePredictionSheetHandle, ServicePredictionSheetProps>(function ServicePredictionSheet(
  { data, onLogService, onViewVehicle },
  ref,
) {
  const insets = useSafeAreaInsets();
  const sheetRef = useRef<BottomSheetModal>(null);

  useImperativeHandle(
    ref,
    () => ({
      present: () => { sheetRef.current?.present(); },
      dismiss: () => { sheetRef.current?.dismiss(); },
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

  const handleLog = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    sheetRef.current?.dismiss();
    onLogService();
  }, [onLogService]);

  const handleView = useCallback(() => {
    Haptics.selectionAsync();
    sheetRef.current?.dismiss();
    onViewVehicle();
  }, [onViewVehicle]);

  return (
    <BottomSheetModal
      ref={sheetRef}
      enableDynamicSizing
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      backgroundStyle={backgroundStyle}
      handleStyle={handleStyle}
      handleIndicatorStyle={handleIndicatorStyle}
    >
      <BottomSheetView style={[styles.content, { paddingBottom: 20 + insets.bottom }]}>
        {data ? (
          <>
            <View style={styles.iconWrap}>
              <Ionicons name="construct-outline" size={22} color={Colors.vehicle} />
            </View>
            <Text style={styles.title}>{data.name}</Text>
            <Text style={styles.vehicle}>{data.vehicleLabel}</Text>

            <View style={styles.stats}>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Interval</Text>
                <Text style={styles.statValue}>{data.intervalLabel}</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Next due</Text>
                <Text style={[styles.statValue, { color: data.dueColor }]}>{data.dueLabel}</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Est. cost</Text>
                {data.costLabel ? (
                  <Text style={styles.statValue}>{data.costLabel}</Text>
                ) : (
                  <Text style={styles.statPending}>Estimate pending</Text>
                )}
              </View>
            </View>
            {data.costLabel ? <Text style={styles.caption}>Typical shop price. Varies by shop and location.</Text> : null}

            <View style={styles.actions}>
              <Pressable
                style={({ pressed }) => [styles.primaryBtn, { opacity: pressed ? 0.85 : 1 }]}
                onPress={handleLog}
                accessibilityRole="button"
                accessibilityLabel="Log this service"
              >
                <Ionicons name="add" size={18} color={Colors.textInverse} />
                <Text style={styles.primaryText}>Log this service</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.secondaryBtn, { opacity: pressed ? 0.7 : 1 }]}
                onPress={handleView}
                accessibilityRole="button"
                accessibilityLabel="View vehicle"
              >
                <Text style={styles.secondaryText}>View vehicle</Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </BottomSheetView>
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 4, alignItems: "center", gap: 6 },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  title: { fontSize: 20, fontFamily: "Inter_700Bold", color: Colors.text, textAlign: "center", lineHeight: 26 },
  vehicle: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textTertiary, textAlign: "center" },
  stats: {
    width: "100%",
    marginTop: 14,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
  },
  statRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 46 },
  statDivider: { height: 1, backgroundColor: Colors.border },
  statLabel: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  statValue: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.text },
  statPending: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.textTertiary },
  caption: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textTertiary, marginTop: 6 },
  actions: { width: "100%", gap: 6, marginTop: 14 },
  primaryBtn: {
    backgroundColor: Colors.vehicle,
    borderRadius: 14,
    height: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  primaryText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  secondaryBtn: { height: 44, alignItems: "center", justifyContent: "center" },
  secondaryText: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
});
