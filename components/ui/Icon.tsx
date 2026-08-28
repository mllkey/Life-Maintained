import React from "react";
import { Platform, View, type StyleProp, type ViewStyle } from "react-native";
import { SymbolView } from "expo-symbols";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { IONICON_TO_SF, type IconName } from "./iconMap";

export type { IconName } from "./iconMap";

export type IconWeight = "regular" | "medium" | "semibold" | "bold";

export interface IconProps {
  name: IconName;
  /** 17 in rows, 22 in nav and tabs, 28 in empty states. */
  size?: number;
  color: string;
  /** Match the adjacent text weight. */
  weight?: IconWeight;
  style?: StyleProp<ViewStyle>;
}

/** SF Symbol on iOS, Ionicons elsewhere. Name is the Ionicons name; the map picks the symbol. */
export function Icon({ name, size = 17, color, weight = "regular", style }: IconProps) {
  if (Platform.OS === "ios") {
    return (
      <SymbolView
        name={IONICON_TO_SF[name]}
        size={size}
        tintColor={color}
        weight={weight}
        resizeMode="scaleAspectFit"
        style={[{ width: size, height: size }, style]}
        fallback={<Ionicons name={name} size={size} color={color} />}
      />
    );
  }
  return (
    <View style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, style]}>
      <Ionicons name={name} size={size} color={color} />
    </View>
  );
}

export type MciName = keyof typeof MaterialCommunityIcons.glyphMap;

/** Vehicle-type and property-type glyphs have no SF Symbol; they stay MaterialCommunityIcons on every platform. */
export function MciIcon({ name, size = 17, color }: { name: MciName; size?: number; color: string }) {
  return <MaterialCommunityIcons name={name} size={size} color={color} />;
}
