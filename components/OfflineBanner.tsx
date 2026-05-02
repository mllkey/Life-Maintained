import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { Colors } from "@/constants/colors";
import { useNetworkStatus } from "@/lib/useNetworkStatus";

/**
 * App-shell offline indicator.
 *
 * Pattern: absolute-positioned full-width strip overlaying the status bar.
 * Matches Robinhood, Calm, and Apple Wallet's persistent-state strip pattern.
 * The strip does not reflow screen content when toggled — overlay-only — so
 * the rest of the app stays visually stable as the network state changes.
 *
 * Selection haptic fires on actual state transitions only (skip-mount via
 * lastOfflineRef sentinel).
 */
const STRIP_HEIGHT = 28;

export function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const { isOffline } = useNetworkStatus();

  const progress = useRef(new Animated.Value(0)).current;
  const lastOfflineRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (lastOfflineRef.current !== null && lastOfflineRef.current !== isOffline) {
      Haptics.selectionAsync().catch(() => {});
    }

    lastOfflineRef.current = isOffline;

    Animated.timing(progress, {
      toValue: isOffline ? 1 : 0,
      duration: isOffline ? 220 : 180,
      useNativeDriver: false,
    }).start();
  }, [isOffline, progress]);

  const containerHeight = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, insets.top + STRIP_HEIGHT],
  });

  const opacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.container, { height: containerHeight, opacity }]}
    >
      <View style={[styles.strip, { marginTop: insets.top }]}>
        <Ionicons name="cloud-offline-outline" size={14} color={Colors.text} />
        <Text style={styles.text}>You{"'"}re offline</Text>
      </View>
    </Animated.View>
  );
}

export default OfflineBanner;

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    overflow: "hidden",
    backgroundColor: Colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    zIndex: 9999,
    elevation: 9999,
  },
  strip: {
    height: STRIP_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  text: {
    color: Colors.text,
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    letterSpacing: 0.2,
  },
});
