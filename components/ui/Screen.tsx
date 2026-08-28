import React from "react";
import { Platform, ScrollView, StyleSheet, View, type ScrollViewProps, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "@/constants/colors";
import { Spacing } from "@/constants/spacing";
import { Text } from "./Text";

/** Existing tab screens pad the top by 67 on web; kept for parity. */
const WEB_TOP_PAD = 67;
/** Clears the tab bar and the voice FAB; matches existing tab screens. */
const TAB_BOTTOM_CLEARANCE = 100;

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

  if (!scroll) {
    return (
      <View style={styles.root} testID={testID}>
        {header}
        <View style={[styles.content, { flex: 1, paddingBottom: bottomPad }, contentStyle]}>{children}</View>
      </View>
    );
  }

  return (
    <View style={styles.root} testID={testID}>
      {header}
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad, flexGrow: 1 }, contentStyle]}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
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
  content: { paddingHorizontal: Spacing.gutter, paddingTop: Spacing.sm, gap: Spacing.section },
});
