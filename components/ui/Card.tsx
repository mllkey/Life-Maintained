import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import * as Haptics from "@/lib/haptics";
import { Colors } from "@/constants/colors";
import { Radius } from "@/constants/radius";
import { Spacing } from "@/constants/spacing";
import { usePressScale } from "./usePressScale";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface CardProps {
  children: React.ReactNode;
  /** A card wraps ONE thing the user can tap into. Pass onPress only in that case. */
  onPress?: () => void;
  padding?: number;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** `card` surface, radius 16, hairline. No shadow: dark surfaces separate by tone. */
export function Card({ children, onPress, padding = Spacing.lg, accessibilityLabel, testID, style }: CardProps) {
  const { animatedStyle, onPressIn, onPressOut } = usePressScale(!onPress);

  if (!onPress) {
    return (
      <View style={[styles.card, { padding }, style]} testID={testID}>
        {children}
      </View>
    );
  }

  return (
    <AnimatedPressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress();
      }}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={[styles.card, { padding }, animatedStyle, style]}
    >
      {children}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.borderSubtle,
  },
});
