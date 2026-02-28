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
import { LinearGradient } from "expo-linear-gradient";

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
      <LinearGradient
        colors={["rgba(0,201,167,0.08)", "transparent"]}
        style={styles.topGradient}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.progress}>
          <View style={[styles.dot, { backgroundColor: Colors.accent }]} />
          <View style={styles.dot} />
          <View style={styles.dot} />
        </View>

        <View style={styles.header}>
          <Text style={styles.step}>Step 1 of 3</Text>
          <Text style={styles.title}>What do you want to track?</Text>
          <Text style={styles.subtitle}>Select everything that applies. You can always add more later.</Text>
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
                  isSelected && { borderColor: cat.color },
                  { opacity: pressed ? 0.85 : 1 },
                ]}
                onPress={() => toggle(cat.id)}
              >
                <View style={[styles.cardIcon, { backgroundColor: cat.bg }]}>
                  <Ionicons name={cat.icon} size={28} color={cat.color} />
                </View>
                <View style={styles.cardContent}>
                  <Text style={styles.cardLabel}>{cat.label}</Text>
                  <Text style={styles.cardDesc}>{cat.description}</Text>
                </View>
                <View style={[styles.checkbox, isSelected && { backgroundColor: cat.color, borderColor: cat.color }]}>
                  {isSelected && <Ionicons name="checkmark" size={14} color={Colors.textInverse} />}
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
          <Ionicons name="arrow-forward" size={18} color={Colors.textInverse} />
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
  topGradient: { position: "absolute", top: 0, left: 0, right: 0, height: 250 },
  scroll: { paddingHorizontal: 24, gap: 28 },
  progress: { flexDirection: "row", gap: 6 },
  dot: { width: 24, height: 4, borderRadius: 2, backgroundColor: Colors.border },
  header: { gap: 8 },
  step: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.accent, textTransform: "uppercase", letterSpacing: 1 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", color: Colors.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.textSecondary, lineHeight: 22 },
  cards: { gap: 12 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  cardSelected: { backgroundColor: Colors.cardElevated },
  cardIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  cardContent: { flex: 1, gap: 2 },
  cardLabel: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  cardDesc: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  continueButton: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  continueText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  skipButton: { alignItems: "center", paddingVertical: 4 },
  skipText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textTertiary },
});
