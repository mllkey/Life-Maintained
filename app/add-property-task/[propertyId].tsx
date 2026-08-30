import React, { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "@/constants/colors";
import { Icon } from "@/components/ui/Icon";
import { Typography } from "@/constants/typography";
import { Radius } from "@/constants/radius";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import DatePicker from "@/components/DatePicker";

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
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [task, setTask] = useState("");
  const [category, setCategory] = useState("General");
  const [interval, setInterval] = useState("Annually");
  const [estimatedCost, setEstimatedCost] = useState("");
  const [priority, setPriority] = useState("medium");
  const [nextDueDate, setNextDueDate] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<any>(null);
  const scrollOffset = useRef(0);

  function applyTemplate(t: typeof TEMPLATE_TASKS[0]) {
    setTask(t.task);
    setCategory(t.category);
    setInterval(t.interval);
    setEstimatedCost(t.cost);
    Haptics.selectionAsync();
  }

  async function handleSave() {
    if (isLoading) return;
    if (!propertyId || !user) return;
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
      user_id: user.id,
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
    if (err) { setIsLoading(false); setError("Couldn't save that just now. Please try again."); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); }
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
            <Icon name="close" size={22} color={Colors.text} />
          </Pressable>
          <Text style={styles.title}>Add Task</Text>
          <Pressable style={({ pressed }) => [styles.saveBtn, { opacity: pressed ? 0.8 : 1 }]} onPress={handleSave} disabled={isLoading}>
            {isLoading ? <ActivityIndicator size="small" color={Colors.textInverse} /> : <Text style={styles.saveBtnText}>Add Task</Text>}
          </Pressable>
        </View>

        <ScrollView ref={scrollRef} onScroll={e => { scrollOffset.current = e.nativeEvent.contentOffset.y; }} scrollEventThrottle={16} contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {error && <View style={styles.errorBox}><Icon name="alert-circle" size={16} color={Colors.overdue} /><Text style={styles.errorText}>{error}</Text></View>}

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
                <Pressable key={c} style={[styles.chip, category === c && styles.chipSelected]} onPress={() => { setCategory(c); Haptics.selectionAsync(); }}>
                  <Text style={[styles.chipText, category === c && styles.chipTextSelected]}>{c}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Interval</Text>
            <View style={styles.grid}>
              {INTERVALS.map(iv => (
                <Pressable key={iv} style={[styles.chip, interval === iv && styles.chipSelected]} onPress={() => { setInterval(iv); Haptics.selectionAsync(); }}>
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
                  <Pressable key={p} style={[styles.priorityBtn, selected && { borderColor: colors[p as keyof typeof colors], backgroundColor: colors[p as keyof typeof colors] + "22" }]} onPress={() => { setPriority(p); Haptics.selectionAsync(); }}>
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
              <Text style={styles.sectionTitle}>Next Due Date</Text>
              <DatePicker
                value={nextDueDate}
                onChange={setNextDueDate}
                maximumDate={new Date(new Date().setFullYear(new Date().getFullYear() + 5))}
                minimumDate={new Date()}
                onClose={() => { const y = scrollOffset.current; setTimeout(() => { scrollRef.current?.scrollTo({ y, animated: false }); }, 100); }}
              />
            </View>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  closeBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title: { ...Typography.headline, color: Colors.text },
  saveBtn: { backgroundColor: Colors.accent, borderRadius: Radius.md, paddingHorizontal: 16, paddingVertical: 8 },
  saveBtnText: { ...Typography.subheadline, fontWeight: "600", color: Colors.textInverse },
  scroll: { paddingHorizontal: 20, paddingTop: 16, gap: 20 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.card, borderRadius: Radius.md, padding: 12 },
  errorText: { ...Typography.footnote, flex: 1, color: Colors.overdue },
  section: { gap: 8 },
  sectionTitle: { ...Typography.caption, fontWeight: "600", color: Colors.textTertiary, textTransform: "uppercase", letterSpacing: 1.5 },
  templates: { gap: 8, paddingBottom: 4 },
  template: { width: 130, backgroundColor: Colors.card, borderRadius: Radius.md, padding: 12, borderWidth: 1, borderColor: Colors.border, gap: 4 },
  templateTask: { ...Typography.footnote, fontWeight: "500", color: Colors.text },
  templateMeta: { ...Typography.caption, color: Colors.textSecondary },
  input: { ...Typography.subheadline, backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 16, paddingVertical: 12, color: Colors.text },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.lg, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  chipSelected: { backgroundColor: Colors.accentMuted, borderColor: Colors.accent },
  chipText: { ...Typography.footnote, fontWeight: "500", color: Colors.textSecondary },
  chipTextSelected: { color: Colors.accent },
  row: { flexDirection: "row", gap: 12 },
  priorityBtn: { flex: 1, paddingVertical: 12, borderRadius: Radius.md, alignItems: "center", borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  priorityText: { ...Typography.footnote, fontWeight: "500", color: Colors.textSecondary },
});
