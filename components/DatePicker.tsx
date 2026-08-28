import React, { useState } from "react";
import { View, Text, Pressable, Platform, Modal, StyleSheet } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Colors } from "@/constants/colors";
import { Typography } from "@/constants/typography";
import { Radius } from "@/constants/radius";
import { format, parseISO } from "date-fns";

interface DatePickerProps {
  value: string; // "yyyy-MM-dd"
  onChange: (date: string) => void;
  maximumDate?: Date;
  minimumDate?: Date;
  label?: string;
  onOpen?: () => void;
  onClose?: () => void;
}

export default function DatePicker({ value, onChange, maximumDate, minimumDate, label, onOpen, onClose }: DatePickerProps) {
  const [show, setShow] = useState(false);
  const dateObj = value ? parseISO(value) : new Date();

  function handleChange(_: unknown, selectedDate?: Date) {
    if (Platform.OS === "android") { setShow(false); onClose?.(); }
    if (selectedDate) {
      onChange(format(selectedDate, "yyyy-MM-dd"));
    }
  }

  return (
    <View>
      {label && <Text style={styles.label}>{label}</Text>}
      <Pressable
        onPress={() => { setShow(true); onOpen?.(); }}
        style={({ pressed }) => [styles.field, { opacity: pressed ? 0.8 : 1 }]}
      >
        <Text style={styles.fieldText}>
          {value ? format(parseISO(value), "MMM d, yyyy") : "Select date"}
        </Text>
      </Pressable>
      {show && Platform.OS === "ios" && (
        <Modal transparent animationType="slide" onRequestClose={() => { setShow(false); onClose?.(); }}>
          <View style={styles.modalRoot}>
            <Pressable style={styles.backdrop} onPress={() => { setShow(false); onClose?.(); }} />
            <View style={styles.pickerContainer}>
              <View style={styles.pickerHeader}>
                <Pressable onPress={() => { setShow(false); onClose?.(); }}>
                  <Text style={styles.doneBtn}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={dateObj}
                mode="date"
                display="spinner"
                onChange={handleChange}
                maximumDate={maximumDate ?? new Date()}
                minimumDate={minimumDate}
                textColor={Colors.text}
              />
            </View>
          </View>
        </Modal>
      )}
      {show && Platform.OS === "android" && (
        <DateTimePicker
          value={dateObj}
          mode="date"
          display="default"
          onChange={handleChange}
          maximumDate={maximumDate ?? new Date()}
          minimumDate={minimumDate}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    ...Typography.caption, fontWeight: "600", color: Colors.textSecondary,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  field: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
  },
  fieldText: { ...Typography.subheadline, color: Colors.text },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  pickerContainer: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 20,
  },
  pickerHeader: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  doneBtn: { ...Typography.subheadline, fontWeight: "600", color: Colors.accent },
});
