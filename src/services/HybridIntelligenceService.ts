import { getCache } from "./CacheService";

export const getHybridIntelligence = async () => {
  // Now strictly cache-only for the dashboard (Background jobs handle calculation)
  try {
    const cachedData = await getCache("hybrid_intelligence_full");
    if (cachedData) {
      return {
        success: true,
        data: cachedData.data
      };
    }

    return {
      success: false,
      message: "Neural models are currently analyzing your trajectory. Results will appear within the hour."
    };
  } catch (error) {
    console.error("[HybridIntelligence] Fetch error:", error);
    throw error;
  }
};
