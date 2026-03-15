import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";

const CATEGORIES = ["HVAC", "Roof", "Gutters", "Plumbing", "Electrical", "Appliances", "Pest Control", "Landscaping", "Painting", "Foundation", "Windows", "General"];
const INTERVALS = ["Monthly", "Quarterly", "Bi-Annually", "Annually", "Every 2 Years", "Every 5 Years", "As Needed"];
const PRIORITIES = ["high", "medium", "low"];

const TEMPLATE_TASKS: { task: string; category: string; interval: string; cost: string }[] = [
  { task: "Replace HVAC Air Filter", category: "HVAC", interval: "Monthly", cost: "20" },
  { task: "HVAC Annual Tune-Up", category: "HVAC", interval: "Annually", cost: "150" },
  { task: "Clean Gutters", category: "Gutters", interval: "Bi-Annually", cost: "200" },
  { task: "Roof Inspection", category: "Roof", interval: "Annually", cost: "300" },
  { task: "Pest Control Spray", category: "Pest Control", interval: "Quarterly", cost: "80" },
  { task: "Drain Cleaning", category: "Plumbing", interval: "Annually", cost: "150" },
  { task: "Smoke Detector Test", category: "General", interval: "Monthly", cost: "0" },
  { task: "Exterior Paint", category: "Painting", interval: "Every 5 Years", cost: "2000" },
];

export default function AddPropertyTaskScreen() {
  const { propertyId } = useLocalSearchParams<{ propertyId: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [task, setTask] = useState("");
  const [category, setCategory] = useState("General");
  const [interval, setInterval] = useState("Annually");
  const [estimatedCost, setEstimatedCost] = useState("");
  const [priority, setPriority] = useState("medium");
  const [nextDueDate, setNextDueDate] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyTemplate(t: typeof TEMPLATE_TASKS[0]) {
    Haptics.selectionAsync();
    setTask(t.task);
    setCategory(t.category);
    setInterval(t.interval);
    setEstimatedCost(t.cost);
  }

  async function handleSave() {
    if (isLoading) return;
    if (!propertyId) return;
    if (!task.trim()) { setError("Task name is required"); return; }
    setIsLoading(true);
    setError(null);

    let nextDate: string | null = null;
    if (nextDueDate && nextDueDate.length === 10) {
      nextDate = nextDueDate;
    } else {
      const next = new Date();
      const months: Record<string, number> = {
        "Monthly": 1, "Quarterly": 3, "Bi-Annually": 6, "Annually": 12,
        "Every 2 Years": 24, "Every 5 Years": 60, "As Needed": 12,
      };
      next.setMonth(next.getMonth() + (months[interval] ?? 12));
      nextDate = next.toISOString().split("T")[0];
    }

    const { error: err } = await supabase.from("property_maintenance_tasks").insert({
      property_id: propertyId,
      task: task.trim(),
      category,
      interval,
      estimated_cost: estimatedCost ? parseFloat(estimatedCost) : null,
      priority,
      next_due_date: nextDate,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (err) { setIsLoading(false); setError(err.message); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); }
    else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ["property_tasks"] });
      queryClient.invalidateQueries({ queryKey: ["property_task_counts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      router.back();
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.container, { backgroundColor: Colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <Pressable onPress={() => router.back()} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={Colors.text} />
          </Pressable>
          <Text style={styles.title}>Add Task</Text>
          <Pressable style={({ pressed }) => [styles.saveBtn, { opacity: pressed ? 0.8 : 1 }]} onPress={handleSave} disabled={isLoading}>
            {isLoading ? <ActivityIndicator size="small" color={Colors.textInverse} /> : <Text style={styles.saveBtnText}>Save</Text>}
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {error && <View style={styles.errorBox}><Ionicons name="alert-circle" size={16} color={Colors.overdue} /><Text style={styles.errorText}>{error}</Text></View>}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Quick Templates</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.templates}>
              {TEMPLATE_TASKS.map(t => (
                <Pressable key={t.task} style={({ pressed }) => [styles.template, { opacity: pressed ? 0.8 : 1 }]} onPress={() => applyTemplate(t)}>
                  <Text style={styles.templateTask} numberOfLines={2}>{t.task}</Text>
                  <Text style={styles.templateMeta}>{t.interval}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Task Name</Text>
            <TextInput style={styles.input} value={task} onChangeText={setTask} placeholder="Describe the maintenance task..." placeholderTextColor={Colors.textTertiary} returnKeyType="next" />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Category</Text>
            <View style={styles.grid}>
              {CATEGORIES.map(c => (
                <Pressable key={c} style={[styles.chip, category === c && styles.chipSelected]} onPress={() => { Haptics.selectionAsync(); setCategory(c); }}>
                  <Text style={[styles.chipText, category === c && styles.chipTextSelected]}>{c}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Interval</Text>
            <View style={styles.grid}>
              {INTERVALS.map(iv => (
                <Pressable key={iv} style={[styles.chip, interval === iv && styles.chipSelected]} onPress={() => { Haptics.selectionAsync(); setInterval(iv); }}>
                  <Text style={[styles.chipText, interval === iv && styles.chipTextSelected]}>{iv}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Priority</Text>
            <View style={styles.row}>
              {PRIORITIES.map(p => {
                const colors = { high: Colors.overdue, medium: Colors.dueSoon, low: Colors.good };
                const selected = priority === p;
                return (
                  <Pressable key={p} style={[styles.priorityBtn, selected && { borderColor: colors[p as keyof typeof colors], backgroundColor: colors[p as keyof typeof colors] + "22" }]} onPress={() => { Haptics.selectionAsync(); setPriority(p); }}>
                    <Text style={[styles.priorityText, selected && { color: colors[p as keyof typeof colors] }]}>{p.charAt(0).toUpperCase() + p.slice(1)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>Est. Cost ($)</Text>
              <TextInput style={styles.input} value={estimatedCost} onChangeText={setEstimatedCost} placeholder="150" placeholderTextColor={Colors.textTertiary} keyboardType="decimal-pad" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>Next Due (YYYY-MM-DD)</Text>
              <TextInput style={styles.input} value={nextDueDate} onChangeText={setNextDueDate} placeholder="Auto-calculated" placeholderTextColor={Colors.textTertiary} keyboardType="numeric" maxLength={10} />
            </View>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  closeBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  saveBtn: { backgroundColor: Colors.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 6 },
  saveBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 20 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.overdueMuted, borderRadius: 10, padding: 12 },
  errorText: { flex: 1, fontSize: 13, color: Colors.overdue, fontFamily: "Inter_400Regular" },
  section: { gap: 8 },
  sectionTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.textTertiary, textTransform: "uppercase", letterSpacing: 1.5 },
  templates: { gap: 8, paddingBottom: 4 },
  template: { width: 130, backgroundColor: Colors.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: Colors.border, gap: 4 },
  templateTask: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.text },
  templateMeta: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  input: { backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.text },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  chipSelected: { backgroundColor: Colors.homeMuted, borderColor: Colors.home },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  chipTextSelected: { color: Colors.home },
  row: { flexDirection: "row", gap: 10 },
  priorityBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  priorityText: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
});
