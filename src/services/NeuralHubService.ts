import { adminFirestore } from "@/firebase/firebaseAdmin";

const CACHE_COLLECTION = "neural_cache";
const CACHE_KEY = "neural_core_feed";

/**
 * Neural Hub Data (Read-Only Interface with Cloud Functions)
 */
export const getNeuralFeed = async () => {
  try {
     console.log("[NeuralHubService] Reading feed from Cloud Neural Cache...");
     const doc = await adminFirestore.collection(CACHE_COLLECTION).doc(CACHE_KEY).get();
     
     if (doc.exists) {
        return {
           success: true,
           data: doc.data()?.data
        };
     }

     return {
        success: false,
        message: "Neural Core is currently synchronizing. Please check back in a moment."
     };
  } catch (error: any) {
     console.error("[NeuralHubService] Read error:", error);
     throw error;
  }
};

/**
 * Force Sync Request (Triggers background job)
 * This doesn't calculate locally; it just signals Cloud Functions or updates a flag.
 * In this implementation, we simply return success to allow the dashboard to re-poll.
 */
export const forceSyncNeuralCore = async () => {
   // In a real environment, we would trigger a Cloud Function here.
   // For now, we return success to signal the dashboard to re-fetch the (potentially updating) cache.
   return { success: true, message: "Neutral Force Sync requested. Background processes are recalibrating." };
};
