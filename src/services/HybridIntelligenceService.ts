import { getGenAI } from "./AIService";
import { generateSalesForecast } from "./TFService";
import { 
  getLowStockAlerts, 
  getPopularItems, 
  getDailySnapshot,
  getMonthlyComparison 
} from "./DashboardService";
import { getCache, setCache } from "./CacheService";
import { logUsage } from "./UsageService";
import dayjs from "dayjs";

const CACHE_KEY = "hybrid_intelligence_hub";
const CACHE_TTL = 12; // 12 hours

export const getHybridIntelligence = async (forceRefresh: boolean = false) => {
  const startTime = Date.now();

  try {
    console.log("[HybridIntelligence] Generating real-time neural forecast...");

    // 1. ALWAYS run TensorFlow Forecast (ML is local and "free")
    const tfResult = await generateSalesForecast(14);
    
    // 2. Gather Business Context for LLM
    const now = dayjs();
    const [lowStock, popular, snapshot, comparison] = await Promise.all([
      getLowStockAlerts(10, 5),
      getPopularItems(5, now.month(), now.year()),
      getDailySnapshot(),
      getMonthlyComparison()
    ]);

    const businessContext = {
      today: snapshot,
      monthlyComparison: comparison,
      lowStockRisks: lowStock.map(i => ({ name: i.productName, stock: i.currentStock })),
      topMovingItems: popular.map(i => ({ name: i.item.name, sold: i.soldCount }))
    };

    // 3. LLM Fusion (Check Cache for Advisory first)
    let strategicAdvisory = "";
    let isAdvisoryFromCache = false;

    if (!forceRefresh) {
      const cachedAdvisory = await getCache("llm_strategic_advisory");
      if (cachedAdvisory) {
        strategicAdvisory = cachedAdvisory;
        isAdvisoryFromCache = true;
      }
    }

    if (!strategicAdvisory && tfResult.success) {
      console.log("[HybridIntelligence] LLM Cache miss. Generating new strategic insights...");
      const model = getGenAI().getGenerativeModel({
        model: "gemini-3.1-flash-lite-preview",
        systemInstruction: "You are a Senior AI Business Consultant for an ERP system. Your task is to analyze a Neural Network's numerical forecast and provide strategic advisory."
      });

      const prompt = `
        HISTORICAL & NEURAL FORECAST DATA:
        ${JSON.stringify(tfResult.predictions.filter(p => p.isForecast), null, 2)}

        CURRENT BUSINESS CONTEXT:
        - Today's Revenue: Rs. ${snapshot.totalNetSales}
        - Monthly Revenue Change: ${comparison.percentageChange.revenue}%
        - Low Stock Alerts: ${businessContext.lowStockRisks.length} items at risk.
        - Top Sellers: ${businessContext.topMovingItems.map(i => i.name).join(", ")}

        TASK:
        Provide a concise (3-4 sentences) strategic advisory. 
        1. Explain the "Why" behind the neural forecast (e.g., trend patterns).
        2. Give one specific actionable advice (e.g., restock, promotion).
        3. Mention the predicted trend for the next 7 days.
        4. Do NOT use generic pleasantries. Be professional and data-driven.
      `;

      const result = await model.generateContent(prompt);
      strategicAdvisory = result.response.text();

      // Cache the LLM result only
      await setCache("llm_strategic_advisory", strategicAdvisory, CACHE_TTL);
    }

    const finalResult = {
      forecast: tfResult,
      context: businessContext,
      advisory: strategicAdvisory || "Neural models are currently analyzing your trajectory.",
      generatedAt: now.toISOString(),
      isAdvisoryFromCache
    };

    const duration = Date.now() - startTime;
    await logUsage("HYBRID", duration, {
      points: tfResult.metrics?.dataPoints || 0,
      cachedLLM: isAdvisoryFromCache
    });

    return finalResult;

  } catch (error) {
    console.error("[HybridIntelligence] Fatal Error:", error);
    throw error;
  }
};
