import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { Typography } from "@/constants/typography";
import { Radius } from "@/constants/radius";
import { Icon } from "@/components/ui/Icon";

/**
 * Entry point for the Confirm-history flow. Rendered above the task list on
 * the vehicle and property detail screens whenever uncalibrated estimates
 * exist. Owns the urgency those rows are not allowed to claim.
 */
export function CalibrationEntryCard({
  count,
  tint,
  onPress,
}: {
  count: number;
  tint: string;
  onPress: () => void;
}) {
  if (count <= 0) return null;
  const title =
    count === 1 ? "1 due date is an estimate" : `${count} due dates are estimates`;
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
      accessibilityLabel={`${title}. Confirm history.`}
    >
      <View style={[styles.iconWrap, { backgroundColor: tint + "22" }]}>
        <Icon name="sparkles-outline" size={18} color={tint} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.sub}>
          Answer a few quick questions to make your schedule accurate.
        </Text>
      </View>
      <View style={[styles.button, { backgroundColor: tint }]}>
        <Text style={styles.buttonText}>Confirm history</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { ...Typography.subheadline, color: Colors.text, fontWeight: "600" },
  sub: { ...Typography.footnote, color: Colors.textSecondary, marginTop: 1 },
  button: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.sm,
  },
  buttonText: { ...Typography.footnote, color: Colors.textInverse, fontWeight: "700" },
});
