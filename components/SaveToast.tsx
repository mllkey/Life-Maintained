import React, { useEffect, useRef } from "react";
import { Animated, Pressable, Text, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";

interface SaveToastProps {
  visible: boolean;
  message?: string;
  subtitle?: string;
  isError?: boolean;
  /** Renders an accent action (mirrors UndoToast). Both must be provided. */
  actionLabel?: string;
  onAction?: () => void;
}

export function SaveToast({ visible, message = "Saved!", subtitle, isError = false, actionLabel, onAction }: SaveToastProps) {
  const hasAction = !!actionLabel && !!onAction;
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 20, duration: 150, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, opacity, translateY]);

  return (
    <Animated.View
      style={[styles.toast, { opacity, transform: [{ translateY }] }]}
      pointerEvents={hasAction && visible ? "box-none" : "none"}
    >
      {/* Card and body opt out of hit testing when an action is present, so
          only the Pressable can claim a touch; everything else passes through. */}
      <View style={styles.inner} pointerEvents={hasAction ? "box-none" : "auto"}>
        <View style={styles.body} pointerEvents={hasAction ? "none" : "auto"}>
          <Ionicons
            name={isError ? "alert-circle" : "checkmark-circle"}
            size={18}
            color={isError ? Colors.overdue : "#34C759"}
          />
          <View style={styles.textBlock}>
            <Text style={[styles.text, isError && { color: Colors.overdue }]}>{message}</Text>
            {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
          </View>
        </View>
        {hasAction && (
          <Pressable
            onPress={onAction}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
            style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
          >
            <Text style={styles.actionText}>{actionLabel}</Text>
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    bottom: 48,
    alignSelf: "center",
    zIndex: 999,
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.card,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  body: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },
  textBlock: {
    flexShrink: 1,
  },
  text: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    marginTop: 1,
  },
  actionBtn: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    marginRight: -8,
    borderRadius: 10,
  },
  actionBtnPressed: { opacity: 0.6 },
  actionText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: Colors.accent,
  },
});
