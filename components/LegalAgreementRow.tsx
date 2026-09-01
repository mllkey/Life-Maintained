import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import * as WebBrowser from "expo-web-browser";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { Typography } from "@/constants/typography";
import { Icon } from "@/components/ui/Icon";
import { PRIVACY_URL, TERMS_URL } from "@/lib/legalDates";

export type LegalAgreementRowHandle = { nudge: () => void };

interface Props {
  checked: boolean;
  onToggle: () => void;
}

const AGREEMENT_LABEL = "I agree to the Terms of Service and Privacy Policy";

/**
 * Shared opt-in row for signup and the review sheet.
 * Fill: 0 -> 1 spring (damping 14, stiffness 220). Ring border: border -> accent.
 * Nudge: translateX -6, 6, -4, 4, 0 at 50ms each + warning haptic. Reduced motion: no shake, 120ms fill.
 * Accessibility: the ring is the checkbox element; the two legal links are sibling link elements.
 */
export const LegalAgreementRow = forwardRef<LegalAgreementRowHandle, Props>(function LegalAgreementRow(
  { checked, onToggle },
  ref,
) {
  const reduceMotion = useReducedMotion();
  const fill = useSharedValue(checked ? 1 : 0);
  const shakeX = useSharedValue(0);
  const openingRef = useRef(false);

  useEffect(() => {
    fill.value = reduceMotion
      ? withTiming(checked ? 1 : 0, { duration: 120 })
      : withSpring(checked ? 1 : 0, { damping: 14, stiffness: 220 });
  }, [checked, fill, reduceMotion]);

  useImperativeHandle(
    ref,
    () => ({
      nudge: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        if (reduceMotion) return;
        shakeX.value = withSequence(
          withTiming(-6, { duration: 50 }),
          withTiming(6, { duration: 50 }),
          withTiming(-4, { duration: 50 }),
          withTiming(4, { duration: 50 }),
          withTiming(0, { duration: 50 }),
        );
      },
    }),
    [reduceMotion, shakeX],
  );

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }] }));
  const ringStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(fill.value, [0, 1], [Colors.border, Colors.accent]),
  }));
  const fillStyle = useAnimatedStyle(() => ({
    opacity: interpolate(fill.value, [0, 1], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(fill.value, [0, 1], [0.6, 1]) }],
  }));

  function handleToggle() {
    Haptics.selectionAsync().catch(() => {});
    onToggle();
  }

  // In-app Safari page sheet; falls back to external Safari if the sheet cannot present.
  // Re-entry guard so a second tap while presenting does not stack a second sheet.
  function openLegalPage(url: string) {
    if (openingRef.current) return;
    openingRef.current = true;
    WebBrowser.openBrowserAsync(url, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      dismissButtonStyle: "done",
    })
      .catch(() => Linking.openURL(url))
      .catch(() => {})
      .finally(() => {
        openingRef.current = false;
      });
  }

  return (
    <Animated.View style={[styles.row, rowStyle]}>
      <Pressable
        onPress={handleToggle}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={AGREEMENT_LABEL}
        hitSlop={10}
      >
        <Animated.View style={[styles.ring, ringStyle]}>
          <Animated.View style={[styles.fill, fillStyle]}>
            <Icon name="checkmark" size={14} color={Colors.textInverse} weight="semibold" />
          </Animated.View>
        </Animated.View>
      </Pressable>
      <View style={styles.sentence}>
        <Pressable onPress={handleToggle} accessible={false} hitSlop={4}>
          <Text style={styles.text}>I agree to the </Text>
        </Pressable>
        <Pressable onPress={() => openLegalPage(TERMS_URL)} accessibilityRole="link" hitSlop={4}>
          <Text style={styles.link}>Terms of Service</Text>
        </Pressable>
        <Pressable onPress={handleToggle} accessible={false} hitSlop={4}>
          <Text style={styles.text}> and </Text>
        </Pressable>
        <Pressable onPress={() => openLegalPage(PRIVACY_URL)} accessibilityRole="link" hitSlop={4}>
          <Text style={styles.link}>Privacy Policy</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  ring: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  fill: {
    position: "absolute",
    top: -1.5,
    left: -1.5,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sentence: { flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  text: { ...Typography.footnote, color: Colors.textSecondary },
  link: { ...Typography.footnote, fontWeight: "500", color: Colors.text, textDecorationLine: "underline" },
});
