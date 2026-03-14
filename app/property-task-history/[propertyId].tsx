import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  Modal,
  Image,
  Dimensions,
  Platform,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import * as Haptics from "expo-haptics";
import { parseISO, format } from "date-fns";

const { width: SW, height: SH } = Dimensions.get("window");

export default function PropertyTaskHistoryScreen() {
  const { propertyId } = useLocalSearchParams<{ propertyId: string }>();
  const { task } = useLocalSearchParams<{ task: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const webTopPad = Platform.OS === "web" ? 67 : 0;

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [receiptGeneratingId, setReceiptGeneratingId] = useState<string | null>(null);

  const { data: logs, isLoading } = useQuery({
    queryKey: ["property_task_logs", propertyId, task],
    queryFn: async () => {
      const { data } = await supabase
        .from("maintenance_logs")
        .select("*")
        .eq("property_id", propertyId!)
        .eq("service_name", task!)
        .order("service_date", { ascending: false });
      return data ?? [];
    },
    enabled: !!(propertyId && task),
  });

  function handleDelete(logId: string) {
    Alert.alert(
      "Delete Record",
      "This service record will be permanently deleted.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              await supabase.from("maintenance_logs").delete().eq("id", logId);
              queryClient.invalidateQueries({ queryKey: ["property_task_logs", propertyId, task] });
              queryClient.invalidateQueries({ queryKey: ["property_logs", propertyId] });
            } catch (err: any) {
              Alert.alert("Delete Failed", err?.message ?? "Something went wrong. Please try again.");
            }
          },
        },
      ]
    );
  }

  async function openReceipt(storagePath: string, logId: string) {
    Haptics.selectionAsync();
    setReceiptGeneratingId(logId);
    try {
      const { data, error } = await supabase.storage
        .from("receipts")
        .createSignedUrl(storagePath, 3600);
      if (error || !data?.signedUrl) throw error ?? new Error("No signed URL");
      setReceiptUrl(data.signedUrl);
    } catch {
      Alert.alert("Error", "Could not load receipt image. Please try again.");
    } finally {
      setReceiptGeneratingId(null);
    }
  }

  const totalSpent = logs?.reduce((s, l) => s + (l.cost ?? 0), 0) ?? 0;
  const visitCount = logs?.length ?? 0;
  const taskName = task ?? "Service History";

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + webTopPad + 16 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={2}>{taskName}</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator color={Colors.accent} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 40 }]}
        >
          {visitCount === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No service history yet</Text>
            </View>
          ) : (
            <>
              <View style={styles.summaryBar}>
                <View style={styles.summaryStat}>
                  <Text style={styles.summaryValue}>
                    ${totalSpent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </Text>
                  <Text style={styles.summaryLabel}>total spent</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryStat}>
                  <Text style={styles.summaryValue}>{visitCount}</Text>
                  <Text style={styles.summaryLabel}>{visitCount === 1 ? "service visit" : "service visits"}</Text>
                </View>
              </View>

              <View style={styles.logList}>
                {logs!.map((log, idx) => {
                  const isExpanded = expandedId === log.id;
                  const isLast = idx === logs!.length - 1;
                  const formattedDate = log.service_date
                    ? format(parseISO(log.service_date), "MMMM d, yyyy")
                    : null;
                  const isGenerating = receiptGeneratingId === log.id;

                  return (
                    <View key={log.id} style={[styles.logCard, isLast && styles.logCardLast]}>
                      <Pressable
                        style={({ pressed }) => [styles.logCardMain, { opacity: pressed ? 0.85 : 1 }]}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setExpandedId(isExpanded ? null : log.id);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`${formattedDate ?? "Service"}, ${log.cost != null ? "$" + log.cost.toFixed(2) : ""}`}
                      >
                        <View style={styles.verticalBar} />
                        <View style={styles.logCardLeft}>
                          <Text style={styles.logTitle}>{log.service_name ?? taskName}</Text>
                          <Text style={styles.logSubtitle} numberOfLines={1}>
                            {[formattedDate, log.cost != null ? `$${log.cost.toFixed(2)}` : null, log.provider_name].filter(Boolean).join(" · ")}
                          </Text>
                        </View>
                        <View style={styles.logCardRight}>
                          {log.receipt_url ? (
                            <Pressable
                              onPress={() => openReceipt(log.receipt_url, log.id)}
                              hitSlop={10}
                              accessibilityLabel="View receipt"
                              style={styles.receiptIconBtn}
                            >
                              {isGenerating
                                ? <ActivityIndicator size="small" color={Colors.accent} />
                                : <Ionicons name="receipt-outline" size={18} color={Colors.accent} />
                              }
                            </Pressable>
                          ) : null}
                          <Ionicons
                            name={isExpanded ? "chevron-up" : "chevron-down"}
                            size={16}
                            color={Colors.textTertiary}
                          />
                        </View>
                      </Pressable>

                      {isExpanded && (
                        <View style={styles.expandedSection}>
                          {log.provider_contact ? (
                            <View style={styles.expandedRow}>
                              <Ionicons name="call-outline" size={14} color={Colors.textSecondary} />
                              <Text style={styles.expandedText}>{log.provider_contact}</Text>
                            </View>
                          ) : null}

                          {log.notes ? (
                            <View style={styles.expandedRow}>
                              <Ionicons name="document-text-outline" size={14} color={Colors.textSecondary} />
                              <Text style={styles.expandedNotes}>{log.notes}</Text>
                            </View>
                          ) : null}

                          {log.receipt_url ? (
                            <Pressable
                              style={({ pressed }) => [styles.receiptThumb, { opacity: pressed ? 0.85 : 1 }]}
                              onPress={() => openReceipt(log.receipt_url, log.id)}
                              accessibilityLabel="View receipt image"
                            >
                              <View style={styles.receiptThumbInner}>
                                {isGenerating ? (
                                  <ActivityIndicator color={Colors.accent} />
                                ) : (
                                  <>
                                    <Ionicons name="receipt-outline" size={28} color={Colors.accent} />
                                    <Text style={styles.receiptThumbLabel}>Tap to view receipt</Text>
                                  </>
                                )}
                              </View>
                            </Pressable>
                          ) : null}

                          {!log.provider_contact && !log.notes && !log.receipt_url && (
                            <Text style={styles.expandedEmpty}>No additional details recorded.</Text>
                          )}

                          <View style={styles.expandedActions}>
                            <Pressable
                              style={({ pressed }) => [styles.deleteBtn, { opacity: pressed ? 0.7 : 1 }]}
                              onPress={() => handleDelete(log.id)}
                            >
                              <Ionicons name="trash-outline" size={13} color={Colors.overdue} />
                              <Text style={styles.deleteBtnText}>Delete</Text>
                            </Pressable>
                          </View>
                        </View>
                      )}

                      {!isLast && <View style={styles.logDivider} />}
                    </View>
                  );
                })}
              </View>
            </>
          )}
        </ScrollView>
      )}

      <Modal
        visible={!!receiptUrl}
        transparent
        animationType="fade"
        onRequestClose={() => setReceiptUrl(null)}
        statusBarTranslucent
      >
        <View style={styles.receiptModal}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.receiptScrollContent}
            maximumZoomScale={4}
            minimumZoomScale={1}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            centerContent
          >
            {receiptUrl && (
              <Image
                source={{ uri: receiptUrl }}
                style={{ width: SW, height: SH * 0.82 }}
                resizeMode="contain"
              />
            )}
          </ScrollView>
          <Pressable
            style={[styles.receiptCloseBtn, { top: insets.top + 12 }]}
            onPress={() => setReceiptUrl(null)}
            hitSlop={12}
          >
            <View style={styles.receiptCloseBtnInner}>
              <Ionicons name="close" size={20} color="#fff" />
            </View>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 8,
  },
  backBtn: { width: 40, height: 44, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  headerTitle: {
    flex: 1,
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: Colors.text,
  },

  scroll: { paddingHorizontal: 20, paddingTop: 16, gap: 16 },

  emptyState: { alignItems: "center", paddingTop: 80 },
  emptyText: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.textSecondary, textAlign: "center" },

  summaryBar: {
    flexDirection: "row",
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    alignItems: "center",
    justifyContent: "space-around",
  },
  summaryStat: { alignItems: "center", gap: 3 },
  summaryValue: { fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.text },
  summaryLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  summaryDivider: { width: 1, height: 36, backgroundColor: Colors.border },

  logList: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  logCard: { backgroundColor: Colors.card },
  logCardLast: {},
  logCardMain: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 64,
    gap: 12,
  },
  verticalBar: { width: 4, height: 28, borderRadius: 2, backgroundColor: Colors.accent, flexShrink: 0 },
  logCardLeft: { flex: 1, gap: 3 },
  logTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.text },
  logSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  logCardRight: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 },
  receiptIconBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  logDivider: { height: 1, backgroundColor: Colors.borderSubtle, marginHorizontal: 16 },

  expandedSection: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    paddingTop: 4,
    gap: 10,
  },
  expandedRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  expandedText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, flex: 1 },
  expandedNotes: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, flex: 1, lineHeight: 20, fontStyle: "italic" },
  expandedEmpty: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textTertiary, fontStyle: "italic" },

  receiptThumb: {
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: Colors.accentMuted,
    borderWidth: 1,
    borderColor: Colors.accent + "33",
  },
  receiptThumbInner: {
    height: 80,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 16,
  },
  receiptThumbLabel: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.accent,
  },

  expandedActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    paddingTop: 4,
  },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9,
    backgroundColor: Colors.overdueMuted,
    minHeight: 44,
    justifyContent: "center",
  },
  deleteBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.overdue },

  receiptModal: { flex: 1, backgroundColor: "rgba(0,0,0,0.96)" },
  receiptScrollContent: { flex: 1, alignItems: "center", justifyContent: "center" },
  receiptCloseBtn: { position: "absolute", right: 16 },
  receiptCloseBtnInner: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
});
