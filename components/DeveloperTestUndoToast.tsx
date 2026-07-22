// DEV-ONLY TEST TOOL - UndoToast host validation.
//
// TODO POST-VALIDATION: delete this file and its two lines in app/(tabs)/settings.tsx
// (the import and the {__DEV__ && <DeveloperTestUndoToast />} mount) once the UndoToast
// host is device-verified. It exists only to exercise the host before a real caller
// (the auto-complete log flow) depends on it. It is dead-code-stripped from release
// builds by the {__DEV__ && ...} gate, but should not linger in the tree.

import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { showUndoToast, type UndoResult } from "@/components/UndoToast";

type Ionicon = React.ComponentProps<typeof Ionicons>["name"];

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type TestRow = {
  key: string;
  label: string;
  sub: string;
  icon: Ionicon;
  accent: string;
  fire: () => void;
};

export default function DeveloperTestUndoToast() {
  const [fired, setFired] = useState(0);

  const rows: TestRow[] = [
    {
      key: "success",
      label: "Undo succeeds",
      sub: "Tap Undo -> spinner -> 'Undone' + success haptic -> auto-dismiss",
      icon: "checkmark-circle-outline",
      accent: Colors.good ?? Colors.accent,
      fire: () =>
        showUndoToast({
          message: "Oil Change marked complete",
          subtitle: "Next due in 5,000 mi",
          onUndo: async (): Promise<UndoResult> => {
            await delay(1200);
            return { ok: true };
          },
        }),
    },
    {
      key: "fail",
      label: "Undo fails (TOCTOU)",
      sub: "Tap Undo -> red alert-circle + message + warning haptic",
      icon: "warning-outline",
      accent: Colors.overdue,
      fire: () =>
        showUndoToast({
          message: "Brake Fluid marked complete",
          subtitle: "Next due Mar 2027",
          onUndo: async (): Promise<UndoResult> => {
            await delay(1200);
            return { ok: false, message: "That log already changed. Refresh to see the latest." };
          },
        }),
    },
    {
      key: "hang",
      label: "Undo hangs (10s bound)",
      sub: "Tap Undo -> spinner -> after 10s: connection message, no infinite spin",
      icon: "time-outline",
      accent: Colors.dueSoon ?? Colors.accent,
      fire: () =>
        showUndoToast({
          message: "Tire Rotation marked complete",
          subtitle: "Never resolves - validates the timeout",
          onUndo: (): Promise<UndoResult> => new Promise<UndoResult>(() => {}),
        }),
    },
    {
      key: "rapid",
      label: "Rapid replace",
      sub: "Fires toast A, then B 400ms later - B must cleanly replace A",
      icon: "layers-outline",
      accent: Colors.accent,
      fire: () => {
        showUndoToast({
          message: "First: Air Filter",
          subtitle: "Should be replaced by the second toast",
          onUndo: async (): Promise<UndoResult> => {
            await delay(800);
            return { ok: true };
          },
        });
        setTimeout(() => {
          showUndoToast({
            message: "Second: Spark Plugs",
            subtitle: "This one should be showing",
            onUndo: async (): Promise<UndoResult> => {
              await delay(800);
              return { ok: true };
            },
          });
        }, 400);
      },
    },
  ];

  return (
    <View>
      <Text style={styles.sectionLabel}>Developer - UndoToast</Text>
      <View style={styles.groupCard}>
        {rows.map((r, idx) => (
          <React.Fragment key={r.key}>
            {idx > 0 && <View style={styles.divider} />}
            <Pressable
              style={({ pressed }) => [styles.row, { opacity: pressed ? 0.55 : 1 }]}
              onPress={() => {
                r.fire();
                setFired((n) => n + 1);
              }}
              accessibilityRole="button"
              accessibilityLabel={r.label}
            >
              <View style={[styles.iconWrap, { backgroundColor: `${r.accent}1A`, borderColor: `${r.accent}33` }]}>
                <Ionicons name={r.icon} size={18} color={r.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{r.label}</Text>
                <Text style={styles.rowSub}>{r.sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
            </Pressable>
          </React.Fragment>
        ))}
      </View>
      <Text style={styles.hint}>
        Dev-only. Exercises the root UndoToast host directly (no backend). Fired {fired}x
        this session. Delete this tool once the host is device-verified.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.textSecondary,
    textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, marginLeft: 4,
  },
  groupCard: {
    backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1,
    borderColor: Colors.border, overflow: "hidden",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  iconWrap: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  rowLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.text },
  rowSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary, marginTop: 2 },
  divider: { height: 1, backgroundColor: Colors.border, marginLeft: 60 },
  hint: {
    marginTop: 8, paddingHorizontal: 4, fontSize: 11, fontFamily: "Inter_400Regular",
    color: Colors.textSecondary, lineHeight: 16,
  },
});
