import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { NativeTabs, Icon, Label } from "expo-router/unstable-native-tabs";
import { BlurView } from "expo-blur";
import { SymbolView } from "expo-symbols";
import { Platform, Pressable, StyleSheet, useColorScheme, View } from "react-native";
import React, { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/context/AuthContext";
import { LogSheet } from "@/components/LogSheet";

function NativeTabLayout() {
  return (
    <NativeTabs>
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
        <Icon sf={{ default: "gear", selected: "gear.fill" }} />
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
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="square.grid.2x2.fill" tintColor={color} size={22} />
            ) : (
              <Ionicons name="grid" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="vehicles"
        options={{
          title: "Vehicles",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="car.fill" tintColor={color} size={22} />
            ) : (
              <Ionicons name="car" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="home-tab"
        options={{
          title: "Properties",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="house.fill" tintColor={color} size={22} />
            ) : (
              <Ionicons name="home" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="health"
        options={{
          title: "Health",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="heart.fill" tintColor={color} size={22} />
            ) : (
              <Ionicons name="heart" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="gear" tintColor={color} size={22} />
            ) : (
              <Ionicons name="settings" size={22} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  const [logSheetVisible, setLogSheetVisible] = useState(false);
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const isNative = isLiquidGlassAvailable();

  return (
    <View style={{ flex: 1 }}>
      {isNative ? <NativeTabLayout /> : <ClassicTabLayout />}

      <Pressable
        style={[
          styles.fab,
          {
            bottom: insets.bottom + (Platform.OS === "web" ? 84 : 49) + 16,
            right: 20,
          },
        ]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          setLogSheetVisible(true);
        }}
        accessibilityLabel="Record voice maintenance log"
        accessibilityRole="button"
      >
        <Ionicons name="mic-outline" size={26} color="#fff" />
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
  fab: {
    position: "absolute",
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.30,
    shadowRadius: 8,
    elevation: 8,
  },
});
