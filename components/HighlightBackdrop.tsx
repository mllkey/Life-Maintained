import React from "react";
import { View } from "react-native";

/**
 * Static, accessibility-friendly highlight backdrop.
 * Absolutely positioned; renders inside the row's relative-positioned wrapper.
 * No animation, no pulse — matches Apple Mail / iMessage / Reminders.
 *
 * `color` must be an rgba muted accent (e.g. Colors.vehicleMuted).
 */
export function HighlightBackdrop({ color, visible }: { color: string; visible: boolean }) {
  if (!visible) return null;
  return (
    <View
      pointerEvents="none"
      accessible={false}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderRadius: 14,
        backgroundColor: color,
        zIndex: 1,
      }}
    />
  );
}
