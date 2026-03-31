import * as admin from "firebase-admin";
import { getGenAI } from "./AIService";
import { generateSalesForecast } from "./TFService";
import {
  getDailySnapshot,
  getMonthlyComparison,
  getHistoricalSales,
  getNeuralRawContext,
  analyzeNeuralStockRisks,
  analyzeNeuralPromoStrategy,
  analyzeNeuralCustomerRetention
} from "./DataService";

const CACHE_COLLECTION = "dashboard_cache";
const CACHE_KEY = "neural_core_feed";
const SETTINGS_COLLECTION = "app_settings";
const SETTINGS_KEY = "neural_config";

export const updateNeuralCoreFeed = async (forceRefresh: boolean = false) => {
  const startTime = Date.now();
  
  try {
    // 0. Cache Guard (Soft Refresh Optimization)
    const cacheDoc = await admin.firestore().collection(CACHE_COLLECTION).doc(CACHE_KEY).get();
    const lastUpdate = cacheDoc.data()?.updatedAt?.toDate() || new Date(0);
    const minsSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60);

    if (!forceRefresh && minsSinceUpdate < 15 && cacheDoc.exists) {
      console.log("[NeuralCore] Soft Refresh: Returning recent analysis (within 15m window).");
      return { success: true, data: cacheDoc.data()?.data, cached: true };
    }

    console.log("[NeuralCore] Orchestrating global analysis (Force/Hard Refresh)...");

    // 1. Fetch Dynamic Neural Configuration
    const settingsDoc = await admin.firestore().collection(SETTINGS_COLLECTION).doc(SETTINGS_KEY).get();
    const config = settingsDoc.data() || {
      historicalRunway: 365,
      forecastWindow: 14,
      weightingMode: 'BALANCED'
    };

    // 1. Unified Raw Data Gathering (The Speed Optimization)
    const [historical, snapshot, comparison, ctx] = await Promise.all([
      getHistoricalSales(config.historicalRunway || 120),
      getDailySnapshot(),
      getMonthlyComparison(),
      getNeuralRawContext()
    ]);

    // 3. Neural Projection (Future)
    const tfResult = await generateSalesForecast(config.forecastWindow || 14, historical);

    // 4. Intelligence Modules (Context-Shared)
    const neuralRisks = analyzeNeuralStockRisks(ctx, config.forecastWindow || 14);
    const promoSuggestions = analyzeNeuralPromoStrategy(ctx);
    const customerRetention = analyzeNeuralCustomerRetention(ctx);
    
    // 5. Global Health Calculation (Refined Logic)
    const salesVelocity = comparison.percentageChange.revenue;
    const inventoryRisk = Math.max(0, 100 - (neuralRisks.length * 10)); // 10% penalty per critical risk
    const profitStability = comparison.currentMonth.profit > 0 ? 100 : 50;

    // Financial Resilience Score (Refined Linear Scaling)
    const dailyRev = (tfResult as any).success ? (tfResult as any).avgForecastedDaily : (comparison.currentMonth.revenue / 30);
    const projectedRevenue = dailyRev * (config.forecastWindow || 14);
    const projectedExpenses = ctx.finance.dailyExpenseVelocity * (config.forecastWindow || 14);
    const totalOutflow = ctx.finance.totalPayable + projectedExpenses;
    const totalInflow = ctx.finance.totalBalance + projectedRevenue;

    // Standard Resilience Score (If Inflow covers 1.5x Outflow, Score is 100)
    const financialResilience = Math.min(100, Math.round((totalInflow / (totalOutflow || 1)) * 66));
    
    // Applying Weighting Mode
    let wTrends = 0.4, wStock = 0.3, wProfit = 0.3;
    if (config.weightingMode === 'GROWTH') { wTrends = 0.6; wStock = 0.2; wProfit = 0.2; }
    else if (config.weightingMode === 'STABILITY') { wTrends = 0.2; wStock = 0.2; wProfit = 0.6; }
    else if (config.weightingMode === 'INVENTORY') { wTrends = 0.2; wStock = 0.6; wProfit = 0.2; }
    
    const healthScore = Math.round(
      ((salesVelocity > -5 ? 100 : 50) * wTrends) + 
      (inventoryRisk * wStock) +         
      (profitStability * wProfit)         
    );

    // 6. Autonomous Interventions
    const interventions: any[] = [];
    if (salesVelocity < -20) {
      interventions.push({ type: "REVENUE", priority: "CRITICAL", title: "Vigorous Revenue Drift", desc: "Sales momentum is trailing last month significantly." });
    }
    if (financialResilience < 40) {
      interventions.push({ type: "FINANCE", priority: "CRITICAL", title: "Liquidity Constraint", desc: `${Math.round(financialResilience)}% Resilience. Cashflow needs optimization.` });
    }
    if (neuralRisks.length > 0) {
      neuralRisks.forEach(risk => {
        const productDetail = ctx.productMap.get(risk.productId);
        interventions.push({
          type: "INVENTORY",
          priority: risk.riskLevel || "CRITICAL",
          title: `Neural Stock Out: ${risk.name}`,
          desc: risk.isOutOfStock 
            ? "Product is currently OUT OF STOCK." 
            : `Predicted depletion in ${risk.daysRemaining} days (AI Scaled Velocity).`,
          productId: risk.productId,
          sku: productDetail?.sku || "N/A",
          imageUrl: risk.imageUrl || null
        });
      });
    }
    if (customerRetention.length > 0) {
      customerRetention.filter(c => c.riskLevel === 'CRITICAL').forEach(c => {
         interventions.push({ type: "REVENUE", priority: "CRITICAL", title: `Churn Alert: ${c.name}`, desc: `Frequent high-spender has breached 90-day purchase gap.` });
      });
    }

    // 6. Strategic Briefing (Gemini Optimized @ 4h Cache)
    let briefing = "";
    
    const generateHeuristicBriefing = (hs: number, iv: any[]) => {
      if (hs >= 90 && iv.length === 0) return "Systems optimal. Catalog velocity and liquidity metrics are in a growth quadrant.";
      if (hs >= 80 && iv.every(i => i.priority !== 'CRITICAL')) return "Stability high. System is absorbing minor demand drifts effectively.";
      return null;
    };

    const heuristic = generateHeuristicBriefing(healthScore, interventions);
    if (heuristic) {
      briefing = heuristic;
    } else {
      const cacheDoc = await admin.firestore().collection(CACHE_COLLECTION).doc(CACHE_KEY).get();
      const cachedBriefing = cacheDoc.data()?.data?.briefing;
      const lastLLMTime = cacheDoc.data()?.lastLLMUpdateTime?.toDate() || new Date(0);
      const hoursSinceLLM = (Date.now() - lastLLMTime.getTime()) / (1000 * 60 * 60);

      if (hoursSinceLLM < 4 && cachedBriefing) {
        briefing = cachedBriefing;
      } else {
        try {
          const model = getGenAI().getGenerativeModel({ model: "gemini-2.0-flash", systemInstruction: "Provide a 2-sentence summary." });
          const prompt = `Health ${healthScore}, Sales Drift ${salesVelocity}%, Risks ${neuralRisks.length}. Resilience ${financialResilience}%`;
          const result = await model.generateContent(prompt);
          briefing = result.response.text();
          await admin.firestore().collection(CACHE_COLLECTION).doc(CACHE_KEY).update({ lastLLMUpdateTime: admin.firestore.FieldValue.serverTimestamp() });
        } catch {
          briefing = "Neural optimization in progress.";
        }
      }
    }

    const finalFeed = {
      healthScore,
      financialResilience,
      briefing,
      interventions,
      reality: {
        snapshot,
        comparison,
        popular: [], // Placeholder for backward compatibility
        neuralRisks,
        finance: ctx.finance,
        promoSuggestions,
        customerRetention,
        orderStats: ctx.orderStats
      },
      projections: tfResult,
      generatedAt: new Date().toISOString()
    };

    const expiryDate = new Date();
    expiryDate.setHours(expiryDate.getHours() + 24);
    const expiryTimestamp = admin.firestore.Timestamp.fromDate(expiryDate);

    await admin.firestore().collection(CACHE_COLLECTION).doc(CACHE_KEY).set({
      data: finalFeed,
      expiry: expiryTimestamp,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // 7. System-Wide Unified Push (The Pervasive Pulse)
    const publishNeuralNotifications = async (items: any[]) => {
      const lastNotify = cacheDoc.data()?.lastSystemNotificationAt?.toDate() || new Date(0);
      const hoursSinceLast = (Date.now() - lastNotify.getTime()) / (1000 * 60 * 60);

      // Only notify if it's been 12h or if we have critical new items
      if (hoursSinceLast >= 12 && items.length > 0) {
        const batch = admin.firestore().batch();
        const notifyCol = admin.firestore().collection("erp_notifications");
        
        // Take top 3 critical interventions to avoid flooding
        items.filter(i => i.priority === 'CRITICAL').slice(0, 3).forEach(item => {
          const docRef = notifyCol.doc(`NEURAL_${item.type}_${Date.now()}`);
          batch.set(docRef, {
            type: "AI",
            title: `Neural Core: ${item.title}`,
            message: item.desc,
            read: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            metadata: { ...item, source: 'NEURAL_CORE_PERVASIVE' }
          });
        });

        await batch.commit();
        await admin.firestore().collection(CACHE_COLLECTION).doc(CACHE_KEY).update({
          lastSystemNotificationAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`[NeuralCore] System-wide push notifications dispatched.`);
      }
    };

    await publishNeuralNotifications(interventions);

    console.log(`[NeuralCore] Synchronization stable in ${Date.now() - startTime}ms`);
    return { success: true, data: finalFeed };

  } catch (error) {
    console.error("[NeuralCore] Orchestration failed:", error);
    throw error;
  }
};
