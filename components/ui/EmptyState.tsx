import React from "react";
import { StyleSheet, View } from "react-native";
import { Radius } from "@/constants/radius";
import { Spacing } from "@/constants/spacing";
import { Text } from "./Text";
import { Icon, type IconName } from "./Icon";
import { Button } from "./Button";
import { TONES, type Tone } from "./tone";

export interface EmptyStateProps {
  icon: IconName;
  tone?: Tone;
  title: string;
  body: string;
  action: { label: string; onPress: () => void };
  /** A quieter alternative under the main action ("or import from a spreadsheet"). */
  secondaryAction?: { label: string; onPress: () => void };
  testID?: string;
}

/** Empty states sell the vision: symbol, one headline, one line, one button. */
export function EmptyState({ icon, tone = "accent", title, body, action, secondaryAction, testID }: EmptyStateProps) {
  const t = TONES[tone];
  return (
    <View style={styles.wrap} testID={testID}>
      <View style={[styles.badge, { backgroundColor: t.muted }]}>
        <Icon name={icon} size={28} color={t.color} weight="semibold" />
      </View>
      <Text variant="headline" align="center">
        {title}
      </Text>
      <Text variant="subheadline" color="textSecondary" align="center" style={styles.body}>
        {body}
      </Text>
      <View style={styles.actions}>
        <Button label={action.label} onPress={action.onPress} fullWidth={false} />
        {secondaryAction ? (
          <Button label={secondaryAction.label} onPress={secondaryAction.onPress} variant="tertiary" fullWidth={false} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", paddingTop: Spacing.xxxxl, paddingHorizontal: Spacing.xxl, gap: Spacing.md },
  badge: { width: 64, height: 64, borderRadius: Radius.pill, alignItems: "center", justifyContent: "center", marginBottom: Spacing.xs },
  body: { maxWidth: 300 },
  actions: { alignItems: "center", gap: Spacing.xs, marginTop: Spacing.sm },
});
