import React, { useState, useRef, useEffect } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import * as Haptics from "expo-haptics";

const RESEND_SECONDS = 60;
const MAX_FAILED_ATTEMPTS = 5;
const SOFT_LOCK_MS = 60000;

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = (params.email ?? "").trim();

  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(RESEND_SECONDS);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recoverySessionRef = useRef(false);
  const completedRef = useRef(false);

  function startCooldown() {
    if (timerRef.current) clearInterval(timerRef.current);
    setResendIn(RESEND_SECONDS);
    timerRef.current = setInterval(() => {
      setResendIn((s) => {
        if (s <= 1) { if (timerRef.current) clearInterval(timerRef.current); return 0; }
        return s - 1;
      });
    }, 1000);
  }

  useEffect(() => {
    startCooldown();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  async function handleBack() {
    if (isLoading) return;
    if (recoverySessionRef.current && !completedRef.current) {
      await supabase.auth.signOut({ scope: "local" });
      recoverySessionRef.current = false;
    }
    router.replace("/(auth)/forgot-password");
  }

  async function handleResend() {
    if (resendIn > 0 || isResending || !email) return;
    Haptics.selectionAsync();
    setIsResending(true);
    setError(null);
    setFailedAttempts(0);
    setLockedUntil(null);
    startCooldown();
    await supabase.auth.resetPasswordForEmail(email);
    setIsResending(false);
  }

  function validatePassword(): string | null {
    if (!password || !confirmPassword) return "Please fill in both password fields";
    if (password.length < 8) return "Password must be at least 8 characters";
    if (!/[A-Z]/.test(password)) return "Password must include an uppercase letter";
    if (!/[a-z]/.test(password)) return "Password must include a lowercase letter";
    if (!/[0-9]/.test(password)) return "Password must include a number";
    if (password !== confirmPassword) return "Passwords don't match";
    return null;
  }

  async function handleUpdate() {
    if (isLoading) return;
    if (!email) { setError("Something went wrong. Please request a new code."); return; }
    if (lockedUntil && Date.now() < lockedUntil) {
      setError("Too many attempts. Wait a minute, then try again.");
      return;
    }
    const cleanCode = code.trim();
    if (cleanCode.length !== 6) { setError("Enter the 6-digit code from your email"); return; }
    const pwError = validatePassword();
    if (pwError) { setError(pwError); return; }

    setIsLoading(true);
    setError(null);

    if (!recoverySessionRef.current) {
      const { error: verifyError } = await supabase.auth.verifyOtp({ email, token: cleanCode, type: "recovery" });
      if (verifyError) {
        const nextAttempts = failedAttempts + 1;
        setFailedAttempts(nextAttempts);
        if (nextAttempts >= MAX_FAILED_ATTEMPTS) {
          setFailedAttempts(0);
          setLockedUntil(Date.now() + SOFT_LOCK_MS);
          setError("Too many attempts. Wait a minute, then request a new code if needed.");
        } else {
          setError("That code expired or didn't work. Request a new code and try again.");
        }
        setIsLoading(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      recoverySessionRef.current = true;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setIsLoading(false);
      setError("Couldn't update your password. Try a stronger password, then submit again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    completedRef.current = true;
    const { error: signOutError } = await supabase.auth.signOut({ scope: "global" });
    if (signOutError) {
      await supabase.auth.signOut({ scope: "local" });
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace("/(auth)");
  }

  const maskedEmail = email || "your email";

  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: Colors.background }]} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.container, { backgroundColor: Colors.background }]}>
        <View style={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 40 }]}>
          <Pressable onPress={handleBack} disabled={isLoading} style={styles.backButton}>
            <Ionicons name="arrow-back" size={22} color={Colors.text} />
          </Pressable>
          <View style={styles.formContainer}>
            <Text style={styles.title}>Enter your code</Text>
            <Text style={styles.subtitle}>We sent a 6-digit code to {maskedEmail}. Enter it below and choose a new password.</Text>

            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color={Colors.overdue} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <View style={styles.inputGroup}>
              <Text style={styles.label}>6-Digit Code</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="keypad-outline" size={18} color={Colors.textTertiary} style={styles.inputIcon} />
                <TextInput style={[styles.input, { letterSpacing: 8, fontFamily: "Inter_600SemiBold" }]} value={code} onChangeText={(t) => setCode(t.replace(/[^0-9]/g, "").slice(0, 6))} placeholder="123456" placeholderTextColor={Colors.textTertiary} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" maxLength={6} autoFocus returnKeyType="next" />
              </View>
              <Pressable onPress={handleResend} disabled={resendIn > 0 || isResending} style={styles.resendRow}>
                <Text style={[styles.resendText, resendIn === 0 && !isResending && styles.resendActive]}>
                  {resendIn > 0 ? `Resend code in 0:${String(resendIn).padStart(2, "0")}` : "Resend code"}
                </Text>
              </Pressable>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>New Password</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="lock-closed-outline" size={18} color={Colors.textTertiary} style={styles.inputIcon} />
                <TextInput style={[styles.input, { flex: 1 }]} value={password} onChangeText={setPassword} placeholder="Min. 8 characters, with uppercase and number" placeholderTextColor={Colors.textTertiary} secureTextEntry={!showPassword} textContentType="newPassword" returnKeyType="next" />
                <Pressable onPress={() => setShowPassword(!showPassword)} style={styles.eyeButton}>
                  <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={18} color={Colors.textTertiary} />
                </Pressable>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Confirm New Password</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="lock-closed-outline" size={18} color={Colors.textTertiary} style={styles.inputIcon} />
                <TextInput style={[styles.input, { flex: 1 }]} value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Confirm password" placeholderTextColor={Colors.textTertiary} secureTextEntry={!showConfirmPassword} textContentType="newPassword" returnKeyType="done" onSubmitEditing={handleUpdate} />
                <Pressable onPress={() => setShowConfirmPassword(!showConfirmPassword)} style={styles.eyeButton}>
                  <Ionicons name={showConfirmPassword ? "eye-off-outline" : "eye-outline"} size={18} color={Colors.textTertiary} />
                </Pressable>
              </View>
            </View>

            <Pressable style={({ pressed }) => [styles.primaryButton, { opacity: pressed ? 0.85 : 1 }]} onPress={handleUpdate} disabled={isLoading}>
              {isLoading ? <ActivityIndicator color={Colors.textInverse} /> : <Text style={styles.primaryButtonText}>Update Password</Text>}
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
  backButton: { width: 40, height: 40, justifyContent: "center", marginBottom: 8 },
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
  eyeButton: { padding: 4 },
  resendRow: { paddingVertical: 6, alignSelf: "flex-start" },
  resendText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textTertiary },
  resendActive: { color: Colors.accent },
  primaryButton: { backgroundColor: Colors.accent, borderRadius: 14, height: 48, alignItems: "center", justifyContent: "center" },
  primaryButtonText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
});
