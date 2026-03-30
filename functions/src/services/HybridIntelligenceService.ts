import * as admin from "firebase-admin";
import { getGenAI } from "./AIService";
import { generateSalesForecast } from "./TFService";
import {
  getDailySnapshot,
  getMonthlyComparison,
  getHistoricalSales,
  getNeuralRawContext,
  analyzeNeuralStockRisks
} from "./DataService";
import dayjs from "dayjs";

const CACHE_COLLECTION = "dashboard_cache";
const CACHE_KEY = "hybrid_intelligence_full";

export const updateHybridIntelligence = async () => {
  const startTime = Date.now();
  console.log("[HybridIntelligenceJob] Starting neural training and analysis (Optimized)...");
  try {
    // 1. Unified Data Gathering
    const [historical, snapshot, comparison, ctx] = await Promise.all([
      getHistoricalSales(),
      getDailySnapshot(),
      getMonthlyComparison(),
      getNeuralRawContext()
    ]);

    const tfResult = await generateSalesForecast(14, historical);
    const lowStockRisks = analyzeNeuralStockRisks(ctx, 14);

    // 2. Gemini Optimization: Reuse previous advisory if it's less than 24 hours old
    let strategicAdvisory = "";
    let isAdvisoryFromCache = false;

    try {
      const prevDoc = await admin.firestore()
        .collection(CACHE_COLLECTION)
        .doc(CACHE_KEY)
        .get();

      if (prevDoc.exists) {
        const prevData = prevDoc.data();
        if (prevData && prevData.updatedAt) {
          const updatedAt = prevData.updatedAt.toDate();
          const now = new Date();

          if (now.getTime() - updatedAt.getTime() < 24 * 60 * 60 * 1000) {
            strategicAdvisory = prevData.data.advisory;
            isAdvisoryFromCache = true;
          }
        }
      }
    } catch (cacheErr) {
      console.warn("[HybridIntelligenceJob] Failed to read previous cache.", cacheErr);
    }

    if (!strategicAdvisory && tfResult.success) {
      console.log("[HybridIntelligenceJob] Calling Gemini for new strategic insights...");
      const model = getGenAI().getGenerativeModel({
        model: "gemini-2.0-flash",
        systemInstruction: "Senior AI Business Consultant analyze Neural Network's numerical forecast and provide strategic advisory."
      });

      const prompt = `DATA: Revenue ${snapshot.totalNetSales}, Change ${comparison.percentageChange.revenue}%, Risks ${lowStockRisks.length}. Trend ${tfResult.success ? 'Projected GROWTH' : 'STABLE'}`;
      const result = await model.generateContent(prompt);
      strategicAdvisory = result.response.text();
    }

    const finalResult = {
      success: true,
      data: {
        forecast: tfResult,
        advisory: strategicAdvisory || "Neural models are analyzing your trajectory.",
        generatedAt: new Date().toISOString(),
        isAdvisoryFromCache
      }
    };

    await admin.firestore()
      .collection(CACHE_COLLECTION)
      .doc(CACHE_KEY)
      .set({
        data: finalResult.data,
        expiry: admin.firestore.Timestamp.fromDate(dayjs().add(24, 'hours').toDate()),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

    console.log(`[HybridIntelligenceJob] Completed in ${Date.now() - startTime}ms`);

    // 3. Automated Low Stock Notifications
    if (lowStockRisks.length > 0) {
      try {
        const cacheDoc = await admin.firestore().collection(CACHE_COLLECTION).doc(CACHE_KEY).get();
        const cacheData = cacheDoc.data();
        const lastTime = cacheData?.lastLowStockAlertTime?.toDate() || new Date(0);
        const hoursSinceLast = (Date.now() - lastTime.getTime()) / (1000 * 60 * 60);

        if (hoursSinceLast >= 12) {
          const itemNames = lowStockRisks.slice(0, 3).map((i: any) => i.name).join(", ");
          const docId = `STOCK_HYBRID_${Date.now()}`;
          const notification = {
            type: "AI_STOCK",
            title: "Neural Core: Stock Alerts",
            message: `Neural analysis identifies ${lowStockRisks.length} items at risk: ${itemNames}...`,
            read: false,
            createdAt: new Date(),
            metadata: { priority: "HIGH" }
          };
          
          await admin.firestore().collection("erp_notifications").doc(docId).set(notification);
          await admin.firestore().collection(CACHE_COLLECTION).doc(CACHE_KEY).update({
            lastLowStockAlertTime: admin.firestore.FieldValue.serverTimestamp()
          });
          
          console.log(`[HybridIntelligenceJob] Sent low stock alert for ${lowStockRisks.length} items.`);
        }
      } catch (notifyErr) {
        console.error("[HybridIntelligenceJob] Notification failed", notifyErr);
      }
    }

    return finalResult;
  } catch (error) {
    console.error("[HybridIntelligenceJob] Fatal Error:", error);
    throw error;
  }
};
