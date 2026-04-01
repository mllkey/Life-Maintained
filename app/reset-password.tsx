import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { getPendingResetUrl, clearPendingResetUrl } from "@/lib/pendingResetUrl";
import * as Haptics from "expo-haptics";

function parseHashParams(url: string): Record<string, string> {
  const hashIndex = url.indexOf("#");
  if (hashIndex === -1) return {};
  const hash = url.substring(hashIndex + 1);
  const params: Record<string, string> = {};
  hash.split("&").forEach((pair) => {
    const eqIndex = pair.indexOf("=");
    if (eqIndex === -1) return;
    const key = decodeURIComponent(pair.substring(0, eqIndex));
    const value = decodeURIComponent(pair.substring(eqIndex + 1));
    params[key] = value;
  });
  return params;
}

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function setupSession() {
      try {
        // Foreground case: URL was captured by _layout.tsx handler
        const pending = getPendingResetUrl();
        const url = pending ?? (await Linking.getInitialURL());
        clearPendingResetUrl();

        if (!url) {
          setSessionError("Invalid reset link. Please request a new password reset.");
          setIsVerifying(false);
          return;
        }

        // Implicit flow: hash contains access_token + type=recovery
        const hashParams = parseHashParams(url);
        if (hashParams.type === "recovery" && hashParams.access_token) {
          const { error } = await supabase.auth.setSession({
            access_token: hashParams.access_token,
            refresh_token: hashParams.refresh_token ?? "",
          });
          if (error) {
            setSessionError("Reset link has expired. Please request a new one.");
          }
          setIsVerifying(false);
          return;
        }

        // PKCE flow: query param code
        const parsed = Linking.parse(url);
        const code = parsed.queryParams?.code as string | undefined;
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            setSessionError("Reset link has expired. Please request a new one.");
          }
          setIsVerifying(false);
          return;
        }

        setSessionError("Invalid reset link. Please request a new password reset.");
        setIsVerifying(false);
      } catch {
        setSessionError("Something went wrong. Please request a new password reset.");
        setIsVerifying(false);
      }
    }

    setupSession();
  }, []);

  async function handleUpdatePassword() {
    if (!password || !confirmPassword) {
      setError("Please fill in both fields");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    setIsLoading(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setIsLoading(false);
      setError(error.message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    await supabase.auth.signOut();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace("/(auth)");
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[styles.container, { backgroundColor: Colors.background }]}>
        <View style={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 40 }]}>
          {isVerifying ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={Colors.accent} />
              <Text style={styles.verifyingText}>Verifying reset link...</Text>
            </View>
          ) : sessionError ? (
            <View style={styles.centered}>
              <Ionicons name="alert-circle-outline" size={48} color={Colors.overdue} />
              <Text style={styles.errorTitle}>Link Expired</Text>
              <Text style={styles.errorSubtitle}>{sessionError}</Text>
              <Pressable
                style={({ pressed }) => [styles.primaryButton, { opacity: pressed ? 0.85 : 1, marginTop: 8 }]}
                onPress={() => router.replace("/(auth)/forgot-password")}
              >
                <Text style={styles.primaryButtonText}>Request New Link</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.formContainer}>
              <Text style={styles.title}>Set new password</Text>
              <Text style={styles.subtitle}>Choose a strong password for your account.</Text>

              {error && (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle" size={16} color={Colors.overdue} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              <View style={styles.inputGroup}>
                <Text style={styles.label}>New Password</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="lock-closed-outline" size={18} color={Colors.textTertiary} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Min. 6 characters"
                    placeholderTextColor={Colors.textTertiary}
                    secureTextEntry={!showPassword}
                    textContentType="newPassword"
                    returnKeyType="next"
                    autoFocus
                  />
                  <Pressable onPress={() => setShowPassword(!showPassword)} style={styles.eyeButton}>
                    <Ionicons
                      name={showPassword ? "eye-off-outline" : "eye-outline"}
                      size={18}
                      color={Colors.textTertiary}
                    />
                  </Pressable>
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Confirm New Password</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="lock-closed-outline" size={18} color={Colors.textTertiary} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder="Confirm password"
                    placeholderTextColor={Colors.textTertiary}
                    secureTextEntry={!showConfirmPassword}
                    textContentType="newPassword"
                    returnKeyType="done"
                    onSubmitEditing={handleUpdatePassword}
                  />
                  <Pressable onPress={() => setShowConfirmPassword(!showConfirmPassword)} style={styles.eyeButton}>
                    <Ionicons
                      name={showConfirmPassword ? "eye-off-outline" : "eye-outline"}
                      size={18}
                      color={Colors.textTertiary}
                    />
                  </Pressable>
                </View>
              </View>

              <Pressable
                style={({ pressed }) => [styles.primaryButton, { opacity: pressed ? 0.85 : 1 }]}
                onPress={handleUpdatePassword}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator color={Colors.textInverse} />
                ) : (
                  <Text style={styles.primaryButtonText}>Update Password</Text>
                )}
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 20 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  verifyingText: { fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  errorTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.text, textAlign: "center" },
  errorSubtitle: {
    fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary,
    textAlign: "center", lineHeight: 22, paddingHorizontal: 16,
  },
  formContainer: { gap: 20, paddingTop: 40 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", color: Colors.text },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, lineHeight: 22 },
  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: Colors.overdueMuted, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: Colors.overdue + "30",
  },
  errorText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.overdue },
  inputGroup: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  inputWrapper: {
    flexDirection: "row", alignItems: "center", backgroundColor: Colors.card,
    borderRadius: 14, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 20, height: 52,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.text },
  eyeButton: { padding: 4 },
  primaryButton: {
    backgroundColor: Colors.accent, borderRadius: 14, height: 48,
    alignItems: "center", justifyContent: "center",
  },
  primaryButtonText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
});
