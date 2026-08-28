import type { TextStyle } from "react-native";

/**
 * Apple text styles (size / line height / weight / tracking). System font only,
 * so Dynamic Type scales every variant correctly.
 */
export const Typography = {
  largeTitle:  { fontSize: 34, lineHeight: 41, fontWeight: "700", letterSpacing: 0.37 },
  title2:      { fontSize: 22, lineHeight: 28, fontWeight: "700", letterSpacing: 0.35 },
  title3:      { fontSize: 20, lineHeight: 25, fontWeight: "600", letterSpacing: 0.38 },
  headline:    { fontSize: 17, lineHeight: 22, fontWeight: "600", letterSpacing: -0.41 },
  body:        { fontSize: 17, lineHeight: 22, fontWeight: "400", letterSpacing: -0.41 },
  subheadline: { fontSize: 15, lineHeight: 20, fontWeight: "400", letterSpacing: -0.24 },
  footnote:    { fontSize: 13, lineHeight: 18, fontWeight: "400", letterSpacing: -0.08 },
  caption:     { fontSize: 12, lineHeight: 16, fontWeight: "400", letterSpacing: 0 },
} as const satisfies Record<string, TextStyle>;

export type TextVariant = keyof typeof Typography;

/** Dense list text (row title/subtitle/value) caps Dynamic Type growth so rows never break. */
export const DENSE_MAX_FONT_MULTIPLIER = 1.3;
