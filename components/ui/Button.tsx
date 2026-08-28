import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import * as Haptics from "@/lib/haptics";
import { Colors } from "@/constants/colors";
import { Radius } from "@/constants/radius";
import { Spacing } from "@/constants/spacing";
import { Text } from "./Text";
import { Icon, type IconName } from "./Icon";
import { usePressScale } from "./usePressScale";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "destructive";

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  /** Stretch to the container (default) or hug the label. */
  fullWidth?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const LABEL_COLOR: Record<ButtonVariant, keyof typeof Colors> = {
  primary: "textInverse",
  secondary: "text",
  tertiary: "accent",
  destructive: "white",
};

/** 50pt, radius 12, headline label. Primary and destructive commit (impactMedium); the rest are light. */
export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  loading = false,
  disabled = false,
  fullWidth = true,
  accessibilityLabel,
  testID,
  style,
}: ButtonProps) {
  const inactive = loading || disabled;
  const { animatedStyle, onPressIn, onPressOut } = usePressScale(inactive, disabled);
  const labelColor = LABEL_COLOR[variant];
  const commits = variant === "primary" || variant === "destructive";

  return (
    <AnimatedPressable
      onPress={() => {
        if (inactive) return;
        Haptics.impactAsync(commits ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress();
      }}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled, busy: loading }}
      testID={testID}
      style={[
        styles.base,
        styles[variant],
        fullWidth ? styles.fullWidth : styles.hug,
        animatedStyle,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      <View style={[styles.content, loading ? styles.hidden : null]}>
        {icon ? <Icon name={icon} size={17} color={Colors[labelColor]} weight="semibold" /> : null}
        <Text variant="headline" color={labelColor} numberOfLines={1}>
          {label}
        </Text>
      </View>
      {loading ? (
        <View style={styles.spinner} pointerEvents="none">
          <ActivityIndicator color={Colors[labelColor]} />
        </View>
      ) : null}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 50,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  primary: { backgroundColor: Colors.accent },
  secondary: {
    backgroundColor: Colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  tertiary: { backgroundColor: "transparent" },
  destructive: { backgroundColor: Colors.overdue },
  fullWidth: { alignSelf: "stretch" },
  hug: { alignSelf: "flex-start" },
  content: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  hidden: { opacity: 0 },
  spinner: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.4 },
});
