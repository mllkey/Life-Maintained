import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import * as Haptics from "expo-haptics";

const VERSION_KEY = "@last_seen_app_version";

interface UpdateBannerProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
}

export default function UpdateBanner({ message, actionLabel, onAction, onDismiss }: UpdateBannerProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    checkVersion();
  }, []);

  async function checkVersion() {
    try {
      const currentVersion = Constants.expoConfig?.version ?? null;
      if (!currentVersion) return;
      const lastSeen = await AsyncStorage.getItem(VERSION_KEY);
      if (lastSeen !== currentVersion) {
        setVisible(true);
      }
    } catch {}
  }

  async function handleDismiss() {
    try {
      const currentVersion = Constants.expoConfig?.version ?? null;
      if (currentVersion) {
        await AsyncStorage.setItem(VERSION_KEY, currentVersion);
      }
    } catch {}
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setVisible(false);
    onDismiss();
  }

  function handleAction() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onAction?.();
  }

  if (!visible) return null;

  return (
    <View style={styles.banner}>
      <View style={styles.iconWrap}>
        <Ionicons name="sparkles-outline" size={18} color={Colors.good} />
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.message}>{message}</Text>
        {actionLabel && onAction && (
          <Pressable
            onPress={handleAction}
            style={({ pressed }) => [styles.actionBtn, { opacity: pressed ? 0.75 : 1 }]}
            accessibilityRole="button"
          >
            <Text style={styles.actionBtnText}>{actionLabel}</Text>
          </Pressable>
        )}
      </View>
      <Pressable onPress={handleDismiss} hitSlop={12} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Dismiss">
        <Ionicons name="close" size={18} color={Colors.textTertiary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.good + "44",
    padding: 14,
    gap: 12,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: Colors.goodMuted,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 1,
  },
  textWrap: {
    flex: 1,
    gap: 6,
  },
  message: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  actionBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: Colors.good,
    minHeight: 30,
    justifyContent: "center",
  },
  actionBtnText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  closeBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
});
