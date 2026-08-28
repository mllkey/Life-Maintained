import React from "react";
import { Text as RNText, StyleSheet, type TextProps as RNTextProps, type TextStyle } from "react-native";
import { Colors } from "@/constants/colors";
import { Typography, type TextVariant } from "@/constants/typography";

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: keyof typeof Colors;
  align?: TextStyle["textAlign"];
  uppercase?: boolean;
}

/** The only Text the app renders. Variant picks size/weight/tracking; color is a token key. */
export function Text({ variant = "body", color = "text", align, uppercase = false, style, children, ...rest }: TextProps) {
  return (
    <RNText
      {...rest}
      style={[
        Typography[variant],
        { color: Colors[color] },
        align ? { textAlign: align } : null,
        uppercase ? styles.uppercase : null,
        style,
      ]}
    >
      {children}
    </RNText>
  );
}

const styles = StyleSheet.create({
  uppercase: { textTransform: "uppercase" },
});
