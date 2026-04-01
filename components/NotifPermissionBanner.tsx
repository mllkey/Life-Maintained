import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";

const DISMISSED_KEY = "notif_banner_dismissed";

interface Props {
  onDismiss?: () => void;
}

export default function NotifPermissionBanner({ onDismiss }: Props) {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(-200)).current;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (Platform.OS === "web") return;
    checkAndShow();
  }, []);

  const [permStatus, setPermStatus] = useState<string | null>(null);

  async function checkAndShow() {
    try {
      const dismissed = await AsyncStorage.getItem(DISMISSED_KEY);
      if (dismissed === "true") return;

      const { status } = await Notifications.getPermissionsAsync();
      if (status !== "denied" && status !== "undetermined") return;

      setPermStatus(status);
      await new Promise(resolve => setTimeout(resolve, 800));
      setVisible(true);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        damping: 18,
        stiffness: 180,
      }).start();
    } catch {
    }
  }

  async function dismiss() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.timing(slideAnim, {
      toValue: -200,
      duration: 240,
      useNativeDriver: true,
    }).start(() => setVisible(false));
    await AsyncStorage.setItem(DISMISSED_KEY, "true");
    onDismiss?.();
  }

  async function handleTurnOn() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (permStatus === "undetermined") {
      const result = await Notifications.requestPermissionsAsync();
      if (result.status !== "denied") {
        dismiss();
        return;
      }
      setPermStatus("denied");
    } else {
      await Linking.openSettings();
      dismiss();
    }
  }

  async function openSettings() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Linking.openSettings();
    dismiss();
  }

  if (!visible) return null;

  const topOffset = insets.top + (Platform.OS === "web" ? 67 : 0);

  return (
    <Animated.View
      style={[
        styles.banner,
        { top: topOffset + 8, transform: [{ translateY: slideAnim }] },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.inner}>
        <View style={styles.iconWrap}>
          <Ionicons name="notifications-outline" size={20} color={Colors.accent} />
        </View>

        <View style={styles.textWrap}>
          <Text style={styles.title}>Enable notifications</Text>
          <Text style={styles.body}>
            Get reminders for overdue maintenance, upcoming appointments, and medication schedules.
          </Text>
          <Pressable
            onPress={permStatus === "undetermined" ? handleTurnOn : openSettings}
            style={({ pressed }) => [styles.settingsBtn, { opacity: pressed ? 0.75 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel={permStatus === "undetermined" ? "Turn on notifications" : "Open notification settings"}
          >
            <Text style={styles.settingsBtnText}>{permStatus === "undetermined" ? "Turn On" : "Open Settings"}</Text>
          </Pressable>
        </View>

        <Pressable
          onPress={dismiss}
          hitSlop={12}
          style={styles.closeBtn}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        >
          <Ionicons name="close" size={18} color={Colors.textTertiary} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 9999,
  },
  inner: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.accent + "44",
    padding: 14,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.accentMuted,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 1,
  },
  textWrap: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  body: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  settingsBtn: {
    alignSelf: "flex-start",
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: Colors.accent,
    minHeight: 34,
    justifyContent: "center",
  },
  settingsBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textInverse,
  },
  closeBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
});
