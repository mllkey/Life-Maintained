const ORANGE = "#FF9F0A";
const RED = "#FF453A";
const YELLOW = "#FFD60A";
const GREEN = "#30D158";
const BLUE = "#0A84FF";

export const Colors = {
  background: "#000000",
  surface: "#1C1C1E",
  card: "#2C2C2E",
  cardElevated: "#3A3A3C",
  skeleton: "#2C2C2E",
  border: "#48484A",
  borderSubtle: "#38383A",
  shadow: "rgba(0, 0, 0, 0.12)",

  text: "#FFFFFF",
  textPrimary: "#FFFFFF",
  textSecondary: "rgba(235, 235, 245, 0.60)",
  textTertiary: "rgba(235, 235, 245, 0.30)",
  textInverse: "#000000",

  accent: ORANGE,
  accentMuted: "rgba(255, 159, 10, 0.16)",
  accentLight: "rgba(255, 159, 10, 0.08)",

  overdue: RED,
  overdueMuted: "rgba(255, 69, 58, 0.16)",
  dueSoon: YELLOW,
  dueSoonMuted: "rgba(255, 214, 10, 0.16)",
  needsAttention: YELLOW,
  needsAttentionMuted: "rgba(255, 214, 10, 0.16)",
  good: GREEN,
  goodMuted: "rgba(48, 209, 88, 0.16)",

  blue: BLUE,
  blueMuted: "rgba(10, 132, 255, 0.16)",

  vehicle: ORANGE,
  vehicleMuted: "rgba(255, 159, 10, 0.16)",
  home: "#64D2FF",
  homeMuted: "rgba(100, 210, 255, 0.16)",
  health: "#FF375F",
  healthMuted: "rgba(255, 55, 95, 0.16)",

  tabBar: "rgba(0, 0, 0, 0.92)",

  white: "#FFFFFF",
  black: "#000000",
};

export default {
  light: {
    text: Colors.text,
    background: Colors.background,
    tint: Colors.accent,
    tabIconDefault: Colors.textTertiary,
    tabIconSelected: Colors.accent,
  },
};
