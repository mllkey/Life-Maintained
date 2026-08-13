import * as Crypto from "expo-crypto";

// SHA-256 of the EXACT bytes uploaded to storage — hash the same
// ArrayBuffer handed to .upload(), never a re-read or re-encode.
export async function sha256OfBytes(bytes: ArrayBuffer): Promise<string | null> {
  try {
    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null; // capture must never block a save
  }
}
