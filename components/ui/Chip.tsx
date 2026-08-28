import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "@/lib/haptics";
import { Colors } from "@/constants/colors";
import { Radius } from "@/constants/radius";
import { Spacing } from "@/constants/spacing";
import { Text } from "./Text";
import { Icon, type IconName } from "./Icon";
import { TONES, type Tone } from "./tone";

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  tone?: Tone;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

/** 32pt pill-less chip, radius 8. Selection haptic fires after the handler so it trails the visual commit. */
export function Chip({ label, selected = false, onPress, icon, tone = "accent", disabled = false, accessibilityLabel, testID }: ChipProps) {
  const t = TONES[tone];
  const fg = selected ? t.color : Colors.textSecondary;

  const inner = (
    <View style={[styles.chip, selected ? { backgroundColor: t.muted, borderColor: t.color } : styles.idle, disabled ? styles.disabled : null]}>
      {icon ? <Icon name={icon} size={14} color={fg} weight="semibold" /> : null}
      <Text variant="footnote" style={[styles.label, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );

  if (!onPress) return inner;

  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        onPress();
        Haptics.selectionAsync().catch(() => {});
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
      hitSlop={Spacing.xs}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {inner}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    height: 32,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  idle: { backgroundColor: Colors.surface, borderColor: Colors.border },
  label: { fontWeight: "600" },
  disabled: { opacity: 0.4 },
});
