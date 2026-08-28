import { View, Text, Pressable, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { Radius } from "@/constants/radius";
import { Typography } from "@/constants/typography";
import { Icon, type IconName } from "@/components/ui/Icon";

export default function LoadErrorState({
  onRetry,
  title = "Unable to load",
  body = "Your data is saved and safe. Check your connection and try again.",
  icon = "cloud-offline-outline",
  retryAccessibilityLabel = "Try again",
}: {
  onRetry: () => void;
  title?: string;
  body?: string;
  icon?: IconName;
  retryAccessibilityLabel?: string;
}) {
  return (
    <View style={styles.errorWrap}>
      <Icon name={icon} size={34} color={Colors.textSecondary} />
      <Text style={styles.errorTitle}>{title}</Text>
      <Text style={styles.errorBody}>{body}</Text>
      <Pressable
        style={({ pressed }) => [styles.errorRetry, { opacity: pressed ? 0.85 : 1 }]}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onRetry(); }}
        accessibilityRole="button"
        accessibilityLabel={retryAccessibilityLabel}
      >
        <Icon name="refresh" size={16} color={Colors.textInverse} />
        <Text style={styles.errorRetryText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  errorWrap: { flex: 1, paddingTop: 80, paddingHorizontal: 24, alignItems: "center", gap: 12 },
  errorTitle: { ...Typography.headline, color: Colors.text, textAlign: "center" },
  errorBody: { ...Typography.footnote, color: Colors.textSecondary, textAlign: "center", maxWidth: 300 },
  errorRetry: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.accent, paddingHorizontal: 20, paddingVertical: 12, borderRadius: Radius.md, marginTop: 4 },
  errorRetryText: { ...Typography.subheadline, fontWeight: "600", color: Colors.textInverse },
});
