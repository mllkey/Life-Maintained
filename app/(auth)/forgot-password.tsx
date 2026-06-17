import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Image } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import * as Haptics from "expo-haptics";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSendCode() {
    const trimmed = email.trim();
    if (!EMAIL_REGEX.test(trimmed)) {
      setError("Please enter a valid email address");
      return;
    }
    setIsLoading(true);
    setError(null);
    const startedAt = Date.now();
    const { error: err } = await supabase.auth.resetPasswordForEmail(trimmed);
    const elapsed = Date.now() - startedAt;
    if (elapsed < 700) await new Promise((r) => setTimeout(r, 700 - elapsed));
    setIsLoading(false);
    if (err) {
      setError("Couldn't send a code right now. Please try again in a moment.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.push({ pathname: "/reset-password", params: { email: trimmed } });
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.container, { backgroundColor: Colors.background }]}>
        <View style={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={22} color={Colors.text} />
          </Pressable>
          <View style={styles.formContainer}>
            <Image source={require("@/assets/images/brand-logo.png")} style={{ width: 64, height: 64, alignSelf: "center", marginBottom: 4 }} resizeMode="contain" />
            <Text style={styles.title}>Reset password</Text>
            <Text style={styles.subtitle}>Enter your email and we'll send you a 6-digit reset code.</Text>
            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color={Colors.overdue} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="mail-outline" size={18} color={Colors.textTertiary} style={styles.inputIcon} />
                <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor={Colors.textTertiary} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" autoFocus returnKeyType="done" onSubmitEditing={handleSendCode} />
              </View>
            </View>
            <Pressable style={({ pressed }) => [styles.primaryButton, { opacity: pressed ? 0.85 : 1 }]} onPress={handleSendCode} disabled={isLoading}>
              {isLoading ? <ActivityIndicator color={Colors.textInverse} /> : <Text style={styles.primaryButtonText}>Send reset code</Text>}
            </Pressable>
            <Pressable onPress={() => router.back()} style={styles.backLink}>
              <Text style={styles.backLinkText}>Back to <Text style={styles.backLinkAccent}>Sign In</Text></Text>
            </Pressable>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 20 },
  backButton: { width: 40, height: 40, justifyContent: "center", marginBottom: 16 },
  formContainer: { gap: 20 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", color: Colors.text },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, lineHeight: 22 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.overdueMuted, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: Colors.overdue + "30" },
  errorText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.overdue },
  inputGroup: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  inputWrapper: { flexDirection: "row", alignItems: "center", backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 20, height: 52 },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.text },
  primaryButton: { backgroundColor: Colors.accent, borderRadius: 14, height: 48, alignItems: "center", justifyContent: "center" },
  primaryButtonText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  backLink: { alignItems: "center", justifyContent: "center", minHeight: 44, paddingVertical: 8 },
  backLinkText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  backLinkAccent: { fontFamily: "Inter_600SemiBold", color: Colors.accent },
});
