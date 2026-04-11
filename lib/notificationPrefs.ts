import AsyncStorage from "@react-native-async-storage/async-storage";

export const NOTIF_PREFS_KEY = "notification_prefs";

export type NotifPrefs = {
  pushEnabled: boolean;
  advanceDays: number;
  quietHoursStart: string;
  quietHoursEnd: string;
  notificationTime: string;
  mutedVehicles: string[];
  mutedProperties: string[];
};

export const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  pushEnabled: false,
  advanceDays: 14,
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
  notificationTime: "09:00",
  mutedVehicles: [],
  mutedProperties: [],
};

export async function loadNotifPrefs(): Promise<NotifPrefs> {
  try {
    const raw = await AsyncStorage.getItem(NOTIF_PREFS_KEY);
    return raw ? { ...DEFAULT_NOTIF_PREFS, ...JSON.parse(raw) } : DEFAULT_NOTIF_PREFS;
  } catch {
    return DEFAULT_NOTIF_PREFS;
  }
}

export async function saveNotifPrefs(prefs: NotifPrefs): Promise<void> {
  await AsyncStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(prefs));
}
