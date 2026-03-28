import React, { useEffect, useState, useRef } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

const SEEN_PREFIX = "@tooltip_seen_";

// All tooltip IDs in one place to prevent duplicates
export const TOOLTIP_IDS = {
  DASHBOARD_WELCOME: "dashboard_welcome",
  VEHICLES_FIRST_VISIT: "vehicles_first_visit",
  VEHICLE_DETAIL_SCHEDULE: "vehicle_detail_schedule",
  VEHICLE_GLOVEBOX: "vehicle_glovebox",
  LOG_SERVICE_INTRO: "log_service_intro",
  PROPERTY_DETAIL_SCHEDULE: "property_detail_schedule",
  HEALTH_FIRST_VISIT: "health_first_visit",
  ADD_VEHICLE_TIP: "add_vehicle_tip",
  UPDATE_MILEAGE_TIP: "update_mileage_tip",
  NOTIF_SETTINGS_TIP: "notif_settings_tip",
  VOICE_LOG_TIP: "voice_log_tip",
  FAMILY_MEMBER_DETAIL: "family_member_detail",
  VEHICLE_HISTORY: "vehicle_history",
  PROPERTY_HISTORY: "property_history",
} as const;

interface TooltipProps {
  id: string;
  message: string;
  icon?: keyof typeof Ionicons.glyphMap;
  delay?: number; // ms before showing (default 800)
}

export default function Tooltip({ id, message, icon, delay = 800 }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;

    (async () => {
      try {
        const seen = await AsyncStorage.getItem(`${SEEN_PREFIX}${id}`);
        if (seen || !mountedRef.current) return;
        timerRef.current = setTimeout(() => {
          if (mountedRef.current) setVisible(true);
        }, delay);
      } catch {}
    })();

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [id, delay]);

  async function dismiss() {
    Haptics.selectionAsync();
    // Write first, then hide — prevents re-showing on flaky devices
    try {
      await AsyncStorage.setItem(`${SEEN_PREFIX}${id}`, "true");
    } catch {}
    if (mountedRef.current) setVisible(false);
  }

  if (!visible) return null;

  return (
    <Animated.View entering={FadeIn.duration(300)} exiting={FadeOut.duration(200)}>
      <Pressable onPress={dismiss} style={styles.container}>
        <View style={styles.iconWrap}>
          <Ionicons name={icon ?? "bulb-outline"} size={18} color={Colors.accent} />
        </View>
        <Text style={styles.message}>{message}</Text>
        <Ionicons name="close" size={16} color={Colors.textTertiary} />
      </Pressable>
    </Animated.View>
  );
}

// Reset all tooltips (dev testing only)
export async function resetAllTooltips() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const tooltipKeys = keys.filter(k => k.startsWith(SEEN_PREFIX));
    if (tooltipKeys.length > 0) await AsyncStorage.multiRemove(tooltipKeys);
  } catch {}
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(232, 147, 58, 0.12)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "rgba(232, 147, 58, 0.25)",
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(232, 147, 58, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  message: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.text,
    lineHeight: 19,
  },
});
