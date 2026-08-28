import { Stack } from "expo-router";
import { StyleSheet, Text, View, Pressable } from "react-native";
import { router } from "expo-router";
import { Colors } from "@/constants/colors";
import { Icon } from "@/components/ui/Icon";
import { Typography } from "@/constants/typography";
import { Radius } from "@/constants/radius";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
        <Icon name="alert-circle-outline" size={48} color={Colors.textTertiary} />
        <Text style={styles.title}>Page not found</Text>
        <Text style={styles.body}>This screen doesn&apos;t exist or the link is broken.</Text>
        <Pressable
          style={({ pressed }) => [styles.button, { opacity: pressed ? 0.85 : 1 }]}
          onPress={() => router.replace("/")}
        >
          <Text style={styles.buttonText}>Go to Dashboard</Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    backgroundColor: Colors.background,
    gap: 12,
  },
  title: {
    ...Typography.title3,
    fontWeight: "700",
    color: Colors.text,
    marginTop: 8,
  },
  body: {
    ...Typography.footnote,
    color: Colors.textSecondary,
    textAlign: "center",
  },
  button: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.lg,
    height: 48,
    paddingHorizontal: 32,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  buttonText: {
    ...Typography.subheadline,
    fontWeight: "600",
    color: Colors.textInverse,
  },
});
