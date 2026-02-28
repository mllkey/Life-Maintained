import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { LinearGradient } from "expo-linear-gradient";

export default function VerifyScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <LinearGradient
        colors={["rgba(0,201,167,0.1)", "transparent"]}
        style={styles.topGradient}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      <View style={[styles.content, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 40 }]}>
        <View style={styles.iconContainer}>
          <Ionicons name="mail-unread-outline" size={56} color={Colors.accent} />
        </View>

        <Text style={styles.title}>Check your email</Text>
        <Text style={styles.body}>
          We sent a verification link to your email address. Click it to activate your account and get started.
        </Text>

        <View style={styles.steps}>
          {[
            { icon: "mail-outline", text: "Open your email app" },
            { icon: "link-outline", text: "Click the verification link" },
            { icon: "checkmark-circle-outline", text: "Come back and sign in" },
          ].map((step, i) => (
            <View key={i} style={styles.step}>
              <View style={styles.stepIcon}>
                <Ionicons name={step.icon as any} size={18} color={Colors.accent} />
              </View>
              <Text style={styles.stepText}>{step.text}</Text>
            </View>
          ))}
        </View>

        <Pressable
          style={({ pressed }) => [styles.button, { opacity: pressed ? 0.85 : 1 }]}
          onPress={() => router.replace("/(auth)")}
        >
          <Text style={styles.buttonText}>Go to Sign In</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topGradient: { position: "absolute", top: 0, left: 0, right: 0, height: 300 },
  content: { flex: 1, paddingHorizontal: 32, alignItems: "center", justifyContent: "center", gap: 24 },
  iconContainer: {
    width: 96,
    height: 96,
    borderRadius: 24,
    backgroundColor: Colors.accentLight,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.accentMuted,
  },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", color: Colors.text, textAlign: "center", letterSpacing: -0.5 },
  body: { fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center", lineHeight: 24 },
  steps: { width: "100%", gap: 12 },
  step: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.accentLight,
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.text },
  button: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    marginTop: 8,
  },
  buttonText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
});
