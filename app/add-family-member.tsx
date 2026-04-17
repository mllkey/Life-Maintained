import React, { useState } from "react";
import { SaveToast } from "@/components/SaveToast";
import Paywall from "@/components/Paywall";
import { personLimit, petLimit } from "@/lib/subscription";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Platform,
  ActivityIndicator,
  Modal,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";

const MEMBER_TYPES = ["person", "pet"];
const RELATIONSHIPS = ["Myself", "Spouse / Partner", "Child", "Parent", "Sibling", "Other"];
const PET_TYPES = ["Dog", "Cat", "Bird", "Fish", "Rabbit", "Other"];

export default function AddFamilyMemberScreen() {
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const { type } = useLocalSearchParams<{ type?: string | string[] }>();
  const typeParam = Array.isArray(type) ? type[0] : type;

  const [name, setName] = useState("");
  const [memberType, setMemberType] = useState(typeParam === "pet" ? "pet" : "person");
  const [relationship, setRelationship] = useState("");
  const [petType, setPetType] = useState("");
  const [dob, setDob] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showToast, setShowToast] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);

  function formatDob(text: string) {
    const digits = text.replace(/\D/g, "");
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
  }

  async function handleSave() {
    if (isLoading) return;
    if (!user) {
      setError("Session unavailable. Please close and reopen this screen.");
      return;
    }
    if (!name.trim()) { setError("Name is required"); return; }
    try {
      const { data: existing } = await supabase
        .from("family_members")
        .select("member_type")
        .eq("user_id", user.id);
      const peopleCount = existing?.filter((r: { member_type: string }) => r.member_type !== "pet").length ?? 0;
      const petsCount = existing?.filter((r: { member_type: string }) => r.member_type === "pet").length ?? 0;
      if (memberType === "person" && peopleCount >= personLimit(profile)) {
        setShowPaywall(true);
        return;
      }
      if (memberType === "pet" && petsCount >= petLimit(profile)) {
        setShowPaywall(true);
        return;
      }
    } catch {}
    setIsLoading(true);
    setError(null);

    let dateOfBirth: string | null = null;
    if (dob && dob.length === 10) {
      const [month, day, year] = dob.split("/");
      if (month && day && year) dateOfBirth = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }

    const { data: newMember, error: err } = await supabase.from("family_members").insert({
      user_id: user.id,
      name: name.trim(),
      member_type: memberType,
      relationship: memberType === "person" ? relationship || null : null,
      pet_type: memberType === "pet" ? petType || null : null,
      date_of_birth: dateOfBirth,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).select("id").single();

    if (err) { setIsLoading(false); setError(err.message); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); }
    else {
      queryClient.invalidateQueries({ queryKey: ["family_members"] });
      (async () => {
        try {
          await supabase.functions.invoke("generate-health-schedule", {
            body: { family_member_id: newMember?.id, user_id: user.id },
          });
        } catch (scheduleErr) {
          console.error("[generate-health-schedule] Caught:", scheduleErr);
        } finally {
          queryClient.invalidateQueries({ queryKey: ["health_appointments", user.id] });
          queryClient.invalidateQueries({ queryKey: ["member_appointments", newMember?.id] });
          queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        }
      })();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowToast(true);
      setTimeout(() => router.back(), 900);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.container, { backgroundColor: Colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 24 }]}>
          <Pressable onPress={() => router.back()} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={Colors.text} />
          </Pressable>
          <Text style={styles.title}>Add Family Member</Text>
          <Pressable style={({ pressed }) => [styles.saveBtn, { opacity: pressed ? 0.8 : 1 }]} onPress={handleSave} disabled={isLoading}>
            {isLoading ? <ActivityIndicator size="small" color={Colors.textInverse} /> : <Text style={styles.saveBtnText}>Save</Text>}
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {error && <View style={styles.errorBox}><Ionicons name="alert-circle" size={16} color={Colors.overdue} /><Text style={styles.errorText}>{error}</Text></View>}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Type</Text>
            <View style={styles.typeRow}>
              {MEMBER_TYPES.map(t => (
                <Pressable key={t} style={[styles.typeBtn, memberType === t && styles.typeBtnSelected]} onPress={() => { Haptics.selectionAsync(); setMemberType(t); }}>
                  <Ionicons name={t === "pet" ? "paw-outline" : "person-outline"} size={18} color={memberType === t ? Colors.health : Colors.textSecondary} />
                  <Text style={[styles.typeBtnText, memberType === t && styles.typeBtnTextSelected]}>{t === "pet" ? "Pet" : "Person"}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder={memberType === "pet" ? "Buddy, Whiskers..." : "First name"} placeholderTextColor={Colors.textTertiary} autoCapitalize="words" returnKeyType="next" />
          </View>

          {memberType === "person" ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Relationship</Text>
              <View style={styles.grid}>
                {RELATIONSHIPS.map(r => (
                  <Pressable
                    key={r}
                    style={[styles.chip, relationship === r && styles.chipSelected, r === "Myself" && styles.chipMyself, r === "Myself" && relationship === r && styles.chipMyselfSelected]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setRelationship(r);
                      if (r === "Myself" && !name.trim() && user?.email) {
                        const emailName = user.email.split("@")[0];
                        const formatted = emailName.charAt(0).toUpperCase() + emailName.slice(1);
                        setName(formatted);
                      }
                    }}
                  >
                    {r === "Myself" && (
                      <Ionicons name="person-circle-outline" size={14} color={relationship === r ? Colors.health : Colors.textSecondary} />
                    )}
                    <Text style={[styles.chipText, relationship === r && styles.chipTextSelected]}>{r}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Pet Type</Text>
              <View style={styles.grid}>
                {PET_TYPES.map(p => (
                  <Pressable key={p} style={[styles.chip, petType === p && styles.chipSelected]} onPress={() => { Haptics.selectionAsync(); setPetType(p); }}>
                    <Text style={[styles.chipText, petType === p && styles.chipTextSelected]}>{p}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Date of Birth</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="calendar-outline" size={18} color={Colors.textTertiary} style={styles.inputIcon} />
              <TextInput style={styles.inputInner} value={dob} onChangeText={t => setDob(formatDob(t))} placeholder="MM/DD/YYYY" placeholderTextColor={Colors.textTertiary} keyboardType="numeric" maxLength={10} />
            </View>
          </View>
        </ScrollView>
      </View>
      <SaveToast visible={showToast} message="Member saved!" />
      {showPaywall && (
        <Modal visible animationType="slide" onRequestClose={() => setShowPaywall(false)}>
          <Paywall
            canDismiss
            subtitle="Upgrade to add unlimited family members"
            onDismiss={() => setShowPaywall(false)}
          />
        </Modal>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  closeBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.text },
  saveBtn: { backgroundColor: Colors.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 6 },
  saveBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
  scroll: { paddingHorizontal: 20, paddingTop: 24, gap: 20 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.overdueMuted, borderRadius: 10, padding: 12 },
  errorText: { flex: 1, fontSize: 13, color: Colors.overdue, fontFamily: "Inter_400Regular" },
  section: { gap: 8 },
  sectionTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.textTertiary, textTransform: "uppercase", letterSpacing: 1.5 },
  typeRow: { flexDirection: "row", gap: 10 },
  typeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 14, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  typeBtnSelected: { backgroundColor: Colors.healthMuted, borderColor: Colors.health },
  typeBtnText: { fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  typeBtnTextSelected: { color: Colors.health },
  input: { backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.text },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  chipSelected: { backgroundColor: Colors.healthMuted, borderColor: Colors.health },
  chipMyself: { flexDirection: "row", alignItems: "center", gap: 5, borderStyle: "dashed" },
  chipMyselfSelected: { borderStyle: "solid" },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.textSecondary },
  chipTextSelected: { color: Colors.health },
  inputWrapper: { flexDirection: "row", alignItems: "center", backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 14, height: 52 },
  inputIcon: { marginRight: 10 },
  inputInner: { flex: 1, fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.text },
});
