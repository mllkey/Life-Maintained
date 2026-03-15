import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";

const SEX_OPTIONS = ["male", "female", "other", "prefer_not_to_say"];
const SEX_LABELS: Record<string, string> = {
  male: "Male",
  female: "Female",
  other: "Other",
  prefer_not_to_say: "Prefer not to say",
};

export default function OnboardingProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [dob, setDob] = useState("");
  const [sex, setSex] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  function formatDob(text: string) {
    const digits = text.replace(/\D/g, "");
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
  }

  async function handleContinue() {
    setIsLoading(true);
    try {
      if (user && (dob || sex)) {
        let dateOfBirth: string | null = null;
        if (dob && dob.length === 10) {
          const [month, day, year] = dob.split("/");
          if (month && day && year) {
            dateOfBirth = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
          }
        }
        await supabase.from("health_profiles").upsert({
          user_id: user.id,
          date_of_birth: dateOfBirth,
          sex_at_birth: sex,
          updated_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.error(e);
    }
    setIsLoading(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push("/(onboarding)/complete");
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.container, { backgroundColor: Colors.background }]}>
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={22} color={Colors.text} />
          </Pressable>

          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: "66%" }]} />
          </View>

          <View style={styles.header}>
            <Text style={styles.title}>Health profile</Text>
            <Text style={styles.subtitle}>
              Optional. Used to surface age-appropriate health screening recommendations.
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Date of Birth</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="calendar-outline" size={18} color={Colors.textTertiary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={dob}
                onChangeText={t => setDob(formatDob(t))}
                placeholder="MM/DD/YYYY"
                placeholderTextColor={Colors.textTertiary}
                keyboardType="numeric"
                maxLength={10}
                returnKeyType="done"
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Sex at Birth</Text>
            <View style={styles.sexGrid}>
              {SEX_OPTIONS.map(opt => (
                <Pressable
                  key={opt}
                  style={({ pressed }) => [
                    styles.sexOption,
                    sex === opt && styles.sexOptionSelected,
                    { opacity: pressed ? 0.8 : 1 },
                  ]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setSex(opt === sex ? null : opt);
                  }}
                >
                  <Text style={[styles.sexLabel, sex === opt && styles.sexLabelSelected]}>
                    {SEX_LABELS[opt]}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={18} color={Colors.blue} />
            <Text style={styles.infoText}>
              This data stays private and is only used for health recommendation logic on your device.
            </Text>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.continueButton,
              isLoading && styles.continueDisabled,
              { opacity: pressed ? 0.85 : 1 },
            ]}
            onPress={handleContinue}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color={Colors.textInverse} />
            ) : (
              <Text style={styles.continueText}>Continue</Text>
            )}
          </Pressable>

          <Pressable onPress={handleContinue} style={styles.skipButton}>
            <Text style={styles.skipText}>Skip for now</Text>
          </Pressable>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 20, gap: 24 },

  backButton: { width: 40, height: 40, justifyContent: "center" },

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

  section: { gap: 6 },
  label: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    height: 52,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.text },

  sexGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sexOption: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  sexOptionSelected: { borderColor: Colors.health, backgroundColor: Colors.healthMuted },
  sexLabel: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  sexLabelSelected: { color: Colors.health },

  infoBox: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: Colors.blueMuted,
    borderRadius: 12,
    padding: 14,
    alignItems: "flex-start",
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    lineHeight: 20,
  },

  continueButton: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  continueDisabled: { opacity: 0.4 },
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
