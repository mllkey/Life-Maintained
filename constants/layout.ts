/**
 * Shared chrome metrics so scroll content, the tab bar, and the floating mic
 * FAB agree on one bottom inset. Every tab-level scroll view pads its bottom
 * with scrollBottomInset(insets.bottom) so the FAB can never sit on a card.
 */
import { Platform } from "react-native";

export const FAB_SIZE = 48;
export const FAB_MARGIN = 16;
export const FAB_LEFT = 20;
export const TAB_BAR_HEIGHT = Platform.OS === "web" ? 84 : 49;
/** Breathing room between the FAB's top edge and the last card. */
const FAB_CLEARANCE = 16;

/** Distance from the screen bottom to the FAB's bottom edge. */
export function fabBottomOffset(safeAreaBottom: number): number {
  return safeAreaBottom + TAB_BAR_HEIGHT + FAB_MARGIN;
}

/** Bottom padding for any tab-level scroll view: FAB + its margin + tab bar + safe area (+ clearance). */
export function scrollBottomInset(safeAreaBottom: number): number {
  return FAB_SIZE + FAB_MARGIN + TAB_BAR_HEIGHT + safeAreaBottom + FAB_CLEARANCE;
}
