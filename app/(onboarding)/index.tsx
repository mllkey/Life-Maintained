import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";

const VERTICALS = [
  {
    id: "vehicle",
    icon: "car-sport-outline" as const,
    title: "Vehicle",
    badge: "Recommended",
    subtitle: "Fastest way to see value",
    body: "Add your year, make, model, and current mileage. We\u2019ll build a personalized maintenance plan.",
    color: Colors.accent,
  },
  {
    id: "home",
    icon: "home-outline" as const,
    title: "Home",
    badge: null,
    subtitle: "Best for homeowners",
    body: "Add your address and property type. We\u2019ll build a home maintenance plan with seasonal tasks.",
    color: Colors.home,
  },
  {
    id: "health",
    icon: "heart-outline" as const,
    title: "Health",
    badge: null,
    subtitle: "Appointments & preventive care",
    body: "Track appointments, medications, and age-based care suggestions for you and your family.",
    color: Colors.health,
  },
];

export default function OnboardingStartScreen() {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState("vehicle");
  const { setOnboardingCompleted, user } = useAuth();

  async function completeAndGo(destination: string, thenPush?: string) {
    try {
      if (user) {
        await supabase.from("profiles").upsert(
          { user_id: user.id, onboarding_completed: true, updated_at: new Date().toISOString() },
          { onConflict: "user_id" }
        );
      }
      await AsyncStorage.setItem("@onboarding_completed", "true");
      setOnboardingCompleted(true);
      router.replace(destination as any);
      if (thenPush) {
        setTimeout(() => router.push(thenPush as any), 400);
      }
    } catch (e) {
      if (__DEV__) console.error("[onboarding] complete error:", e);
    }
  }

  function handleContinue() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (selected === "vehicle") {
      // Use push so user can go back to this screen
      router.push("/(onboarding)/vehicle-quick-add");
    } else if (selected === "home") {
      // Complete onboarding, go to tabs, then open add-property
      completeAndGo("/(tabs)", "/add-property");
    } else {
      // Complete onboarding, go to tabs (health tab will prompt health profile setup inline)
      completeAndGo("/(tabs)");
    }
  }

  async function handleFinishLater() {
    Haptics.selectionAsync();
    await completeAndGo("/(tabs)");
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 20 }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Progress */}
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: "25%" }]} />
        </View>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Start with one thing you own</Text>
          <Text style={styles.subtitle}>
            We'll build your first maintenance plan in under a minute.
          </Text>
        </View>

        {/* Cards */}
        <View style={styles.cards}>
          {VERTICALS.map(v => {
            const isSelected = selected === v.id;
            return (
              <Pressable
                key={v.id}
                style={[
                  styles.card,
                  isSelected && { borderColor: v.color, backgroundColor: `${v.color}10` },
                ]}
                onPress={() => { Haptics.selectionAsync(); setSelected(v.id); }}
              >
                <View style={styles.cardHeader}>
                  <View style={[styles.cardIcon, { backgroundColor: `${v.color}20` }]}>
                    <Ionicons name={v.icon} size={22} color={v.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={styles.cardTitle}>{v.title}</Text>
                      {v.badge && (
                        <View style={[styles.badge, { backgroundColor: `${v.color}20` }]}>
                          <Text style={[styles.badgeText, { color: v.color }]}>{v.badge}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.cardSubtitle}>{v.subtitle}</Text>
                  </View>
                  <View style={[styles.radio, isSelected && { borderColor: v.color, backgroundColor: v.color }]}>
                    {isSelected && <View style={styles.radioDot} />}
                  </View>
                </View>
                <Text style={styles.cardBody}>{v.body}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* CTA */}
        <Pressable
          style={({ pressed }) => [styles.cta, { opacity: pressed ? 0.85 : 1 }]}
          onPress={handleContinue}
        >
          <Text style={styles.ctaText}>Continue</Text>
        </Pressable>

        <Pressable onPress={handleFinishLater} style={styles.skip}>
          <Text style={styles.skipText}>Finish later</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: 20, gap: 24 },
  progressBar: { height: 3, borderRadius: 2, backgroundColor: Colors.border, overflow: "hidden" },
  progressFill: { height: 3, borderRadius: 2, backgroundColor: Colors.accent },
  header: { gap: 8 },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", color: Colors.text },
  subtitle: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.textSecondary, lineHeight: 22 },
  cards: { gap: 12 },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  cardSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, marginTop: 1 },
  cardBody: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textTertiary, lineHeight: 19 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: Colors.border, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#FFFFFF" },
  cta: { backgroundColor: Colors.accent, borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: "#0C111B" },
  skip: { alignItems: "center", paddingVertical: 4 },
  skipText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
});
