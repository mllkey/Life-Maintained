import { useCallback } from "react";
import {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

/** Press motion: 1 -> 0.97 over 120ms, spring back (damping 18, stiffness 260). */
export const PRESS_MOTION = { scale: 0.97, downMs: 120, damping: 18, stiffness: 260 } as const;

/** `dimmed` renders the disabled look (opacity 0.4) on the UI thread, where a static style would be overridden. */
export function usePressScale(disabled: boolean = false, dimmed: boolean = false) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const pressed = useSharedValue(0);

  const onPressIn = useCallback(() => {
    if (disabled) return;
    pressed.value = 1;
    if (!reduceMotion) {
      scale.value = withTiming(PRESS_MOTION.scale, { duration: PRESS_MOTION.downMs });
    }
  }, [disabled, reduceMotion, pressed, scale]);

  const onPressOut = useCallback(() => {
    pressed.value = 0;
    scale.value = withSpring(1, { damping: PRESS_MOTION.damping, stiffness: PRESS_MOTION.stiffness });
  }, [pressed, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: dimmed ? 0.4 : reduceMotion && pressed.value === 1 ? 0.85 : 1,
  }));

  return { animatedStyle, onPressIn, onPressOut };
}
