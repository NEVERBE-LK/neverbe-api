import * as admin from "firebase-admin";
import { getGenAI, getProModel } from "./AIService";
import { generateSalesForecast } from "./TFService";
import {
  getDailySnapshot,
  getMonthlyComparison,
  getHistoricalSales,
  getNeuralRawContext,
  analyzeNeuralStockRisks,
  analyzeNeuralPromoStrategy,
  analyzeNeuralCustomerRetention,
  getCurrentMonthActualSales,
  getMonthDaysInfo
} from "./DataService";

const FORECAST_SNAPSHOTS = "forecast_snapshots";

const CACHE_COLLECTION = "neural_cache";
const CACHE_KEY = "neural_core_feed";
const SETTINGS_COLLECTION = "app_settings";
const SETTINGS_KEY = "neural_config";

/** 
 * Local helper to create persistent Admin Notifications 
 * with idempotency based on message hash.
 */
async function createAdminNotification(type: string, title: string, message: string, metadata: any = {}) {
    try {
        const db = admin.firestore();
        // Simple hash check - avoid sending identical message within 24h
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        
        const existing = await db.collection("erp_notifications")
            .where("title", "==", title)
            .where("createdAt", ">", yesterday)
            .limit(1)
            .get();
            
        if (!existing.empty) return; // Skip duplicate within rolling 24h window

        await db.collection("erp_notifications").add({
            type, title, message, metadata,
            read: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (err) {
        console.error("Failed to create neural notification", err);
    }
}

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
      historicalRunway: 1095, // 3 Years (365 * 3)
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

    // 3. Neural Projection (Future) — TF.js ML Engine (no API dependency)
    const tfResult = await generateSalesForecast(config.forecastWindow || 14, historical);

    // 3a. Persist Forecast Snapshot for Real vs ML comparison
    const today = new Date().toISOString().split('T')[0];
    const forecastOnly = (tfResult as any).success 
      ? (tfResult as any).predictions?.filter((p: any) => p.isForecast).map((p: any) => ({
          date: p.date,
          predictedNetSales: Math.round(p.netSales)
        }))
      : [];
    
    if (forecastOnly.length > 0) {
      await admin.firestore()
        .collection(CACHE_COLLECTION).doc(CACHE_KEY)
        .collection(FORECAST_SNAPSHOTS).doc(today)
        .set({
          generatedAt: new Date().toISOString(),
          forecastWindow: config.forecastWindow || 14,
          predictions: forecastOnly
        });
      console.log(`[NeuralCore] Forecast snapshot persisted for ${today} (${forecastOnly.length} days).`);
    }

    // 3c. Load Past Forecast Snapshots for Real vs AI Overlay
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const pastSnapshots = await admin.firestore()
      .collection(CACHE_COLLECTION).doc(CACHE_KEY)
      .collection(FORECAST_SNAPSHOTS)
      .where("generatedAt", ">=", thirtyDaysAgo.toISOString())
      .orderBy("generatedAt", "desc")
      .limit(30)
      .get();
    
    // Build "what AI predicted for dates that are now in the past"
    const pastPredictionMap: Record<string, number> = {};
    pastSnapshots.docs.forEach(doc => {
      const snap = doc.data();
      (snap.predictions || []).forEach((p: any) => {
        // Only include predictions for dates that are now in the past (before today)
        if (p.date < today && !pastPredictionMap[p.date]) {
          pastPredictionMap[p.date] = p.predictedNetSales;
        }
      });
    });

    // 3d. Monthly Sales Target
    const [monthlyActual, monthInfo] = await Promise.all([
      getCurrentMonthActualSales(),
      Promise.resolve(getMonthDaysInfo())
    ]);
    
    // Calculate monthly forecast: actual so far + AI forecast for remaining days
    const avgForecastDaily = (tfResult as any).success ? (tfResult as any).avgForecastedDaily : 0;
    const mlMonthlyPrediction = avgForecastDaily * monthInfo.totalDays;
    const monthlyForecastTarget = monthlyActual + (avgForecastDaily * monthInfo.remainingDays);

    // Compute forecast accuracy from past predictions vs actual
    let forecastAccuracy = 0;
    let accuracyDataPoints = 0;
    const historicalMap: Record<string, number> = {};
    historical.forEach(h => { historicalMap[h.date] = h.netSales; });
    
    Object.entries(pastPredictionMap).forEach(([date, predicted]) => {
      const actual = historicalMap[date];
      if (actual !== undefined && predicted > 0) {
        const error = Math.abs(actual - predicted) / Math.max(predicted, 1);
        forecastAccuracy += (1 - Math.min(error, 1));
        accuracyDataPoints++;
      }
    });
    forecastAccuracy = accuracyDataPoints > 0 
      ? Math.round((forecastAccuracy / accuracyDataPoints) * 1000) / 10 
      : 0; // 0 means no data yet

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
      for (const risk of neuralRisks) {
        const productDetail = ctx.productMap.get(risk.productId);
        const invTitle = `Neural Stock Out: ${risk.name}`;
        const invDesc = risk.isOutOfStock 
            ? "Product is currently OUT OF STOCK." 
            : `Predicted depletion in ${risk.daysRemaining} days (AI Scaled Velocity).`;

        interventions.push({
          type: "INVENTORY",
          priority: risk.riskLevel || "CRITICAL",
          title: invTitle,
          desc: invDesc,
          productId: risk.productId,
          sku: productDetail?.sku || risk.productId || "N/A",
          imageUrl: risk.imageUrl || null
        });

        // Trigger persistent notification for critical risks
        if (risk.riskLevel === 'CRITICAL') {
           await createAdminNotification("AI", invTitle, invDesc, {
              productId: risk.productId,
              sku: productDetail?.sku || "N/A",
              daysRemaining: risk.daysRemaining,
              revenueRisk: (risk.velocity * 30 * (productDetail?.wholesalePrice || 0)).toFixed(0),
              riskLevel: "CRITICAL"
           });
        }
      }
    }
    if (customerRetention.length > 0) {
      customerRetention.filter(c => c.riskLevel === 'CRITICAL').forEach(c => {
         interventions.push({ type: "REVENUE", priority: "CRITICAL", title: `Churn Alert: ${c.name}`, desc: `Frequent high-spender has breached 90-day purchase gap.` });
      });
    }

    // 6. Strategic Briefing (Gemini Optimized @ 4h Cache)
    let briefing = "";
    
    const generateHeuristicBriefing = (hs: number, iv: any[]) => {
      // 🟢 Growth/Optimal Quadrant
      if (hs >= 90 && iv.length === 0) return "Systems optimal. Catalog velocity and liquidity metrics are in a growth quadrant.";
      if (hs >= 80 && iv.every(i => i.priority !== 'CRITICAL')) return "Stability high. System is absorbing minor demand drifts effectively.";
      
      // 🔴 Critical Interventions (Safe-Mode Summary)
      const criticals = iv.filter(i => i.priority === 'CRITICAL');
      if (criticals.length > 0) {
        const top = criticals[0];
        if (criticals.length === 1) return `Neural Alert: ${top.title}. Action required to stabilize ${top.type.toLowerCase()} metrics.`;
        return `Multi-Vector Disruption: ${criticals.length} critical neural risks detected. Prioritizing ${top.type} stabilization.`;
      }

      // 🟡 General Caution
      if (hs < 70) return "Heightened volatility detected. Neural core suggesting a cautious position on inventory expansion.";
      
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
          const model = getProModel("Provide a 2-sentence executive strategic briefing. Be concise and insightful.");
          const prompt = `Health ${healthScore}, Sales Drift ${salesVelocity}%, Risks ${neuralRisks.length}. Resilience ${financialResilience}%`;
          const result = await model.generateContent(prompt);
          briefing = result.response.text();
          await admin.firestore().collection(CACHE_COLLECTION).doc(CACHE_KEY).update({ lastLLMUpdateTime: admin.firestore.FieldValue.serverTimestamp() });
        } catch (err: any) {
          console.error("[NeuralCore] LLM Generation Failed. Falling back to Enhanced Heuristic.", err.message);
          
          // Emergency Fallback: If heuristic was null and LLM failed, we MUST provide a real context briefing
          const critical = interventions.find(i => i.priority === 'CRITICAL');
          if (critical) {
            briefing = `Risk Mitigation Active: ${critical.title} requires immediate administrative attention.`;
          } else {
            briefing = healthScore > 75 
                ? "Neural core stable. Real-time optimization is active across all business sectors."
                : "Market synchronization in progress. Refining predictive models for current volatility.";
          }
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
      // 🆕 Real vs AI Forecast Overlay Data
      pastPredictions: pastPredictionMap,
      forecastAccuracy,
      forecastAccuracyDataPoints: accuracyDataPoints,
      // 🆕 Monthly Sales Target
      monthlyTarget: {
        actual: Math.round(monthlyActual),
        forecast: Math.round(monthlyForecastTarget),
        aiPrediction: Math.round(mlMonthlyPrediction),
        daysElapsed: monthInfo.elapsedDays,
        daysRemaining: monthInfo.remainingDays,
        totalDays: monthInfo.totalDays,
        monthName: monthInfo.monthName,
        year: monthInfo.year,
        progressPercent: monthlyForecastTarget > 0 ? Math.round((monthlyActual / monthlyForecastTarget) * 100) : 0
      },
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
