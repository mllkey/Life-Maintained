import { Ionicons } from "@expo/vector-icons";
import type { SFSymbol } from "expo-symbols";

type IonName = keyof typeof Ionicons.glyphMap;

/**
 * Ionicons name -> SF Symbol. Keys are the Ionicons names the app already uses,
 * so the P2 sweep is a mechanical rename of the component, not the name.
 * `satisfies` makes tsc reject any unknown Ionicons key or SF value.
 */
export const IONICON_TO_SF = {
  // navigation + chrome
  "close": "xmark",
  "close-circle": "xmark.circle.fill",
  "chevron-forward": "chevron.right",
  "chevron-back": "chevron.left",
  "chevron-down": "chevron.down",
  "chevron-up": "chevron.up",
  "arrow-back": "arrow.left",
  "arrow-forward": "arrow.right",
  "arrow-down-circle-outline": "arrow.down.circle",
  "open-outline": "arrow.up.right.square",
  "grid": "square.grid.2x2.fill",
  "settings": "gearshape.fill",
  "search-outline": "magnifyingglass",
  "share-outline": "square.and.arrow.up",
  "download-outline": "arrow.down.to.line",
  "refresh": "arrow.clockwise",
  "refresh-outline": "arrow.clockwise",
  "repeat-outline": "repeat",
  "link-outline": "link",
  "git-compare-outline": "arrow.triangle.branch",
  "keypad-outline": "circle.grid.3x3",
  "ellipse-outline": "circle",
  // status
  "alert-circle": "exclamationmark.circle.fill",
  "alert-circle-outline": "exclamationmark.circle",
  "warning-outline": "exclamationmark.triangle",
  "checkmark": "checkmark",
  "checkmark-circle": "checkmark.circle.fill",
  "checkmark-circle-outline": "checkmark.circle",
  "information-circle-outline": "info.circle",
  "shield-checkmark": "checkmark.shield.fill",
  "shield-checkmark-outline": "checkmark.shield",
  "cloud-offline-outline": "icloud.slash",
  "cloud-upload-outline": "icloud.and.arrow.up",
  "lock-closed": "lock.fill",
  "lock-closed-outline": "lock",
  "sparkles": "sparkles",
  "sparkles-outline": "sparkles",
  "bulb-outline": "lightbulb",
  "flash-outline": "bolt",
  // actions
  "add": "plus",
  "add-circle-outline": "plus.circle",
  "remove-circle-outline": "minus.circle",
  "trash-outline": "trash",
  "pencil-outline": "pencil",
  "camera-outline": "camera",
  "scan-outline": "viewfinder",
  "mic": "mic.fill",
  "mic-outline": "mic",
  "mic-off-outline": "mic.slash",
  "stop": "stop.fill",
  "eye-outline": "eye",
  "eye-off-outline": "eye.slash",
  // documents + money
  "document-outline": "doc",
  "document-text": "doc.text.fill",
  "document-text-outline": "doc.text",
  "receipt-outline": "doc.plaintext",
  "cash-outline": "banknote",
  // time + place
  "time-outline": "clock",
  "timer-outline": "timer",
  "calendar": "calendar",
  "calendar-outline": "calendar",
  "location": "location.fill",
  "location-outline": "location",
  "notifications-outline": "bell",
  // people + contact
  "person": "person.fill",
  "person-outline": "person",
  "person-circle-outline": "person.circle",
  "person-add-outline": "person.badge.plus",
  "paw-outline": "pawprint",
  "mail-outline": "envelope",
  "call-outline": "phone",
  "phone-portrait-outline": "iphone",
  "briefcase": "briefcase.fill",
  "business": "building.2.fill",
  // verticals
  "car": "car.fill",
  "car-outline": "car",
  "car-sport": "car.fill",
  "car-sport-outline": "car",
  "speedometer-outline": "speedometer",
  "home": "house.fill",
  "home-outline": "house",
  "heart": "heart.fill",
  "heart-outline": "heart",
  "medkit-outline": "cross.case",
  "construct": "wrench.and.screwdriver.fill",
  "construct-outline": "wrench.and.screwdriver",
  // P2(a) sweep: names reached through IconName-typed props on swept components
  "compass-outline": "safari",
  "create-outline": "square.and.pencil",
  "people-outline": "person.2",
  "folder-open-outline": "folder",
  "wallet-outline": "wallet.pass",
  "layers-outline": "square.stack",
  "business-outline": "building.2",
  "storefront-outline": "storefront",
  "sunny-outline": "sun.max",
} as const satisfies Partial<Record<IonName, SFSymbol>>;

export type IconName = keyof typeof IONICON_TO_SF;

export const ICON_NAMES = Object.keys(IONICON_TO_SF) as IconName[];
