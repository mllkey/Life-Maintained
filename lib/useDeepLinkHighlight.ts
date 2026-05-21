import { useCallback, useEffect, useRef, useState } from "react";
import type { ElementRef } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { ScrollView, View, findNodeHandle } from "react-native";

/**
 * Persistent deep-link highlight hook.
 *
 * Lifecycle:
 *   1. Caller passes a target id (or null/undefined).
 *   2. Hook records the id, schedules a scroll-into-view (animated, y - topOffset).
 *   3. Highlight is locked-in for `lockInMs` (default 1000). During lock-in,
 *      scroll/touch dismissal is ignored so the scroll animation itself can't clear it.
 *   4. After lock-in, the next scroll/touch clears the highlight instantly.
 *   5. Screen blur uses dismissImmediately() and always clears, even during lock-in.
 *
 * - lastHandledRef ensures the same id never re-triggers after blur/refocus.
 * - Active same-id effects are allowed to re-run so React StrictMode cleanup/replay
 *   cannot permanently cancel the scheduled scroll in development.
 * - No fade, no pulse. Apple Mail / iMessage / Reminders pattern.
 */
export function useDeepLinkHighlight(
  targetId: string | null | undefined,
  options?: {
    topOffset?: number;
    lockInMs?: number;
    scrollDelayMs?: number;
  },
) {
  const topOffset = options?.topOffset ?? 80;
  const lockInMs = options?.lockInMs ?? 1000;
  const scrollDelayMs = options?.scrollDelayMs ?? 250;

  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const scrollRef = useRef<ElementRef<typeof ScrollView> | null>(null);
  const rowRefs = useRef<Record<string, ElementRef<typeof View> | null>>({});
  const lastHandledRef = useRef<string | null>(null);
  const lockUntilRef = useRef<number>(0);
  const activeIdRef = useRef<string | null>(null);

  const dismissImmediately = useCallback(() => {
    if (activeIdRef.current === null) return;
    activeIdRef.current = null;
    setHighlightedId(null);
  }, []);

  const dismissAfterLock = useCallback(() => {
    if (activeIdRef.current === null) return;
    if (Date.now() < lockUntilRef.current) return;
    dismissImmediately();
  }, [dismissImmediately]);

  const scrollProps = {
    ref: (node: ElementRef<typeof ScrollView> | null) => {
      scrollRef.current = node;
    },
    onScrollBeginDrag: (_: NativeSyntheticEvent<NativeScrollEvent>) => {
      dismissAfterLock();
    },
    onTouchStart: () => {
      dismissAfterLock();
    },
  };

  const registerRow = useCallback(
    (id: string, node: ElementRef<typeof View> | null) => {
      rowRefs.current[id] = node;
    },
    [],
  );

  useEffect(() => {
    if (!targetId) return;
    if (lastHandledRef.current === targetId && activeIdRef.current !== targetId) return;
    lastHandledRef.current = targetId;

    activeIdRef.current = targetId;
    lockUntilRef.current = Date.now() + lockInMs;
    setHighlightedId(targetId);

    const performScroll = () => {
      const scroll = scrollRef.current;
      const row = rowRefs.current[targetId];
      if (!scroll || !row) return;
      const node = findNodeHandle(scroll);
      if (node == null) return;
      row.measureLayout(
        node,
        (_x, y) => {
          scroll.scrollTo({ y: Math.max(0, y - topOffset), animated: true });
        },
        () => {},
      );
    };

    const t1 = setTimeout(performScroll, scrollDelayMs);
    const t2 = setTimeout(performScroll, scrollDelayMs + 500);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [targetId, topOffset, lockInMs, scrollDelayMs]);

  return { highlightedId, scrollProps, registerRow, dismissImmediately };
}
