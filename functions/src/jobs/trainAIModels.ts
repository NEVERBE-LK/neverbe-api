import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { updateHybridIntelligence } from "../services/HybridIntelligenceService";
import * as logger from "firebase-functions/logger";

export const trainAIModels = onSchedule({
  schedule: "every 60 minutes",
  memory: "4GiB",
  timeoutSeconds: 300
}, async (event) => {
  logger.info("[trainAIModels] Starting scheduled ML training job...");
  try {
    const result = await updateHybridIntelligence();
    logger.info("[trainAIModels] Success:", result.data.generatedAt);
  } catch (error) {
    logger.error("[trainAIModels] Fatal error in ML job:", error);
  }
});

/**
 * Manual trigger for ERP administrators
 */
export const triggerManualTraining = onCall({
  memory: "4GiB",
  timeoutSeconds: 300
}, async (request) => {
  // 1. Basic authentication check
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be an authenticated ERP administrator to trigger training.");
  }

  logger.info(`[triggerManualTraining] Manual job requested by ${request.auth.token.email}`);

  try {
    const result = await updateHybridIntelligence();
    return {
      success: true,
      message: "Neural training completed successfully.",
      generatedAt: result.data.generatedAt
    };
  } catch (error: any) {
    logger.error("[triggerManualTraining] Manual training failed:", error);
    throw new HttpsError("internal", error.message || "Failed to complete neural training.");
  }
});
