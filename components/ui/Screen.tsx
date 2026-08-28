import React from "react";
import { Platform, ScrollView, StyleSheet, View, type ScrollViewProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "@/constants/colors";
import { Spacing } from "@/constants/spacing";
import { Text } from "./Text";

/** Existing tab screens pad the top by 67 on web; kept for parity. */
const WEB_TOP_PAD = 67;
/** Clears the tab bar and the voice FAB; matches existing tab screens. */
const TAB_BOTTOM_CLEARANCE = 100;
/** Pinned bar height below the safe area; the compact title lives here. */
const BAR_HEIGHT = 44;
/** The large title has scrolled far enough to hand off to the compact one. */
const FADE_START = 24;
const FADE_END = 44;

export interface ScreenProps {
  /** Large title. Omit for screens that draw their own header. */
  title?: string;
  /** Right-aligned header content (an add button, an import button). */
  trailing?: React.ReactNode;
  children: React.ReactNode;
  /** Wrap children in a ScrollView (default). Pass false for FlatList screens. */
  scroll?: boolean;
  refreshControl?: ScrollViewProps["refreshControl"];
  onScroll?: ScrollViewProps["onScroll"];
  keyboardShouldPersistTaps?: ScrollViewProps["keyboardShouldPersistTaps"];
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Safe areas, 20pt gutter, large title, 24pt section rhythm. Every tab and list screen starts here. */
export function Screen({
  title,
  trailing,
  children,
  scroll = true,
  refreshControl,
  onScroll,
  keyboardShouldPersistTaps,
  contentStyle,
  testID,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const topPad = insets.top + (Platform.OS === "web" ? WEB_TOP_PAD : 0) + Spacing.lg;
  const bottomPad = insets.bottom + TAB_BOTTOM_CLEARANCE;
  const barTop = insets.top + (Platform.OS === "web" ? WEB_TOP_PAD : 0);
  const scrollY = useSharedValue(0);

  /** Scroll-linked, so Reduce Motion needs no special case: no timing animation runs. */
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  const compactStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [FADE_START, FADE_END], [0, 1], Extrapolation.CLAMP),
  }));

  if (!scroll) {
    // Static screens keep the original header exactly as it was: no collapse.
    const header =
      title || trailing ? (
        <View style={[styles.header, { paddingTop: topPad }]}>
          {title ? (
            <Text variant="largeTitle" numberOfLines={1} style={styles.title} accessibilityRole="header">
              {title}
            </Text>
          ) : (
            <View />
          )}
          {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
        </View>
      ) : (
        <View style={{ paddingTop: topPad }} />
      );
    return (
      <View style={styles.root} testID={testID}>
        {header}
        <View style={[styles.content, { flex: 1, paddingBottom: bottomPad }, contentStyle]}>{children}</View>
      </View>
    );
  }

  return (
    <View style={styles.root} testID={testID}>
      <View style={[styles.bar, { paddingTop: barTop, height: barTop + BAR_HEIGHT }]} pointerEvents="box-none">
        <View style={styles.barRow}>
          {title ? (
            <Animated.View style={[styles.compactTitleWrap, compactStyle]} pointerEvents="none">
              <Text variant="headline" numberOfLines={1}>
                {title}
              </Text>
            </Animated.View>
          ) : null}
          {trailing ? <View style={styles.barTrailing}>{trailing}</View> : null}
        </View>
        <Animated.View style={[styles.barDivider, compactStyle]} pointerEvents="none" />
      </View>

      <Animated.ScrollView
        style={{ paddingTop: barTop + BAR_HEIGHT }}
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
        onScroll={scrollHandler}
        // Composed, not dropped: the animated handler drives the fade and any
        // caller-supplied handler still fires.
        onScrollBeginDrag={onScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        contentContainerStyle={[styles.content, { paddingTop: 0, paddingBottom: bottomPad, flexGrow: 1 }, contentStyle]}
      >
        {title ? (
          <Text variant="largeTitle" numberOfLines={1} style={styles.largeTitle} accessibilityRole="header">
            {title}
          </Text>
        ) : null}
        {children}
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  bar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.gutter,
  },
  barRow: { height: BAR_HEIGHT, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: Spacing.md },
  compactTitleWrap: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  barTrailing: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, flexShrink: 0 },
  barDivider: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.borderSubtle,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.gutter,
    paddingBottom: Spacing.md,
    gap: Spacing.md,
  },
  title: { flex: 1, minWidth: 0 },
  trailing: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, flexShrink: 0 },
  largeTitle: { paddingBottom: Spacing.md },
  content: { paddingHorizontal: Spacing.gutter, paddingTop: Spacing.sm, gap: Spacing.section },
});
