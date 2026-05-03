import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { useNetworkStatus } from "@/lib/useNetworkStatus";

/**
 * App-shell offline indicator.
 *
 * Full-width status strip with brand-orange treatment, dark high-contrast text,
 * and warning notification haptic on real offline/online state transitions.
 */
const STRIP_HEIGHT = 32;
const ORANGE = "#E8943A";
const ORANGE_TEXT = "#0C111B";

export function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const { isOffline } = useNetworkStatus();

  const progress = useRef(new Animated.Value(0)).current;
  const lastOfflineRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (lastOfflineRef.current !== null && lastOfflineRef.current !== isOffline) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
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
        <Ionicons
          name="cloud-offline"
          size={16}
          color={ORANGE_TEXT}
          style={styles.icon}
        />
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
    backgroundColor: ORANGE,
    zIndex: 9999,
    elevation: 9999,
  },
  strip: {
    height: STRIP_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    marginRight: 8,
  },
  text: {
    color: ORANGE_TEXT,
    fontFamily: "Inter_700Bold",
    fontSize: 13,
    letterSpacing: 0.3,
  },
});
