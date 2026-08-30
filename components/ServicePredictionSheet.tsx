import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { Icon } from "@/components/ui/Icon";
import { Typography } from "@/constants/typography";
import { Radius } from "@/constants/radius";

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
    () => ({ backgroundColor: Colors.cardElevated, borderTopLeftRadius: 24, borderTopRightRadius: 24 }),
    [],
  );
  const handleIndicatorStyle = useMemo(() => ({ backgroundColor: Colors.border, width: 36, height: 4 }), []);
  const backgroundStyle = useMemo(() => ({ backgroundColor: Colors.cardElevated }), []);

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
              <Icon name="construct-outline" size={22} color={Colors.textSecondary} />
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
                <Icon name="add" size={18} color={Colors.textInverse} />
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
  content: { paddingHorizontal: 20, paddingTop: 4, alignItems: "center", gap: 8 },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  title: { ...Typography.title3, fontWeight: "700", color: Colors.text, textAlign: "center", lineHeight: 26 },
  vehicle: { ...Typography.footnote, fontWeight: "500", color: Colors.textTertiary, textAlign: "center" },
  stats: {
    width: "100%",
    marginTop: 16,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
  },
  statRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 46 },
  statDivider: { height: 1, backgroundColor: Colors.border },
  statLabel: { ...Typography.footnote, fontWeight: "500", color: Colors.textSecondary },
  statValue: { ...Typography.subheadline, fontWeight: "600", color: Colors.text },
  statPending: { ...Typography.footnote, fontWeight: "500", color: Colors.textTertiary },
  caption: { ...Typography.caption, color: Colors.textTertiary, marginTop: 8 },
  actions: { width: "100%", gap: 8, marginTop: 16 },
  primaryBtn: {
    backgroundColor: Colors.vehicle,
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
