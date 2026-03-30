import * as admin from "firebase-admin";
import { getGenAI } from "./AIService";
import { generateSalesForecast } from "./TFService";
import {
  getDailySnapshot,
  getMonthlyComparison,
  getLowStockRisks,
  getPopularItems,
  getHistoricalSales,
  getNeuralStockRisks
} from "./DataService";

const CACHE_COLLECTION = "dashboard_cache";
const CACHE_KEY = "neural_core_feed";
const SETTINGS_COLLECTION = "app_settings";
const SETTINGS_KEY = "neural_config";

export const updateNeuralCoreFeed = async () => {
  const startTime = Date.now();
  console.log("[NeuralCore] Orchestrating global analysis...");

  try {
    // 0. Fetch Dynamic Neural Configuration
    const settingsDoc = await admin.firestore().collection(SETTINGS_COLLECTION).doc(SETTINGS_KEY).get();
    const config = settingsDoc.data() || {
      historicalRunway: 120,
      forecastWindow: 14,
      weightingMode: 'BALANCED'
    };

    // 1. Data Aggregation (Reality & Neural Risks)
    const [historical, snapshot, comparison, lowStock, popular, neuralRisks] = await Promise.all([
      getHistoricalSales(config.historicalRunway || 120),
      getDailySnapshot(),
      getMonthlyComparison(),
      getLowStockRisks(15),
      getPopularItems(10),
      getNeuralStockRisks(config.forecastWindow || 14)
    ]);

    // 2. Neural Projection (Future)
    const tfResult = await generateSalesForecast(config.forecastWindow || 14, historical);
    
    // 3. Global Health Calculation (Weighted Scoping)
    const salesVelocity = comparison.percentageChange.revenue;
    const inventoryRisk = lowStock.length > 5 ? Math.max(0, 100 - (lowStock.length * 5)) : 100;
    const profitStability = comparison.currentMonth.profit > 0 ? 100 : 50;
    
    // Applying Weighting Mode
    let wTrends = 0.4, wStock = 0.3, wProfit = 0.3;
    
    if (config.weightingMode === 'GROWTH') {
      wTrends = 0.6; wStock = 0.2; wProfit = 0.2;
    } else if (config.weightingMode === 'STABILITY') {
      wTrends = 0.2; wStock = 0.2; wProfit = 0.6;
    } else if (config.weightingMode === 'INVENTORY') {
      wTrends = 0.2; wStock = 0.6; wProfit = 0.2;
    }
    
    const healthScore = Math.round(
      ((salesVelocity > 0 ? 100 : 50) * wTrends) + 
      (inventoryRisk * wStock) +         
      (profitStability * wProfit)         
    );

    // 4. Autonomous Interventions (ML Decision Logic)
    const interventions: any[] = [];
    
    // Revenue Anomaly check
    if (salesVelocity < -20) {
      interventions.push({
        type: "REVENUE",
        priority: "CRITICAL",
        title: "Vigorous Revenue Drift",
        desc: `Sales are down ${Math.abs(salesVelocity)}% vs last month. Immediate promotion advised.`
      });
    }

    // Ghost Stockout Detection
    if (neuralRisks.length > 0) {
      neuralRisks.forEach(risk => {
        interventions.push({
          type: "INVENTORY",
          priority: risk.riskLevel,
          title: `Neural Stock Out: ${risk.name}`,
          desc: `Current stock (${risk.currentStock}) won't survive the ${config.forecastWindow}-day demand spike (${risk.projectedDemand} units needed).`
        });
      });
    }

    // 5. Automated Proactive Notifications (Anti-Spam Logic Enabled)
    const criticalInterventions = interventions.filter(i => i.priority === "CRITICAL");
    if (criticalInterventions.length > 0) {
      try {
        const cacheDoc = await admin.firestore().collection(CACHE_COLLECTION).doc(CACHE_KEY).get();
        const cacheData = cacheDoc.data();
        const lastAlertTime = cacheData?.lastCriticalAlertTime?.toDate() || new Date(0);
        const hoursSinceLast = (Date.now() - lastAlertTime.getTime()) / (1000 * 60 * 60);

        if (hoursSinceLast >= 6) {
          for (const alert of criticalInterventions) {
            const docId = `AI_${alert.type}_${Date.now()}`;
            await admin.firestore().collection("erp_notifications").doc(docId).set({
              type: "AI_INSIGHT",
              title: `Neural Core: ${alert.title}`,
              message: alert.desc,
              read: false,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              metadata: { 
                 priority: "CRITICAL",
                 category: alert.type
              }
            });
          }

          await admin.firestore().collection(CACHE_COLLECTION).doc(CACHE_KEY).update({
            lastCriticalAlertTime: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      } catch (notifyErr) {
        console.error("[NeuralCore] Proactive alert dispatch failed", notifyErr);
      }
    }

    // 6. Strategic Briefing (LLM Layer)
    let briefing = "";
    if (tfResult.success) {
      const model = getGenAI().getGenerativeModel({
        model: "gemini-2.0-flash",
        systemInstruction: "You are the Neural Core of an advanced ERP system. Provide a 2-sentence 'Morning Briefing' for the CEO based on the current data."
      });

      const prompt = `
        DATA:
        - Health Score: ${healthScore}/100
        - Today: Rs. ${snapshot.totalNetSales}
        - Forecast: ${salesVelocity >= 0 ? 'GROWTH' : 'CONTRACTION'} phase.
        - Low Stock: ${lowStock.length} alerts.
        - Ghost Stockouts: ${neuralRisks.length} at risk.
        
        Provide a ultra-concise, professional status update.
      `;

      const result = await model.generateContent(prompt);
      briefing = result.response.text();
    }

    const finalFeed = {
      healthScore,
      briefing: briefing || "Neural optimization in progress.",
      interventions,
      reality: {
        snapshot,
        comparison,
        lowStock,
        popular,
        neuralRisks
      },
      projections: tfResult,
      generatedAt: new Date().toISOString()
    };

    // Update Cache
    await admin.firestore()
      .collection(CACHE_COLLECTION)
      .doc(CACHE_KEY)
      .set({
        data: finalFeed,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

    console.log(`[NeuralCore] Synchronization stable in ${Date.now() - startTime}ms`);
    return { success: true, data: finalFeed };

  } catch (error) {
    console.error("[NeuralCore] Orchestration failed:", error);
    throw error;
  }
};
