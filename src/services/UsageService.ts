import { adminFirestore } from "@/firebase/firebaseAdmin";
import { Timestamp } from "firebase-admin/firestore";

const COLLECTION_NAME = "ml_usage_logs";

/**
 * Log AI/ML usage for performance and cost monitoring
 */
export const logUsage = async (
  source: "TF" | "GEMINI" | "HYBRID",
  durationMs: number,
  metadata: Record<string, any> = {},
): Promise<void> => {
  try {
    const logBatch = adminFirestore.collection(COLLECTION_NAME).doc();
    await logBatch.set({
      source,
      durationMs,
      timestamp: Timestamp.now(),
      ...metadata,
    });
    console.log(`[UsageService] Logged ${source} usage: ${durationMs}ms`);
  } catch (error) {
    console.error(`[UsageService] Error for ${source} log:`, error);
  }
};
