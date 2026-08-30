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
import { LinearGradient } from "expo-linear-gradient";
import { Colors } from "@/constants/colors";
import { Icon } from "@/components/ui/Icon";
import { Typography } from "@/constants/typography";
import { Radius } from "@/constants/radius";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    if (!email.trim() || !password.trim()) {
      setError("Please fill in all fields");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError("Please enter a valid email address");
      return;
    }
    setIsLoading(true);
    setError(null);
    const { error } = await signIn(email.trim(), password);
    if (error) {
      setIsLoading(false);
      setError(error.message?.toLowerCase().includes("invalid") ? "Incorrect email or password." : "Couldn't sign you in. Please try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Keep isLoading true — the Supabase auth listener will fire SIGNED_IN,
      // update user state, and the root routing guard will redirect automatically.
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: Colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[styles.container, { backgroundColor: Colors.background }]}>
        <LinearGradient
          colors={["rgba(232,147,58,0.06)", "transparent"]}
          style={styles.topGradient}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
        />

        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
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
            <Text style={styles.formTitle}>Welcome back</Text>

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
                  placeholder="••••••••"
                  placeholderTextColor={Colors.textTertiary}
                  secureTextEntry={!showPassword}
                  autoComplete="password"
                  textContentType="password"
                  returnKeyType="done"
                  onSubmitEditing={handleSignIn}
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

            <Pressable onPress={() => router.push("/(auth)/forgot-password")} style={styles.forgotLink}>
              <Text style={styles.forgotLinkText}>Forgot password?</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.primaryButton, { opacity: pressed ? 0.85 : 1 }]}
              onPress={handleSignIn}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color={Colors.textInverse} />
              ) : (
                <Text style={styles.primaryButtonText}>Sign In</Text>
              )}
            </Pressable>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <Pressable
              style={({ pressed }) => [styles.secondaryButton, { opacity: pressed ? 0.8 : 1 }]}
              onPress={() => router.push("/(auth)/signup")}
            >
              <Text style={styles.secondaryButtonText}>Create an account</Text>
            </Pressable>
          </View>

        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topGradient: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 300,
  },
  scroll: { paddingHorizontal: 24, gap: 32 },
  header: { alignItems: "center", gap: 8 },
  appName: {
    ...Typography.largeTitle,
    color: Colors.text,
  },
  tagline: {
    ...Typography.footnote,
    color: Colors.textSecondary,
  },
  form: { gap: 16 },
  formTitle: {
    ...Typography.title2,
    color: Colors.text,
    marginBottom: 4,
  },
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
  errorText: {
    ...Typography.footnote,
    flex: 1,
    color: Colors.overdue,
  },
  inputGroup: { gap: 8 },
  label: {
    ...Typography.footnote,
    fontWeight: "500",
    color: Colors.textSecondary,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    height: 52,
  },
  inputIcon: { marginRight: 12 },
  input: {
    ...Typography.subheadline,
    flex: 1,
    color: Colors.text,
  },
  eyeButton: { padding: 4 },
  forgotLink: { alignSelf: "flex-end", paddingVertical: 2 },
  forgotLinkText: { ...Typography.footnote, fontWeight: "500", color: Colors.accent },
  primaryButton: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.lg,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  primaryButtonText: {
    ...Typography.subheadline,
    fontWeight: "600",
    color: Colors.textInverse,
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: {
    ...Typography.footnote,
    color: Colors.textTertiary,
  },
  secondaryButton: {
    borderRadius: Radius.lg,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  secondaryButtonText: {
    ...Typography.subheadline,
    fontWeight: "500",
    color: Colors.text,
  },
});
