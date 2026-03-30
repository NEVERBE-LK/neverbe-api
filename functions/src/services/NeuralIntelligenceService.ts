import * as admin from "firebase-admin";
import { getGenAI } from "./AIService";
import { generateSalesForecast } from "./TFService";
import {
  getDailySnapshot,
  getMonthlyComparison,
  getHistoricalSales,
  getNeuralRawContext,
  analyzeNeuralStockRisks,
  analyzeNeuralPromoStrategy
} from "./DataService";

const CACHE_COLLECTION = "dashboard_cache";
const CACHE_KEY = "neural_core_feed";
const SETTINGS_COLLECTION = "app_settings";
const SETTINGS_KEY = "neural_config";

export const updateNeuralCoreFeed = async () => {
  const startTime = Date.now();
  console.log("[NeuralCore] Orchestrating global analysis (Unified Mode)...");

  try {
    // 0. Fetch Dynamic Neural Configuration
    const settingsDoc = await admin.firestore().collection(SETTINGS_COLLECTION).doc(SETTINGS_KEY).get();
    const config = settingsDoc.data() || {
      historicalRunway: 120,
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

    // 2. Optimized Neural Analyzers (Context-Shared)
    const neuralRisks = analyzeNeuralStockRisks(ctx, config.forecastWindow || 14);
    const promoSuggestions = analyzeNeuralPromoStrategy(ctx);
    
    // 3. Neural Projection (Future)
    const tfResult = await generateSalesForecast(config.forecastWindow || 14, historical);
    
    // 4. Global Health Calculation (Refined Logic)
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

    // 5. Autonomous Interventions
    const interventions: any[] = [];
    if (salesVelocity < -20) {
      interventions.push({ type: "REVENUE", priority: "CRITICAL", title: "Vigorous Revenue Drift", desc: "Sales momentum is trailing last month significantly." });
    }
    if (financialResilience < 40) {
      interventions.push({ type: "FINANCE", priority: "CRITICAL", title: "Liquidity Constraint", desc: `${Math.round(financialResilience)}% Resilience. Cashflow needs optimization.` });
    }
    if (neuralRisks.length > 0) {
      neuralRisks.forEach(risk => {
        interventions.push({ type: "INVENTORY", priority: risk.riskLevel, title: `Neural Stock Out: ${risk.name}`, desc: `Predicted depletion in ${risk.daysRemaining} days.` });
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
        promoSuggestions
      },
      projections: tfResult,
      generatedAt: new Date().toISOString()
    };

    await admin.firestore().collection(CACHE_COLLECTION).doc(CACHE_KEY).set({
      data: finalFeed,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`[NeuralCore] Synchronization stable in ${Date.now() - startTime}ms`);
    return { success: true, data: finalFeed };

  } catch (error) {
    console.error("[NeuralCore] Orchestration failed:", error);
    throw error;
  }
};
