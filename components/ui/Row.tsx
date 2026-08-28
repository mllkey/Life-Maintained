import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Haptics from "@/lib/haptics";
import { Colors } from "@/constants/colors";
import { Radius } from "@/constants/radius";
import { Spacing } from "@/constants/spacing";
import { DENSE_MAX_FONT_MULTIPLIER } from "@/constants/typography";
import { Text } from "./Text";
import { Icon, type IconName } from "./Icon";
import { usePressScale } from "./usePressScale";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Rows animated on mount: opacity 0 -> 1, translateY 6 -> 0, 180ms, 30ms stagger, first 8 only. */
const APPEAR_MS = 180;
const APPEAR_STAGGER_MS = 30;
const APPEAR_MAX_ROWS = 8;

export interface RowProps {
  title: string;
  subtitle?: string;
  /** Trailing text (e.g. "Personal", "12,400 mi"). */
  value?: string;
  /** Leading SF Symbol. */
  icon?: IconName;
  iconColor?: string;
  /** Optional filled circle behind the icon (Settings style). Pass a muted token. */
  iconBackground?: string;
  /** Custom trailing element (a Switch, a Chip). Replaces value and chevron. */
  trailing?: React.ReactNode;
  onPress?: () => void;
  /** Shown when onPress is set. Pass false for rows that open an inline editor. */
  chevron?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  /** Index in its list; enables the staggered appear animation for indexes 0..7. */
  appearIndex?: number;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function Row({
  title,
  subtitle,
  value,
  icon,
  iconColor = Colors.accent,
  iconBackground,
  trailing,
  onPress,
  chevron = true,
  destructive = false,
  disabled = false,
  appearIndex,
  accessibilityLabel,
  testID,
  style,
}: RowProps) {
  const { animatedStyle, onPressIn, onPressOut } = usePressScale(disabled || !onPress, disabled);
  const titleColor = destructive ? "overdue" : "text";
  const entering =
    appearIndex !== undefined && appearIndex >= 0 && appearIndex < APPEAR_MAX_ROWS
      ? FadeInDown.duration(APPEAR_MS)
          .delay(appearIndex * APPEAR_STAGGER_MS)
          .withInitialValues({ opacity: 0, transform: [{ translateY: 6 }] })
      : undefined;

  const content = (
    <>
      {icon ? (
        <View style={[styles.iconWrap, iconBackground ? { backgroundColor: iconBackground } : null]}>
          <Icon name={icon} size={17} color={destructive ? Colors.overdue : iconColor} weight="semibold" />
        </View>
      ) : null}
      <View style={styles.textCol}>
        <Text variant="headline" color={titleColor} numberOfLines={1} maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="subheadline" color="textSecondary" numberOfLines={2} maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing !== undefined ? (
        trailing
      ) : (
        <View style={styles.trailing}>
          {value ? (
            <Text variant="body" color="textSecondary" numberOfLines={1} maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER}>
              {value}
            </Text>
          ) : null}
          {onPress && chevron ? <Icon name="chevron-forward" size={14} color={Colors.textTertiary} weight="semibold" /> : null}
        </View>
      )}
    </>
  );

  if (!onPress) {
    return (
      <Animated.View entering={entering} style={[styles.row, disabled ? styles.disabled : null, style]} testID={testID}>
        {content}
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={entering}>
      <AnimatedPressable
        onPress={() => {
          if (disabled) return;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          onPress();
        }}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        testID={testID}
        style={[styles.row, animatedStyle, disabled ? styles.disabled : null, style]}
      >
        {content}
      </AnimatedPressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    minHeight: 44,
    paddingVertical: Spacing.rowVertical,
    paddingHorizontal: Spacing.lg,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  textCol: { flex: 1, minWidth: 0, gap: 2 },
  trailing: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, flexShrink: 0 },
  disabled: { opacity: 0.4 },
});
