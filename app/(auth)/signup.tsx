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
  Image,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "@/constants/colors";
import { Icon } from "@/components/ui/Icon";
import { Typography } from "@/constants/typography";
import { Radius } from "@/constants/radius";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";

export default function SignUpScreen() {
  const insets = useSafeAreaInsets();
  const { signUp } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignUp() {
    if (!email.trim() || !password || !confirmPassword) {
      setError("Please fill in all fields");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError("Please enter a valid email address");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (!/[A-Z]/.test(password)) {
      setError("Password must contain at least one uppercase letter");
      return;
    }
    if (!/[a-z]/.test(password)) {
      setError("Password must contain at least one lowercase letter");
      return;
    }
    if (!/[0-9]/.test(password)) {
      setError("Password must contain at least one number");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    setIsLoading(true);
    setError(null);
    const { error, data } = await signUp(email.trim(), password);
    if (error) {
      setIsLoading(false);
      setError(error.message?.toLowerCase().includes("already") ? "That email is already in use. Try signing in instead." : "Couldn't create your account. Please try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } else if (data?.session) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Session created immediately (email confirmation off) — auth listener will navigate
    } else {
      // No session — email confirmation is required
      setIsLoading(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setError("Check your email to confirm your account, then come back and sign in.");
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: Colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[styles.container, { backgroundColor: Colors.background }]}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Icon name="arrow-back" size={22} color={Colors.text} />
          </Pressable>

          <View style={styles.header}>
            <Image
              source={require("@/assets/images/brand-logo.png")}
              style={{ width: 64, height: 64 }}
              resizeMode="contain"
            />
            <Text style={styles.appName}>LifeMaintained</Text>
            <Text style={styles.tagline}>The app that remembers so you don&apos;t have to.</Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.formTitle}>Create account</Text>
            {error && (
              <View style={styles.errorBox}>
                <Icon name="alert-circle" size={16} color={Colors.overdue} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email</Text>
              <View style={styles.inputWrapper}>
                <Icon name="mail-outline" size={18} color={Colors.textTertiary} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor={Colors.textTertiary}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                  textContentType="emailAddress"
                  returnKeyType="next"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.inputWrapper}>
                <Icon name="lock-closed-outline" size={18} color={Colors.textTertiary} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Min. 8 characters, with uppercase and number"
                  placeholderTextColor={Colors.textTertiary}
                  secureTextEntry={!showPassword}
                  textContentType="newPassword"
                  returnKeyType="next"
                />
                <Pressable onPress={() => setShowPassword(!showPassword)} style={styles.eyeButton}>
                  <Icon
                    name={showPassword ? "eye-off-outline" : "eye-outline"}
                    size={18}
                    color={Colors.textTertiary}
                  />
                </Pressable>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Confirm Password</Text>
              <View style={styles.inputWrapper}>
                <Icon name="lock-closed-outline" size={18} color={Colors.textTertiary} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Confirm password"
                  placeholderTextColor={Colors.textTertiary}
                  secureTextEntry={!showConfirmPassword}
                  textContentType="newPassword"
                  returnKeyType="done"
                  onSubmitEditing={handleSignUp}
                />
                <Pressable onPress={() => setShowConfirmPassword(!showConfirmPassword)} style={styles.eyeButton}>
                  <Icon
                    name={showConfirmPassword ? "eye-off-outline" : "eye-outline"}
                    size={18}
                    color={Colors.textTertiary}
                  />
                </Pressable>
              </View>
            </View>

            <Pressable
              style={({ pressed }) => [styles.primaryButton, { opacity: pressed ? 0.85 : 1 }]}
              onPress={handleSignUp}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color={Colors.textInverse} />
              ) : (
                <Text style={styles.primaryButtonText}>Create Account</Text>
              )}
            </Pressable>

            <View style={styles.legalRow}>
              <Text style={styles.legalText}>By creating an account, you agree to our </Text>
              <Pressable onPress={() => router.push("/terms-of-service")} hitSlop={6}>
                <Text style={styles.legalLink}>Terms of Service</Text>
              </Pressable>
              <Text style={styles.legalText}> and </Text>
              <Pressable onPress={() => router.push("/privacy-policy")} hitSlop={6}>
                <Text style={styles.legalLink}>Privacy Policy</Text>
              </Pressable>
              <Text style={styles.legalText}>.</Text>
            </View>

            <View style={styles.loginRow}>
              <Text style={styles.loginText}>Already have an account?</Text>
              <Pressable onPress={() => router.back()}>
                <Text style={styles.loginLink}>Sign In</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 20, gap: 32 },
  backButton: { width: 40, height: 40, justifyContent: "center" },
  header: { alignItems: "center", gap: 8 },
  appName: { ...Typography.largeTitle, color: Colors.text, textAlign: "center" },
  tagline: { ...Typography.footnote, color: Colors.textSecondary, textAlign: "center" },
  formTitle: { ...Typography.title2, color: Colors.text },
  form: { gap: 16 },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.overdue + "30",
  },
  errorText: { ...Typography.footnote, flex: 1, color: Colors.overdue },
  inputGroup: { gap: 8 },
  label: { ...Typography.footnote, fontWeight: "500", color: Colors.textSecondary },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 20,
    height: 52,
  },
  inputIcon: { marginRight: 12 },
  input: { ...Typography.subheadline, flex: 1, color: Colors.text },
  eyeButton: { padding: 4 },
  primaryButton: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.lg,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  primaryButtonText: { ...Typography.subheadline, fontWeight: "600", color: Colors.textInverse },
  legalRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 12,
  },
  legalText: {
    ...Typography.caption,
    color: Colors.textTertiary,
  },
  legalLink: {
    ...Typography.caption,
    fontWeight: "500",
    color: Colors.accent,
  },
  loginRow: { flexDirection: "row", justifyContent: "center", gap: 8 },
  loginText: { ...Typography.footnote, color: Colors.textSecondary },
  loginLink: { ...Typography.footnote, fontWeight: "600", color: Colors.accent },
});
