import React from "react";
import { View, Text, Pressable, StyleSheet, Image } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "@/constants/colors";

export default function VerifyScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <View style={[styles.content, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 40 }]}>
        <Image
          source={require("@/assets/images/brand-logo.png")}
          style={{ width: 64, height: 64, alignSelf: "center", marginBottom: 24 }}
          resizeMode="contain"
        />

        <Text style={styles.title}>Check your email</Text>
        <Text style={styles.body}>
          We sent a verification link to your email. Click it to activate your account.
        </Text>

        <Pressable
          style={({ pressed }) => [styles.button, { opacity: pressed ? 0.85 : 1 }]}
          onPress={() => router.replace("/(auth)")}
        >
          <Text style={styles.buttonText}>Go to Sign In</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 20, justifyContent: "center", gap: 16 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", color: Colors.text },
  body: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.textSecondary, lineHeight: 22 },
  button: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    marginTop: 8,
  },
  buttonText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.textInverse },
});
