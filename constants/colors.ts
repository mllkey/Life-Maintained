const NAVY = "#2B4C8C";
const ORANGE = "#E8943A";
const RED = "#FF453A";
const YELLOW = "#FFD60A";
const GREEN = "#32D74B";
const BLUE = "#4A90D9";

export const Colors = {
  background: "#0C111B",
  surface: "#131A2B",
  card: "#1A2236",
  cardElevated: "#212B42",
  border: "#2A3550",
  borderSubtle: "#1A2236",

  text: "#F0F2F8",
  textSecondary: "#8B93A8",
  textTertiary: "#5A6480",
  textInverse: "#0C111B",

  accent: ORANGE,
  accentMuted: "rgba(232, 147, 58, 0.15)",
  accentLight: "rgba(232, 147, 58, 0.08)",

  overdue: RED,
  overdueMuted: "rgba(255, 69, 58, 0.15)",
  dueSoon: YELLOW,
  dueSoonMuted: "rgba(255, 214, 10, 0.15)",
  good: GREEN,
  goodMuted: "rgba(50, 215, 75, 0.15)",

  blue: BLUE,
  blueMuted: "rgba(74, 144, 217, 0.15)",

  vehicle: ORANGE,
  vehicleMuted: "rgba(232, 147, 58, 0.15)",
  home: "#64D2FF",
  homeMuted: "rgba(100, 210, 255, 0.15)",
  health: "#FF6B9D",
  healthMuted: "rgba(255, 107, 157, 0.15)",

  tabBar: "rgba(12, 17, 27, 0.92)",

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
