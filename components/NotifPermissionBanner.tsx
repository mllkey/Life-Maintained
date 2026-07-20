import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { upsertPushToken, resolveAuthUserId } from "@/lib/notificationScheduler";
import { loadNotifPrefs, saveNotifPrefs } from "@/lib/notificationPrefs";
import { supabase } from "@/lib/supabase";

// Pre-permission primer. Centered takeover shown when OS notification
// permission is undetermined or denied. "Not now" snoozes for 7 days,
// scoped per user: notifications are the product's core value and the
// ask must stay re-presentable without nagging. The iOS system prompt
// fires only from the explicit primary CTA (two-step primer), so a
// passive glance never burns the one-shot system dialog. A foreground
// recheck closes the loop when the user grants permission from the
// iOS Settings app. Token registration is best-effort here: the
// notification scheduler refreshes the push token on every run, so any
// transient failure self-heals on the next app open.
const SNOOZE_KEY = "notif_prompt_snoozed_until";
const SNOOZE_DAYS = 7;

const ENTER_SPRING = { damping: 22, stiffness: 240, mass: 0.9 };

interface Props {
  userId?: string | null;
  onDismiss?: () => void;
}

export default function NotifPermissionBanner({ userId, onDismiss }: Props) {
  const [visible, setVisible] = useState(false);
  const [permStatus, setPermStatus] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const busyRef = useRef(false);
  const visibleRef = useRef(false);
  const cardScale = useSharedValue(0.92);
  const cardOpacity = useSharedValue(0);

  const snoozeStorageKey = SNOOZE_KEY + ":" + (userId ?? "anon");

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    checkAndShow();
  }, []);

  // Foreground recheck: if the user granted permission from the iOS
  // Settings app while the primer was open (denied variant), finish
  // provisioning and close. Also covers a grant that resolves while the
  // app was backgrounded by the system permission sheet.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      void recheckOnForeground();
    });
    return () => sub.remove();
  }, []);

  async function recheckOnForeground() {
    if (!visibleRef.current) return;
    if (busyRef.current) return;
    try {
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== "granted") return;
      busyRef.current = true;
      setRequesting(true);
      try {
        await provisionAfterGrant();
      } finally {
        busyRef.current = false;
        setRequesting(false);
      }
    } catch {
    }
  }

  async function checkAndShow() {
    try {
      const snoozedUntil = await AsyncStorage.getItem(snoozeStorageKey);
      if (snoozedUntil) {
        const until = Date.parse(snoozedUntil);
        if (Number.isFinite(until) && Date.now() < until) return;
      }

      const { status } = await Notifications.getPermissionsAsync();
      if (status !== "denied" && status !== "undetermined") return;

      setPermStatus(status);
      await new Promise(resolve => setTimeout(resolve, 800));
      setVisible(true);
      cardScale.value = withSpring(1, ENTER_SPRING);
      cardOpacity.value = withSpring(1, ENTER_SPRING);
    } catch {
    }
  }

  const cardStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ scale: cardScale.value }],
  }));

  function closeQuietly() {
    setVisible(false);
    onDismiss?.();
  }

  // After an OS grant, persist the user's intent everywhere it is read.
  // Every step is best-effort with a warn: the scheduler re-registers the
  // push token on every run while permission is granted, so a transient
  // failure here cannot strand the user in a broken state.
  async function provisionAfterGrant() {
    const resolvedUserId = await resolveAuthUserId();
    if (resolvedUserId) {
      const tokenResult = await upsertPushToken(resolvedUserId);
      if (!tokenResult.ok) {
        console.warn("[NotifPrimer] upsertPushToken failed:", tokenResult.reason);
      }

      try {
        const { error } = await (supabase.from("user_notification_preferences") as any)
          .upsert(
            { user_id: resolvedUserId, push_enabled: true, updated_at: new Date().toISOString() },
            { onConflict: "user_id" }
          );
        if (error) {
          console.warn("[NotifPrimer] push_enabled DB upsert failed:", error.message);
        }
      } catch (e) {
        console.warn("[NotifPrimer] push_enabled DB upsert threw:", e);
      }
    } else {
      console.warn("[NotifPrimer] no resolved user id; scheduler will self-heal token");
    }

    try {
      const existing = await loadNotifPrefs();
      await saveNotifPrefs({ ...existing, pushEnabled: true });
    } catch (e) {
      console.warn("[NotifPrimer] AsyncStorage pushEnabled write failed:", e);
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    closeQuietly();
  }

  async function snooze() {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        const until = new Date(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000).toISOString();
        await AsyncStorage.setItem(snoozeStorageKey, until);
      } catch {
      }
      closeQuietly();
    } finally {
      busyRef.current = false;
    }
  }

  async function handleTurnOn() {
    if (busyRef.current) return;
    busyRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setRequesting(true);
    try {
      if (permStatus === "undetermined") {
        const result = await Notifications.requestPermissionsAsync();
        if (result.granted) {
          await provisionAfterGrant();
          return;
        }
        setPermStatus("denied");
      } else {
        try {
          await Linking.openSettings();
        } catch (e) {
          console.warn("[NotifPrimer] openSettings failed:", e);
        }
        // Modal stays open: the foreground recheck provisions and closes
        // if the user returns with permission granted.
      }
    } finally {
      busyRef.current = false;
      setRequesting(false);
    }
  }

  if (!visible) return null;

  const undetermined = permStatus === "undetermined";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={snooze}
    >
      <View style={styles.backdrop}>
        <Animated.View style={[styles.card, cardStyle]} accessibilityViewIsModal>
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.cardContent}
          >
            <View style={styles.iconRow}>
              <View style={[styles.iconTile, { backgroundColor: Colors.vehicleMuted }]}>
                <Ionicons name="car" size={22} color={Colors.vehicle} />
              </View>
              <View style={[styles.iconTile, { backgroundColor: Colors.homeMuted }]}>
                <Ionicons name="home" size={22} color={Colors.home} />
              </View>
              <View style={[styles.iconTile, { backgroundColor: Colors.healthMuted }]}>
                <Ionicons name="heart" size={22} color={Colors.health} />
              </View>
            </View>

            <Text style={styles.title}>Never miss what matters</Text>
            <Text style={styles.body}>
              {undetermined
                ? "LifeMaintained tracks deadlines and reminds you at the right moment."
                : "Notifications are off for LifeMaintained. Turn them on in Settings so reminders can reach you when something is due."}
            </Text>

            <Pressable
              onPress={handleTurnOn}
              disabled={requesting}
              style={({ pressed }) => [
                styles.primaryBtn,
                { opacity: requesting ? 0.75 : pressed ? 0.85 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={undetermined ? "Turn on notifications" : "Open notification settings"}
            >
              {requesting ? (
                <ActivityIndicator color={Colors.textInverse} />
              ) : (
                <Text style={styles.primaryBtnText}>
                  {undetermined ? "Turn On Notifications" : "Open Settings"}
                </Text>
              )}
            </Pressable>

            <Pressable
              onPress={snooze}
              disabled={requesting}
              style={({ pressed }) => [styles.secondaryBtn, { opacity: pressed ? 0.7 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Not now"
            >
              <Text style={styles.secondaryBtnText}>Not now</Text>
            </Pressable>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
  },
  card: {
    width: "100%",
    maxWidth: 340,
    maxHeight: "85%",
    backgroundColor: Colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 12,
  },
  cardContent: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 16,
  },
  iconRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 18,
  },
  iconTile: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: Colors.text,
    textAlign: "center",
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 22,
  },
  primaryBtn: {
    alignSelf: "stretch",
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  primaryBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textInverse,
    textAlign: "center",
  },
  secondaryBtn: {
    alignSelf: "stretch",
    alignItems: "center",
    paddingVertical: 14,
    marginTop: 4,
  },
  secondaryBtnText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },
});
