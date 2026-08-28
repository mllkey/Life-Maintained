import React from "react";
import { StyleSheet, View } from "react-native";
import { Colors } from "@/constants/colors";

export interface DividerProps {
  /** Left inset so the hairline starts at the row's text, not its edge. */
  inset?: number;
  color?: string;
}

export function Divider({ inset = 0, color = Colors.borderSubtle }: DividerProps) {
  return <View style={[styles.line, { marginLeft: inset, backgroundColor: color }]} />;
}

const styles = StyleSheet.create({
  line: { height: StyleSheet.hairlineWidth, alignSelf: "stretch" },
});
