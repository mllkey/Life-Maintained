import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs, router } from "expo-router";
import { NativeTabs, Icon, Label } from "expo-router/unstable-native-tabs";
import { BlurView } from "expo-blur";
import { Platform, Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";
import React, { useState, useEffect } from "react";
import { Colors } from "@/constants/colors";
import { Radius } from "@/constants/radius";
import { Icon as UiIcon } from "@/components/ui/Icon";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/context/AuthContext";
import { LogSheet } from "@/components/LogSheet";
import { takePendingIntent } from "@/lib/onboardingIntent";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Typography } from "@/constants/typography";
import { FAB_LEFT, FAB_SIZE, fabBottomOffset } from "@/constants/layout";
import { TOOLTIP_IDS } from "@/components/Tooltip";

// Same key the Tooltip component uses, so the mic tip shows exactly once overall:
// here on the first dashboard view, or inside the LogSheet if the user opens it first.
const VOICE_TIP_SEEN_KEY = `@tooltip_seen_${TOOLTIP_IDS.VOICE_LOG_TIP}`;
export const VOICE_TIP_COPY = "Say what you did. We log it.";

function NativeTabLayout() {
  return (
    <NativeTabs tintColor={Colors.accent}>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "square.grid.2x2", selected: "square.grid.2x2.fill" }} />
        <Label>Dashboard</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="vehicles">
        <Icon sf={{ default: "car", selected: "car.fill" }} />
        <Label>Vehicles</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="home-tab">
        <Icon sf={{ default: "house", selected: "house.fill" }} />
        <Label>Properties</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="health">
        <Icon sf={{ default: "heart", selected: "heart.fill" }} />
        <Label>Health</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <Icon sf={{ default: "gearshape", selected: "gearshape.fill" }} />
        <Label>Settings</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme !== "light";
  const isWeb = Platform.OS === "web";
  const isIOS = Platform.OS === "ios";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.textTertiary,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : Colors.background,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: Colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={80}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: Colors.background }]} />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ color }) => <UiIcon name="grid" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="vehicles"
        options={{
          title: "Vehicles",
          tabBarIcon: ({ color }) => <UiIcon name="car" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="home-tab"
        options={{
          title: "Properties",
          tabBarIcon: ({ color }) => <UiIcon name="home" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="health"
        options={{
          title: "Health",
          tabBarIcon: ({ color }) => <UiIcon name="heart" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => <UiIcon name="settings" size={22} color={color} />,
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  const [logSheetVisible, setLogSheetVisible] = useState(false);
  const [voiceTipVisible, setVoiceTipVisible] = useState(false);
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const isNative = isLiquidGlassAvailable();

  // One-time mic tip on the first dashboard view. Only a bubble that actually
  // showed writes the seen flag; if the user taps the mic before it appears,
  // the LogSheet's own Tooltip (same key) still gets to show the tip once.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      AsyncStorage.getItem(VOICE_TIP_SEEN_KEY)
        .then((seen) => { if (!cancelled && !seen) setVoiceTipVisible(true); })
        .catch(() => {});
    }, 900);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  function dismissVoiceTip() {
    if (!voiceTipVisible) return;
    setVoiceTipVisible(false);
    AsyncStorage.setItem(VOICE_TIP_SEEN_KEY, "true").catch(() => {});
  }

  // One-shot navigation intent from onboarding completion. The tabs layout
  // mounts once on group entry (independent of the active tab), so draining
  // here guarantees the push originates from a mounted navigator — replacing
  // the old setTimeout-after-replace race. Read-once.
  useEffect(() => {
    const intent = takePendingIntent();
    if (!intent) return;
    if (intent.kind === "add-vehicle") router.push("/add-vehicle");
    else if (intent.kind === "add-property") router.push("/add-property");
    else if (intent.kind === "open-vehicle") router.push({ pathname: "/vehicle/[id]", params: { id: intent.id } });
    else if (intent.kind === "open-property") router.push({ pathname: "/property/[id]", params: { id: intent.id } });
    else if (intent.kind === "open-member") router.push({ pathname: "/family-member/[id]", params: { id: intent.id } });
  }, []);

  return (
    <View style={{ flex: 1 }}>
      {isNative ? <NativeTabLayout /> : <ClassicTabLayout />}

      {voiceTipVisible && (
        <View
          // Anchored directly above the FAB: bubble bottom sits 8pt over the FAB's top edge,
          // caret points down at the FAB's centre. Opaque, elevated, so it reads as a floating
          // callout rather than part of whatever card scrolls beneath it.
          style={[styles.voiceTipWrap, { bottom: fabBottomOffset(insets.bottom) + FAB_SIZE + 8, left: FAB_LEFT }]}
          pointerEvents="box-none"
        >
          <Pressable onPress={dismissVoiceTip} style={styles.voiceTip} accessibilityRole="button" accessibilityLabel="Dismiss voice tip">
            <UiIcon name="mic" size={14} color={Colors.accent} />
            <Text style={styles.voiceTipText}>{VOICE_TIP_COPY}</Text>
            <UiIcon name="close" size={14} color={Colors.textTertiary} />
          </Pressable>
          <View style={styles.voiceTipCaret} />
        </View>
      )}

      <Pressable
        style={[
          styles.fab,
          {
            bottom: fabBottomOffset(insets.bottom),
            left: FAB_LEFT,
          },
        ]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          dismissVoiceTip();
          setLogSheetVisible(true);
        }}
        accessibilityLabel="Record voice maintenance log"
        accessibilityRole="button"
      >
        <UiIcon name="mic" size={22} color={Colors.white} />
      </Pressable>

      <LogSheet
        visible={logSheetVisible}
        onClose={() => setLogSheetVisible(false)}
        userId={user?.id ?? ""}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  voiceTipWrap: { position: "absolute", maxWidth: 320, zIndex: 20 },
  voiceTip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.accent,
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  voiceTipText: { ...Typography.footnote, fontWeight: "600", color: Colors.text },
  voiceTipCaret: {
    width: 12,
    height: 12,
    marginLeft: FAB_SIZE / 2 - 6,
    marginTop: -7,
    backgroundColor: Colors.surface,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: Colors.accent,
    transform: [{ rotate: "45deg" }],
  },
  fab: {
    position: "absolute",
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
});
