import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Pressable } from "react-native";
import * as Haptics from "@/lib/haptics";
import { Colors } from "@/constants/colors";
import { Radius } from "@/constants/radius";
import { Spacing } from "@/constants/spacing";
import { Text } from "./Text";
import { Divider } from "./Divider";
import { Icon, type IconName } from "./Icon";

export interface SectionProps {
  /** Uppercase footnote header above the group. */
  title?: string;
  /** Footnote below the group. */
  footer?: string;
  /** Divider left inset. 16 for text-only rows; 56 when rows have a leading icon. */
  dividerInset?: number;
  /** Right-aligned control in the header row (an add button). */
  action?: { label?: string; icon?: IconName; onPress: () => void };
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** A grouped list: header, a `surface` container with hairline dividers between children, footer. */
export function Section({ title, footer, dividerInset = Spacing.lg, action, children, style }: SectionProps) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={style}>
      {title || action ? (
        <View style={action ? styles.headerRow : null}>
          {title ? (
            <Text variant="footnote" color="textSecondary" uppercase style={styles.header}>
              {title}
            </Text>
          ) : (
            <View />
          )}
          {action ? (
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                action.onPress();
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              style={styles.action}
            >
              {action.icon ? <Icon name={action.icon} size={14} color={Colors.accent} /> : null}
              {action.label ? (
                <Text variant="footnote" color="accent" style={styles.actionLabel}>
                  {action.label}
                </Text>
              ) : null}
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <View style={styles.group}>
        {items.map((child, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <Divider inset={dividerInset} /> : null}
            {child}
          </React.Fragment>
        ))}
      </View>
      {footer ? (
        <Text variant="footnote" color="textTertiary" style={styles.footer}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { fontWeight: "600", letterSpacing: 0.4, marginBottom: Spacing.sm, marginLeft: Spacing.lg },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  action: { flexDirection: "row", alignItems: "center", gap: Spacing.xs, marginBottom: Spacing.sm },
  actionLabel: { fontWeight: "600" },
  footer: { marginTop: Spacing.sm, marginLeft: Spacing.lg },
  group: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.borderSubtle,
    overflow: "hidden",
  },
});
