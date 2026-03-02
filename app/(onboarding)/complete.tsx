import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";

export default function OnboardingCompleteScreen() {
  const insets = useSafeAreaInsets();
  const { user, setOnboardingCompleted } = useAuth();
  const [isSaving, setIsSaving] = useState(false);

  async function handleStart() {
    if (!user) return;
    setIsSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const { error } = await supabase
      .from("profiles")
      .update({ onboarding_completed: true, updated_at: new Date().toISOString() })
      .eq("id", user.id);

    if (error) {
      // Fallback: try upsert in case the row doesn't exist yet
      const { error: upsertError } = await supabase
        .from("profiles")
        .upsert({ id: user.id, onboarding_completed: true, updated_at: new Date().toISOString() });

      if (upsertError) {
        setIsSaving(false);
        Alert.alert("Something went wrong", "Could not save your preferences. Please try again.");
        return;
      }
    }

    // Update in-memory state so index.tsx redirects to tabs immediately
    setOnboardingCompleted(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace("/(tabs)");
  }

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <LinearGradient
        colors={["rgba(0,201,167,0.12)", "transparent"]}
        style={styles.topGradient}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />
      <View style={[styles.content, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 32 }]}>
        <View style={styles.progress}>
          <View style={[styles.dot, { backgroundColor: Colors.accent }]} />
          <View style={[styles.dot, { backgroundColor: Colors.accent }]} />
          <View style={[styles.dot, { backgroundColor: Colors.accent }]} />
        </View>

        <View style={styles.iconContainer}>
          <Ionicons name="checkmark-circle" size={64} color={Colors.accent} />
        </View>

        <View style={styles.textGroup}>
          <Text style={styles.title}>You're all set!</Text>
          <Text style={styles.subtitle}>
            LifeMaintained is ready to help you stay on top of everything. Start by adding your first vehicle, property, or health appointment.
          </Text>
        </View>

        <View style={styles.features}>
          {[
            { icon: "car-outline", label: "Track vehicles & service history", color: Colors.vehicle },
            { icon: "home-outline", label: "Never miss home maintenance", color: Colors.home },
            { icon: "heart-outline", label: "Stay on top of your health", color: Colors.health },
          ].map((f, i) => (
            <View key={i} style={styles.feature}>
              <View style={[styles.featureIcon, { backgroundColor: f.color + "18" }]}>
                <Ionicons name={f.icon as any} size={20} color={f.color} />
              </View>
              <Text style={styles.featureText}>{f.label}</Text>
            </View>
          ))}
        </View>

        <Pressable
          style={({ pressed }) => [styles.button, { opacity: pressed || isSaving ? 0.85 : 1 }]}
          onPress={handleStart}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={Colors.textInverse} />
          ) : (
            <>
              <Text style={styles.buttonText}>Get Started</Text>
              <Ionicons name="arrow-forward" size={18} color={Colors.textInverse} />
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topGradient: { position: "absolute", top: 0, left: 0, right: 0, height: 300 },
  content: { flex: 1, paddingHorizontal: 24, gap: 28 },
  progress: { flexDirection: "row", gap: 6 },
  dot: { width: 24, height: 4, borderRadius: 2, backgroundColor: Colors.border },
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
  textGroup: { gap: 10 },
  title: { fontSize: 32, fontFamily: "Inter_700Bold", color: Colors.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.textSecondary, lineHeight: 24 },
  features: { gap: 12 },
  feature: { flexDirection: "row", alignItems: "center", gap: 12 },
  featureIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  featureText: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.text },
  button: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  buttonText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
});
