import React, { useEffect, useRef } from "react";
import { Animated, Text, StyleSheet, Pressable, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { isInTrial, trialDaysRemaining } from "@/lib/subscription";
import * as Haptics from "expo-haptics";

export default function TrialBanner() {
  const { profile } = useAuth();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-12)).current;
  const prevVisible = useRef(false);

  const daysLeft = trialDaysRemaining(profile);
  const inTrial = isInTrial(profile);
  const shouldShow = inTrial && daysLeft <= 7;

  useEffect(() => {
    if (shouldShow && !prevVisible.current) {
      prevVisible.current = true;
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
    } else if (!shouldShow && prevVisible.current) {
      prevVisible.current = false;
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: -12, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [shouldShow]);

  if (!inTrial) return null;

  return (
    <Animated.View
      style={[styles.container, { opacity, transform: [{ translateY }] }]}
      pointerEvents={shouldShow ? "auto" : "none"}
    >
      <Pressable
        style={styles.inner}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push("/subscription");
        }}
      >
        <View style={styles.left}>
          <Ionicons name="time-outline" size={16} color={Colors.accent} />
          <Text style={styles.text}>
            <Text style={styles.bold}>{daysLeft} day{daysLeft !== 1 ? "s" : ""}</Text>
            {" left in your free trial"}
          </Text>
        </View>
        <View style={styles.cta}>
          <Text style={styles.ctaText}>Upgrade</Text>
          <Ionicons name="chevron-forward" size={12} color={Colors.accent} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    overflow: "hidden",
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.accentLight,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.accentMuted,
  },
  left: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  text: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  bold: { fontFamily: "Inter_600SemiBold", color: Colors.accent },
  cta: { flexDirection: "row", alignItems: "center", gap: 2 },
  ctaText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.accent },
});
