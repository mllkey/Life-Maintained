import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import * as Haptics from "expo-haptics";

const CATEGORIES = [
  {
    id: "vehicles",
    icon: "car-sport-outline" as const,
    label: "Vehicles",
    description: "Cars, trucks, motorcycles & more",
    color: Colors.vehicle,
    bg: Colors.vehicleMuted,
  },
  {
    id: "home",
    icon: "home-outline" as const,
    label: "Home & Property",
    description: "HVAC, roof, appliances & more",
    color: Colors.home,
    bg: Colors.homeMuted,
  },
  {
    id: "health",
    icon: "heart-outline" as const,
    label: "Health",
    description: "Appointments, meds & screenings",
    color: Colors.health,
    bg: Colors.healthMuted,
  },
];

export default function OnboardingSelectScreen() {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(id: string) {
    Haptics.selectionAsync();
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  function handleContinue() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push("/(onboarding)/profile");
  }

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: "33%" }]} />
        </View>

        <View style={styles.header}>
          <Text style={styles.title}>What do you want to track?</Text>
          <Text style={styles.subtitle}>
            Select everything that applies. You can always add more later.
          </Text>
        </View>

        <View style={styles.cards}>
          {CATEGORIES.map(cat => {
            const isSelected = selected.includes(cat.id);
            return (
              <Pressable
                key={cat.id}
                style={({ pressed }) => [
                  styles.card,
                  isSelected && styles.cardSelected,
                  { opacity: pressed ? 0.85 : 1 },
                ]}
                onPress={() => toggle(cat.id)}
              >
                <View style={[styles.cardIcon, { backgroundColor: cat.bg }]}>
                  <Ionicons name={cat.icon} size={18} color={cat.color} />
                </View>
                <View style={styles.cardContent}>
                  <Text style={styles.cardLabel}>{cat.label}</Text>
                  <Text style={styles.cardDesc}>{cat.description}</Text>
                </View>
                <View style={[styles.radio, isSelected && styles.radioSelected]}>
                  {isSelected && (
                    <View style={styles.radioDot} />
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.continueButton,
            { opacity: pressed ? 0.85 : 1 },
          ]}
          onPress={handleContinue}
        >
          <Text style={styles.continueText}>Continue</Text>
        </Pressable>

        <Pressable onPress={handleContinue} style={styles.skipButton}>
          <Text style={styles.skipText}>Skip for now</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 20, gap: 24 },

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

  header: { gap: 8 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", color: Colors.text },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
  },

  cards: { gap: 10 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardSelected: {
    borderColor: Colors.accent,
    backgroundColor: "rgba(232, 147, 58, 0.08)",
  },
  cardIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  cardContent: { flex: 1, gap: 2 },
  cardLabel: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.text },
  cardDesc: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },

  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: { borderColor: Colors.accent, backgroundColor: Colors.accent },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.textInverse,
  },

  continueButton: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  continueText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textInverse,
  },
  skipButton: { alignItems: "center", paddingVertical: 4 },
  skipText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.textTertiary,
  },
});
