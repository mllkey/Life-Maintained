import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Colors } from "@/constants/colors";
import { Radius } from "@/constants/radius";
import { Typography } from "@/constants/typography";

/**
 * The monthly budget input. Presentational and controlled: the owner decides
 * when to persist (Settings saves with its global Save; the dashboard sheet
 * saves on its own button) so there is exactly one input and one save path
 * (lib/budget.ts) across the app.
 */
export function BudgetThresholdControl({
  value,
  onChangeText,
  currentThreshold,
  autoFocus,
  onSubmitEditing,
}: {
  value: string;
  onChangeText: (v: string) => void;
  /** Persisted value, shown as "Current: $X/mo" when known. */
  currentThreshold?: number | null;
  autoFocus?: boolean;
  onSubmitEditing?: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.hint}>
        We&apos;ll notify you when upcoming maintenance costs in a given month exceed this amount.
      </Text>
      <View style={styles.inputRow}>
        <View style={styles.inputWrap}>
          <Text style={styles.currency}>$</Text>
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={onChangeText}
            placeholder="500"
            placeholderTextColor={Colors.textTertiary}
            keyboardType="decimal-pad"
            returnKeyType="done"
            autoFocus={autoFocus}
            onSubmitEditing={onSubmitEditing}
            accessibilityLabel="Monthly budget amount"
          />
        </View>
        <Text style={styles.label}>monthly threshold</Text>
      </View>
      {currentThreshold != null && (
        <Text style={styles.saved}>Current: ${Number(currentThreshold).toLocaleString()}/mo</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  hint: { ...Typography.footnote, color: Colors.textSecondary },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 120,
  },
  currency: { ...Typography.body, fontWeight: "500", color: Colors.textSecondary },
  input: { ...Typography.body, color: Colors.text, minWidth: 70, padding: 0 },
  label: { ...Typography.footnote, color: Colors.textTertiary },
  saved: { ...Typography.caption, color: Colors.textTertiary },
});
