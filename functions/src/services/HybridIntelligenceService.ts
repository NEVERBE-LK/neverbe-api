import * as admin from "firebase-admin";
import { getGenAI } from "./AIService";
import { generateSalesForecast } from "./TFService";
import {
  getDailySnapshot,
  getMonthlyComparison,
  getLowStockRisks,
  getPopularItems,
  getHistoricalSales
} from "./DataService";
import dayjs from "dayjs";

const CACHE_COLLECTION = "dashboard_cache";
const CACHE_KEY = "hybrid_intelligence_full";

export const updateHybridIntelligence = async () => {
  const startTime = Date.now();
  console.log("[HybridIntelligenceJob] Starting neural training and analysis...");
  try {
    // 1. All Data: Fetch entire historical window for deeper neural context
    const historical = await getHistoricalSales();
    const tfResult = await generateSalesForecast(14, historical);

    const [snapshot, comparison, lowStock, popular] = await Promise.all([
      getDailySnapshot(),
      getMonthlyComparison(),
      getLowStockRisks(10),
      getPopularItems(5)
    ]);

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

          // If the advisory was generated in the last 24 hours, reuse it
          if (now.getTime() - updatedAt.getTime() < 24 * 60 * 60 * 1000) {
            strategicAdvisory = prevData.data.advisory;
            isAdvisoryFromCache = true;
            console.log("[HybridIntelligenceJob] Reusing cached Gemini advisory (within 24h window).");
          }
        }
      }
    } catch (cacheErr) {
      console.warn("[HybridIntelligenceJob] Failed to read previous cache, will call Gemini.", cacheErr);
    }

    if (!strategicAdvisory && tfResult.success) {
      console.log("[HybridIntelligenceJob] Calling Gemini for new strategic insights...");
      const model = getGenAI().getGenerativeModel({
        model: "gemini-2.0-flash",
        systemInstruction: "You are a Senior AI Business Consultant for an ERP system. Your task is to analyze a Neural Network's numerical forecast and provide strategic advisory."
      });

      const prompt = `
        HISTORICAL & NEURAL FORECAST DATA:
        ${JSON.stringify((tfResult as any).predictions.filter((p: any) => p.isForecast), null, 2)}

        CURRENT BUSINESS CONTEXT:
        - Today's Revenue: Rs. ${snapshot.totalNetSales}
        - Monthly Revenue Change: ${comparison.percentageChange.revenue}%
        - Low Stock Alerts: ${lowStock.length} items at risk.
        - Top Sellers: ${popular.map(i => i.name).join(", ")}

        TASK:
        Provide a concise (3-4 sentences) strategic advisory. 
        1. Explain the "Why" behind the neural forecast (e.g., trend patterns).
        2. Give one specific actionable advice (e.g., restock, promotion).
        3. Mention the predicted trend for the next 7 days.
        4. Do NOT use generic pleasantries. Be professional and data-driven.
      `;

      const result = await model.generateContent(prompt);
      strategicAdvisory = result.response.text();
    }

    const finalResult = {
      success: true,
      data: {
        forecast: tfResult,
        advisory: strategicAdvisory || "Neural models are currently analyzing your trajectory.",
        generatedAt: new Date().toISOString(),
        isAdvisoryFromCache
      }
    };

    // Update Firestore Cache directly
    await admin.firestore()
      .collection(CACHE_COLLECTION)
      .doc(CACHE_KEY)
      .set({
        data: finalResult.data,
        expiry: admin.firestore.Timestamp.fromDate(dayjs().add(24, 'hours').toDate()),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

    console.log(`[HybridIntelligenceJob] Completed in ${Date.now() - startTime}ms`);

    // 3. Automated Low Stock Notifications
    if (lowStock.length > 0) {
      try {
        const docId = `STOCK_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        const notification = {
          type: "STOCK",
          title: "Low Stock Alert",
          message: `${lowStock.length} items are currently below the critical threshold. Review inventory immediately.`,
          metadata: { itemCount: lowStock.length },
          read: false,
          createdAt: new Date()
        };
        await admin.firestore().collection("erp_notifications").doc(docId).set(notification);

        // Send Push
        const { getMessaging } = await import("firebase-admin/messaging");
        await getMessaging().send({
          topic: "admin_alerts",
          notification: {
            title: notification.title,
            body: notification.message
          },
          webpush: { fcmOptions: { link: "/inventory" } }
        });
      } catch (notifyErr) {
        console.error("[HybridIntelligenceJob] Failed to send low stock notification", notifyErr);
      }
    }

    return finalResult;

  } catch (error) {
    console.error("[HybridIntelligenceJob] Fatal Error:", error);
    throw error;
  }
};
