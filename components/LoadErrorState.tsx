import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";

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
  icon?: keyof typeof Ionicons.glyphMap;
  retryAccessibilityLabel?: string;
}) {
  return (
    <View style={styles.errorWrap}>
      <Ionicons name={icon} size={34} color={Colors.textSecondary} />
      <Text style={styles.errorTitle}>{title}</Text>
      <Text style={styles.errorBody}>{body}</Text>
      <Pressable
        style={({ pressed }) => [styles.errorRetry, { opacity: pressed ? 0.85 : 1 }]}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onRetry(); }}
        accessibilityRole="button"
        accessibilityLabel={retryAccessibilityLabel}
      >
        <Ionicons name="refresh" size={16} color={Colors.textInverse} />
        <Text style={styles.errorRetryText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  errorWrap: { flex: 1, paddingTop: 80, paddingHorizontal: 24, alignItems: "center", gap: 12 },
  errorTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text, textAlign: "center" },
  errorBody: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center", lineHeight: 20, maxWidth: 300 },
  errorRetry: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: Colors.accent, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 12, marginTop: 4 },
  errorRetryText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
});
