import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import * as Sentry from "@sentry/react-native";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { Typography } from "@/constants/typography";
import { Radius } from "@/constants/radius";
import { Icon } from "@/components/ui/Icon";
import { useAuth } from "@/context/AuthContext";
import { LegalAgreementRow, type LegalAgreementRowHandle } from "@/components/LegalAgreementRow";
import { needsTermsAcceptance } from "@/lib/legalDates";

const SAVE_ERROR = "Couldn't save your agreement. Check your connection and try again.";
const SIGNOUT_ERROR = "Couldn't sign out. Please try again.";

/** Non-dismissable review sheet. Entry: content opacity 0 -> 1, translateY 12 -> 0, 360ms ease-out. */
export default function AcceptTermsScreen() {
  const insets = useSafeAreaInsets();
  const { session, isLoading, profileLoaded, profile, acceptTerms, signOut } = useAuth();
  const reduceMotion = useReducedMotion();

  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const agreementRef = useRef<LegalAgreementRowHandle>(null);
  const entry = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    entry.value = withTiming(1, { duration: reduceMotion ? 0 : 360, easing: Easing.out(Easing.ease) });
  }, [entry, reduceMotion]);

  // Single navigation owner for every exit from this sheet: signed out -> auth,
  // profile current (or no profile row once loaded) -> root routing. Waits for
  // auth and profile hydration so a deep link or in-flight fetch cannot bounce.
  useEffect(() => {
    if (isLoading) return;
    if (!session) {
      router.replace("/(auth)");
      return;
    }
    if (!profileLoaded) return;
    if (needsTermsAcceptance(profile)) return;
    router.replace("/");
  }, [isLoading, session, profileLoaded, profile]);

  const entryStyle = useAnimatedStyle(() => ({
    opacity: entry.value,
    transform: [{ translateY: (1 - entry.value) * 12 }],
  }));

  async function handleAgree() {
    if (!agreed) {
      agreementRef.current?.nudge();
      return;
    }
    if (saving || signingOut) return;
    setSaving(true);
    setError(null);
    const { error: saveError } = await acceptTerms();
    if (saveError) {
      setSaving(false);
      setError(SAVE_ERROR);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      Sentry.captureException(saveError, { tags: { area: "terms_acceptance" } });
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // saving stays true; the effect above routes away once the profile is current.
  }

  async function handleSignOut() {
    if (saving || signingOut) return;
    setSigningOut(true);
    setError(null);
    try {
      await signOut();
      // session is now null; the effect above routes to auth.
    } catch {
      setSigningOut(false);
      setError(SIGNOUT_ERROR);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
  }

  const busy = saving || signingOut;

  // A direct deep link can mount this route before auth/profile hydration resolves;
  // hold every control until the state the handlers depend on is known.
  const resolved = !isLoading && (!session || profileLoaded);
  if (!resolved) {
    return (
      <View style={[styles.container, styles.loading]}>
        <ActivityIndicator color={Colors.accent} size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 16 }]}>
      <Animated.View style={[styles.content, entryStyle]}>
        <View style={styles.header}>
          <Image source={require("@/assets/images/brand-logo.png")} style={styles.logo} resizeMode="contain" />
          <Text style={styles.title}>Please review our terms</Text>
          <Text style={styles.body}>
            To keep using LifeMaintained, please review and agree to our Terms of Service and Privacy Policy.
          </Text>
        </View>

        <View style={styles.footer}>
          {error && (
            <View style={styles.errorBox}>
              <Icon name="alert-circle" size={16} color={Colors.overdue} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <LegalAgreementRow ref={agreementRef} checked={agreed} onToggle={() => setAgreed((v) => !v)} />

          <Pressable
            style={({ pressed }) => [styles.primaryButton, { opacity: agreed ? (pressed ? 0.85 : 1) : 0.4 }]}
            onPress={handleAgree}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: !agreed || busy, busy: saving }}
          >
            {saving ? (
              <ActivityIndicator color={Colors.textInverse} />
            ) : (
              <Text style={styles.primaryButtonText}>Agree and continue</Text>
            )}
          </Pressable>

          <Pressable onPress={handleSignOut} disabled={busy} style={styles.signOut} hitSlop={8} accessibilityRole="button">
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: 24 },
  loading: { justifyContent: "center", alignItems: "center" },
  content: { flex: 1, justifyContent: "space-between" },
  header: { alignItems: "center", gap: 12, paddingTop: 24 },
  logo: { width: 64, height: 64 },
  title: { ...Typography.title2, color: Colors.text, textAlign: "center", marginTop: 8 },
  body: { ...Typography.subheadline, color: Colors.textSecondary, textAlign: "center", paddingHorizontal: 8 },
  footer: { gap: 12 },
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
  primaryButton: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.lg,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: { ...Typography.subheadline, fontWeight: "600", color: Colors.textInverse },
  signOut: { alignSelf: "center", paddingVertical: 10 },
  signOutText: { ...Typography.footnote, fontWeight: "500", color: Colors.textSecondary },
});
