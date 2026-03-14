import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, Image, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { Colors } from "@/constants/colors";

export default function OnboardingCompleteScreen() {
  const insets = useSafeAreaInsets();
  const { user, setOnboardingCompleted } = useAuth();
  const [isSaving, setIsSaving] = useState(false);

  async function completeOnboarding() {
    if (!user || isSaving) return;
    setIsSaving(true);

    const { error } = await supabase
      .from("profiles")
      .update({ onboarding_completed: true, updated_at: new Date().toISOString() })
      .eq("user_id", user.id);

    if (error) {
      await supabase
        .from("profiles")
        .upsert({ user_id: user.id, onboarding_completed: true, updated_at: new Date().toISOString() });
    }

    setOnboardingCompleted(true);
    router.replace("/(tabs)");
  }

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <View style={[styles.progressBar, { marginTop: insets.top + 40 }]}>
        <View style={[styles.progressFill, { width: "100%" }]} />
      </View>

      <View style={styles.content}>
        <Image
          source={require("@/assets/images/brand-logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>You're all set</Text>
        <Text style={styles.subtitle}>
          Your maintenance hub is ready. Start tracking vehicles, home tasks, and health appointments.
        </Text>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}>
        <Pressable
          style={({ pressed }) => [
            styles.ctaButton,
            isSaving && styles.ctaDisabled,
            { opacity: pressed ? 0.85 : 1 },
          ]}
          onPress={completeOnboarding}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator color={Colors.textInverse} />
          ) : (
            <Text style={styles.ctaText}>Get Started</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20 },

  progressBar: {
    height: 3,
    borderRadius: 2,
    backgroundColor: Colors.border,
    overflow: "hidden",
  },
  progressFill: {
    height: 3,
    borderRadius: 2,
    backgroundColor: Colors.accent,
  },

  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 12,
  },
  logo: { width: 72, height: 72, marginBottom: 8 },
  title: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    color: Colors.text,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },

  footer: { paddingTop: 16 },
  ctaButton: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textInverse,
  },
});
