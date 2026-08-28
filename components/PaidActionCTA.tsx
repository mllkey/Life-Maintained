import React from "react";
import { Pressable, Text, StyleSheet, ActivityIndicator, View, Platform } from "react-native";
import { Colors } from "@/constants/colors";
import { Radius } from "@/constants/radius";
import { Typography } from "@/constants/typography";
import { Icon, type IconName } from "@/components/ui/Icon";
import * as Haptics from "expo-haptics";

type Variant = "primary" | "secondary";

interface PaidActionCTAProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  testID?: string;
  accessibilityLabel?: string;
  fullWidth?: boolean;
}

/**
 * Shared CTA primitive for paid surfaces. Single source of truth for
 * height (52), radius (14), typography, and haptic feedback so Paywall,
 * ScanPackModal, Settings tier banner, Manage Subscription card, and any
 * Buy-more CTA stay visually coherent.
 *
 * primary:   filled accent, white text. Purchase / upgrade actions.
 * secondary: bordered card surface, accent text. Manage / restore actions.
 */
export function PaidActionCTA({
  label,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  icon,
  testID,
  accessibilityLabel,
  fullWidth = true,
}: PaidActionCTAProps) {
  const isPrimary = variant === "primary";
  const inactive = loading || disabled;

  return (
    <Pressable
      onPress={() => {
        if (inactive) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress();
      }}
      disabled={inactive}
      testID={testID}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.base,
        isPrimary ? styles.primary : styles.secondary,
        fullWidth ? styles.fullWidth : styles.hugContent,
        { opacity: pressed || inactive ? 0.85 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? Colors.textInverse : Colors.accent} />
      ) : (
        <View style={styles.row}>
          {icon ? (
            <Icon
              name={icon}
              size={16}
              color={isPrimary ? Colors.textInverse : Colors.accent}
              style={styles.icon}
            />
          ) : null}
          <Text style={isPrimary ? styles.primaryText : styles.secondaryText}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 52,
    borderRadius: Radius.lg,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  fullWidth: { alignSelf: "stretch" },
  hugContent: { alignSelf: "flex-start" },
  primary: { backgroundColor: Colors.accent },
  secondary: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  icon: { marginTop: Platform.OS === "ios" ? 0 : 1 },
  primaryText: { ...Typography.subheadline, fontWeight: "700", color: Colors.textInverse },
  secondaryText: { ...Typography.subheadline, fontWeight: "600", color: Colors.accent },
});
