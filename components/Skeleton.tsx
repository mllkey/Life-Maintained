import React, { useEffect, useRef } from "react";
import { Animated, View } from "react-native";

const SHAPE = "#2C2E42";

export function usePulse() {
  const anim = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.45, duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);
  return anim;
}

interface BoxProps {
  anim: Animated.Value;
  w?: number | `${number}%`;
  h: number;
  r?: number;
  mt?: number;
  mb?: number;
  ml?: number;
  flex?: number;
}

export function S({ anim, w = "100%", h, r = 8, mt = 0, mb = 0, ml = 0, flex }: BoxProps) {
  return (
    <Animated.View
      style={{
        width: flex !== undefined ? undefined : (w as any),
        height: h,
        borderRadius: r,
        backgroundColor: SHAPE,
        opacity: anim,
        marginTop: mt,
        marginBottom: mb,
        marginLeft: ml,
        flex,
      }}
    />
  );
}

export function Row({ children, gap = 8, mt = 0, mb = 0, align = "center" }: {
  children: React.ReactNode;
  gap?: number;
  mt?: number;
  mb?: number;
  align?: "center" | "flex-start" | "flex-end";
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: align, gap, marginTop: mt, marginBottom: mb }}>
      {children}
    </View>
  );
}

export function Col({ children, flex, gap = 6 }: { children: React.ReactNode; flex?: number; gap?: number }) {
  return (
    <View style={{ flex, gap }}>
      {children}
    </View>
  );
}
