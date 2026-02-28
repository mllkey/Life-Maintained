const TEAL = "#00C9A7";
const RED = "#FF453A";
const YELLOW = "#FFD60A";
const GREEN = "#32D74B";
const BLUE = "#0A84FF";

export const Colors = {
  background: "#0B0C10",
  surface: "#16171D",
  card: "#1E1F27",
  cardElevated: "#252631",
  border: "#2C2D38",
  borderSubtle: "#1E1F27",

  text: "#F0F0F5",
  textSecondary: "#8F90A6",
  textTertiary: "#5C5D72",
  textInverse: "#0B0C10",

  accent: TEAL,
  accentMuted: "rgba(0, 201, 167, 0.15)",
  accentLight: "rgba(0, 201, 167, 0.08)",

  overdue: RED,
  overdueMuted: "rgba(255, 69, 58, 0.15)",
  dueSoon: YELLOW,
  dueSoonMuted: "rgba(255, 214, 10, 0.15)",
  good: GREEN,
  goodMuted: "rgba(50, 215, 75, 0.15)",

  blue: BLUE,
  blueMuted: "rgba(10, 132, 255, 0.15)",

  vehicle: "#FF9F0A",
  vehicleMuted: "rgba(255, 159, 10, 0.15)",
  home: "#64D2FF",
  homeMuted: "rgba(100, 210, 255, 0.15)",
  health: "#FF6B9D",
  healthMuted: "rgba(255, 107, 157, 0.15)",

  tabBar: "rgba(11, 12, 16, 0.85)",

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
