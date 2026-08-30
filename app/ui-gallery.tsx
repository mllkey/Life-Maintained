import React, { useEffect, useState } from "react";
import { StyleSheet, Switch, View } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { Colors } from "@/constants/colors";
import { Radius } from "@/constants/radius";
import { Spacing } from "@/constants/spacing";
import { Typography, type TextVariant } from "@/constants/typography";
import { Text } from "@/components/ui/Text";
import { Icon } from "@/components/ui/Icon";
import { ICON_NAMES } from "@/components/ui/iconMap";
import { Screen } from "@/components/ui/Screen";
import { Section } from "@/components/ui/Section";
import { Row } from "@/components/ui/Row";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";

/**
 * Dev-only gallery. Every primitive in every state, one page per primitive so a
 * simulator screenshot of each page proves the system before any screen uses it.
 * Open: lifemaintained://ui-gallery?page=<page>
 */
const PAGES = ["index", "text", "buttons", "rows", "cards", "chips", "empty", "icons"] as const;
type Page = (typeof PAGES)[number];

function toPage(raw: string | string[] | undefined): Page {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (PAGES as readonly string[]).includes(v ?? "") ? (v as Page) : "index";
}

const NOOP = () => {};

export default function UiGallery() {
  const params = useLocalSearchParams<{ page?: string }>();
  const [page, setPage] = useState<Page>(() => toPage(params.page));

  useEffect(() => {
    setPage(toPage(params.page));
  }, [params.page]);

  if (!__DEV__) return <Redirect href="/" />;

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const trailing = <Button label="Close" onPress={close} variant="tertiary" fullWidth={false} />;

  if (page === "index") {
    return (
      <Screen title="UI Gallery" trailing={trailing} testID="gallery-index">
        <Section title="Primitives" dividerInset={56}>
          <Row title="Text" subtitle="8 variants" icon="document-text-outline" onPress={() => setPage("text")} appearIndex={0} />
          <Row title="Buttons" subtitle="4 variants, loading, disabled" icon="checkmark-circle" onPress={() => setPage("buttons")} appearIndex={1} />
          <Row title="Rows + Sections" subtitle="icon, value, chevron, switch, destructive" icon="grid" onPress={() => setPage("rows")} appearIndex={2} />
          <Row title="Cards" subtitle="static and tappable" icon="car-outline" onPress={() => setPage("cards")} appearIndex={3} />
          <Row title="Chips" subtitle="four tones, selected, disabled" icon="sparkles-outline" onPress={() => setPage("chips")} appearIndex={4} />
          <Row title="Empty state" subtitle="symbol, headline, line, button" icon="cloud-offline-outline" onPress={() => setPage("empty")} appearIndex={5} />
          <Row title="Icons" subtitle={`${ICON_NAMES.length} SF Symbols`} icon="heart-outline" onPress={() => setPage("icons")} appearIndex={6} />
        </Section>
      </Screen>
    );
  }

  const back = <Button label="Back" onPress={() => setPage("index")} variant="tertiary" fullWidth={false} />;

  if (page === "text") {
    const variants = Object.keys(Typography) as TextVariant[];
    return (
      <Screen title="Text" trailing={back} testID="gallery-text">
        <Card>
          <View style={{ gap: Spacing.md }}>
            {variants.map((v) => (
              <Text key={v} variant={v}>
                {v} · Oil change in 847 mi
              </Text>
            ))}
          </View>
        </Card>
        <Section title="Colors">
          <Row title="text" value="Primary" />
          <Row title="textSecondary" subtitle="Secondary on subheadline" value="Secondary" />
          <Row title="destructive" destructive value="Delete" />
        </Section>
      </Screen>
    );
  }

  if (page === "buttons") {
    const variants = ["primary", "secondary", "tertiary", "destructive"] as const;
    return (
      <Screen title="Buttons" trailing={back} testID="gallery-buttons">
        {variants.map((v) => (
          <View key={v} style={{ gap: Spacing.sm }}>
            <Text variant="footnote" color="textSecondary" uppercase style={styles.label}>
              {v}
            </Text>
            <View style={styles.buttonRow}>
              <Button label="Save" onPress={NOOP} variant={v} icon="checkmark" style={styles.third} />
              <Button label="Save" onPress={NOOP} variant={v} loading style={styles.third} />
              <Button label="Save" onPress={NOOP} variant={v} disabled style={styles.third} />
            </View>
          </View>
        ))}
        <View style={{ gap: Spacing.sm }}>
          <Text variant="footnote" color="textSecondary" uppercase style={styles.label}>
            hug width
          </Text>
          <Button label="Add vehicle" onPress={NOOP} icon="add" fullWidth={false} />
        </View>
      </Screen>
    );
  }

  if (page === "rows") {
    return (
      <Screen title="Rows" trailing={back} testID="gallery-rows">
        <Section title="Vehicles" footer="Rows with a leading icon use a 56pt divider inset." dividerInset={56}>
          <Row title="2019 Toyota 4Runner" subtitle="84,210 mi · updated 3 days ago" icon="car" onPress={NOOP} appearIndex={0} />
          <Row title="2022 Honda Odyssey" subtitle="Oil change overdue" icon="car" value="2 due" onPress={NOOP} appearIndex={1} />
          <Row title="Locked vehicle" subtitle="Upgrade to access" icon="lock-closed" iconColor={Colors.textTertiary} onPress={NOOP} disabled appearIndex={2} />
        </Section>
        <Section title="Settings" dividerInset={56}>
          <Row title="Subscription" value="Personal" icon="person" iconBackground={Colors.card} onPress={NOOP} appearIndex={3} />
          <Row title="Push notifications" icon="notifications-outline" iconBackground={Colors.card} trailing={<Switch value onValueChange={NOOP} trackColor={{ true: Colors.accent }} />} appearIndex={4} />
          <Row title="Expand details" icon="chevron-down" iconColor={Colors.textSecondary} onPress={NOOP} chevron={false} appearIndex={5} />
        </Section>
        <Section title="Account">
          <Row title="Sign out" onPress={NOOP} appearIndex={6} />
          <Row title="Delete account" destructive onPress={NOOP} appearIndex={7} />
        </Section>
      </Screen>
    );
  }

  if (page === "cards") {
    return (
      <Screen title="Cards" trailing={back} testID="gallery-cards">
        <Card>
          <Text variant="footnote" color="textSecondary" uppercase style={styles.label}>
            static
          </Text>
          <Text variant="title3">$412 this month</Text>
          <Text variant="subheadline" color="textSecondary">
            Across 2 vehicles and 1 home
          </Text>
        </Card>
        <Card onPress={NOOP} accessibilityLabel="Open 2019 Toyota 4Runner">
          <View style={styles.cardRow}>
            <View style={[styles.avatar, { backgroundColor: Colors.card }]}>
              <Icon name="car" size={22} color={Colors.textSecondary} weight="semibold" />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="headline" numberOfLines={1}>2019 Toyota 4Runner</Text>
              <Text variant="subheadline" color="textSecondary" numberOfLines={1}>Oil change in 847 mi</Text>
            </View>
            <Icon name="chevron-forward" size={14} color={Colors.textTertiary} weight="semibold" />
          </View>
        </Card>
        <Card padding={Spacing.md}>
          <Text variant="caption" color="textTertiary">padding 12 · caption</Text>
        </Card>
      </Screen>
    );
  }

  if (page === "chips") {
    const tones = ["accent", "vehicle", "home", "health"] as const;
    return (
      <Screen title="Chips" trailing={back} testID="gallery-chips">
        {tones.map((tone) => (
          <View key={tone} style={{ gap: Spacing.sm }}>
            <Text variant="footnote" color="textSecondary" uppercase style={styles.label}>
              {tone}
            </Text>
            <View style={styles.chipRow}>
              <Chip label="Idle" tone={tone} onPress={NOOP} />
              <Chip label="Selected" tone={tone} selected onPress={NOOP} />
              <Chip label="Icon" tone={tone} selected icon="checkmark" onPress={NOOP} />
              <Chip label="Disabled" tone={tone} disabled onPress={NOOP} />
            </View>
          </View>
        ))}
      </Screen>
    );
  }

  if (page === "empty") {
    return (
      <Screen title="Empty" trailing={back} testID="gallery-empty">
        <EmptyState
          icon="car-outline"
          tone="vehicle"
          title="Never forget an oil change again"
          body="Add your first vehicle and we build its maintenance plan in about 30 seconds."
          action={{ label: "Add vehicle", onPress: NOOP }}
          secondaryAction={{ label: "or import from a spreadsheet", onPress: NOOP }}
        />
        <EmptyState
          icon="cloud-offline-outline"
          title="Unable to load your vehicles"
          body="Your vehicles are saved and safe. Check your connection and try again."
          action={{ label: "Try again", onPress: NOOP }}
        />
      </Screen>
    );
  }

  return (
    <Screen title="Icons" trailing={back} testID="gallery-icons">
      <Card padding={Spacing.sm}>
        <View style={styles.iconGrid}>
          {ICON_NAMES.map((name) => (
            <View key={name} style={styles.iconCell}>
              <Icon name={name} size={22} color={Colors.text} />
            </View>
          ))}
        </View>
      </Card>
      <Text variant="footnote" color="textTertiary" align="center">
        {ICON_NAMES.length} symbols · 22pt · an empty cell is a bad name
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontWeight: "600", letterSpacing: 0.4, marginLeft: Spacing.lg },
  buttonRow: { flexDirection: "row", gap: Spacing.sm },
  third: { flex: 1, alignSelf: "auto", paddingHorizontal: Spacing.sm },
  cardRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  avatar: { width: 40, height: 40, borderRadius: Radius.pill, alignItems: "center", justifyContent: "center" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  iconGrid: { flexDirection: "row", flexWrap: "wrap" },
  iconCell: { width: "12.5%", height: 44, alignItems: "center", justifyContent: "center" },
});
