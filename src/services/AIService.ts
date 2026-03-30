import {
  GoogleGenerativeAI,
  FunctionDeclaration,
  Tool,
  Part,
  Content,
  SchemaType,
} from "@google/generative-ai";
import {
  getPopularItems,
  getRecentOrders,
  getLowStockAlerts,
  getDailySnapshot,
  getOverviewByDateRange,
  getProfitMargins,
  getRevenueByCategory,
  getMonthlyComparison,
} from "./DashboardService";

let genAIInstance: GoogleGenerativeAI | null = null;
export const getGenAI = () => {
  if (!genAIInstance) {
    const key = process.env.GEMINI_API_KEY;
    if (!key)
      throw new Error("GEMINI_API_KEY environment variable is not set.");
    genAIInstance = new GoogleGenerativeAI(key);
  }
  return genAIInstance;
};

// ─── Tool Definitions ─────────────────────────────────────────────────────────

const AI_TOOLS: FunctionDeclaration[] = [
  {
    name: "getTopProducts",
    description:
      "Get the top selling products by sales volume for a given month and year. Use this when the user asks about popular products, best sellers, or top products.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        limit: {
          type: SchemaType.NUMBER,
          description: "Number of top products to return. Default is 10.",
        },
        month: {
          type: SchemaType.NUMBER,
          description:
            "Month as a 0-indexed number (0=Jan, 11=Dec). Defaults to current month.",
        },
        year: {
          type: SchemaType.NUMBER,
          description: "4-digit year. Defaults to current year.",
        },
      },
    },
  },
  {
    name: "getRecentOrders",
    description:
      "Get the most recent orders from the system. Use this when the user asks about recent orders, last orders, latest transactions, or order history.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        limit: {
          type: SchemaType.NUMBER,
          description: "Number of recent orders to return. Default is 10.",
        },
      },
    },
  },
  {
    name: "getLowStockItems",
    description:
      "Get products that are running low on stock. Use this when the user asks about low stock, out of stock risks, or inventory alerts.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        threshold: {
          type: SchemaType.NUMBER,
          description:
            "Stock quantity threshold. Items at or below this are considered low stock. Default is 5.",
        },
        limit: {
          type: SchemaType.NUMBER,
          description: "Max number of items to return. Default is 15.",
        },
      },
    },
  },
  {
    name: "getDailySnapshot",
    description:
      "Get today's business snapshot including revenue, orders, and key metrics. Use this when user asks about today's performance, daily summary, or current day stats.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
    },
  },
  {
    name: "getSalesOverview",
    description:
      "Get a sales and revenue overview for a specific date range. Use this when the user asks about sales for a period, revenue summary, or date-range analytics.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        from: {
          type: SchemaType.STRING,
          description: "Start date in ISO format (YYYY-MM-DD).",
        },
        to: {
          type: SchemaType.STRING,
          description: "End date in ISO format (YYYY-MM-DD).",
        },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "getProfitMargins",
    description:
      "Get profit margin analysis for the business. Use this when the user asks about profits, margins, or profitability.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
    },
  },
  {
    name: "getRevenueByCategory",
    description:
      "Get revenue broken down by product category. Use this when the user asks about category performance or which categories generate the most revenue.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
    },
  },
  {
    name: "getMonthlyComparison",
    description:
      "Compare performance metrics between this month and last month. Use this when the user asks about monthly trends, growth, or comparisons.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
    },
  },
  {
    name: "queryFirestore",
    description:
      "Perform a direct query on specific Firestore collections to find information. Use this when the high-level tools do not provide the specific information needed.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        collectionName: {
          type: SchemaType.STRING,
          description:
            "The name of the collection to query. You have access to ALL collections in the database.",
        },
        filters: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              field: { type: SchemaType.STRING },
              operator: {
                type: SchemaType.STRING,
                format: "enum",
                enum: ["==", ">", "<", ">=", "<=", "array-contains"],
              },
              value: { type: SchemaType.STRING },
            },
            required: ["field", "operator", "value"],
          },
          description: "List of filters to apply to the query.",
        },
        orderBy: {
          type: SchemaType.STRING,
          description: "Field to order by.",
        },
        orderDirection: {
          type: SchemaType.STRING,
          format: "enum",
          enum: ["asc", "desc"],
          description: "Direction to order by.",
        },
        limit: {
          type: SchemaType.NUMBER,
          description: "Max number of documents to return. Default 20, Max 50.",
        },
      },
      required: ["collectionName"],
    },
  },
];

// ─── Tool Executor ─────────────────────────────────────────────────────────────

const executeTool = async (
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> => {
  const now = new Date();

  switch (name) {
    case "getTopProducts":
      return await getPopularItems(
        (args.limit as number) || 10,
        (args.month as number) ?? now.getMonth(),
        (args.year as number) ?? now.getFullYear(),
      );

    case "getRecentOrders":
      return await getRecentOrders((args.limit as number) || 10);

    case "getLowStockItems":
      return await getLowStockAlerts(
        (args.threshold as number) || 5,
        (args.limit as number) || 15,
      );

    case "getDailySnapshot":
      return await getDailySnapshot();

    case "getSalesOverview": {
      const startDate = new Date(args.from as string);
      const endDate = new Date(args.to as string);
      endDate.setHours(23, 59, 59, 999);
      return await getOverviewByDateRange(startDate, endDate);
    }

    case "getProfitMargins":
      return await getProfitMargins();

    case "getRevenueByCategory":
      return await getRevenueByCategory();

    case "getMonthlyComparison":
      return await getMonthlyComparison();

    case "queryFirestore": {
      const {
        collectionName,
        filters,
        orderBy,
        orderDirection,
        limit: resultLimit,
      } = args as {
        collectionName: string;
        filters?: Array<{
          field: string;
          operator: "==" | ">" | "<" | ">=" | "<=" | "array-contains";
          value: unknown;
        }>;
        orderBy?: string;
        orderDirection?: "asc" | "desc";
        limit?: number;
      };

      const { adminFirestore } = await import("@/firebase/firebaseAdmin");
      let query: any = adminFirestore.collection(collectionName);

      // Apply filters
      if (Array.isArray(filters)) {
        filters.forEach(
          (f: { field: string; operator: string; value: unknown }) => {
            // Automatic type conversion for numbers/booleans if needed
            let val = f.value;
            if (val === "true") val = true;
            if (val === "false") val = false;
            if (
              !isNaN(Number(val)) &&
              typeof val === "string" &&
              val.trim() !== ""
            ) {
              val = Number(val);
            }

            query = query.where(f.field, f.operator, val);
          },
        );
      }

      // Apply ordering
      if (orderBy) {
        query = query.orderBy(orderBy, orderDirection || "asc");
      }

      // Apply limit
      const finalLimit = Math.min(resultLimit || 20, 50);
      query = query.limit(finalLimit);

      const snapshot = await query.get();
      return snapshot.docs.map(
        (doc: { id: string; data: () => Record<string, unknown> }) => ({
          id: doc.id,
          ...doc.data(),
        }),
      );
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
};

// ─── Public Methods ────────────────────────────────────────────────────────────

/**
 * Global AI method to generate tags/keywords from any text.
 */
export const generateTags = async (
  contextDescription: string,
  content: string,
  maxTags: number = 15,
): Promise<string[]> => {
  try {
    const model = getGenAI().getGenerativeModel({
      model: "gemini-3.1-flash-lite-preview",
    });

    const prompt = `
      ${contextDescription}

      Content: ${content}

      Extract up to ${maxTags} short, lowercase, comma-separated keywords/tags.
      Avoid generic words like "item" or "product". 
    `;

    const result = await model.generateContent(prompt);
    const text = result.response.text().toLowerCase();

    const tags = text
      .split(/[,|\n]/)
      .map((t) => t.trim())
      .filter((t) => t.length > 1);

    return Array.from(new Set(tags));
  } catch (error) {
    console.error("Error generating tags:", error);
    return [];
  }
};

/**
 * Context-aware conversational AI chat with Gemini Function Calling.
 * The AI can query real Firestore data (orders, products, inventory, etc.) on demand.
 */
export const processContextualChat = async (
  contextData: Record<string, unknown>,
  messages: { role: "user" | "model"; parts: [{ text: string }] }[],
): Promise<string> => {
  const model = getGenAI().getGenerativeModel({
    model: "gemini-3.1-flash-lite-preview",
    systemInstruction: `You are an intelligent AI business assistant for the NeverBe ERP system.
You have access to real-time business data through the tools provided. Always use these tools to fetch actual data whenever the user asks about orders, products, stock, revenue, sales, or any business metrics.
Never say you "can't access" data — just call the appropriate tool.

Rules:
- Respond in Sinhala if the user writes in Sinhala. Respond in English if they write in English.
- Do NOT use Singlish.
- Format responses neatly using markdown (tables, bullet points, etc.) for data-heavy answers.
- When showing monetary values, prefix with "Rs." (Sri Lankan Rupees).
- After fetching data, always provide a brief, helpful analysis or insight, not just raw data.

Current page context (optional, may be empty):
${JSON.stringify(contextData, null, 2)}`,
    tools: [{ functionDeclarations: AI_TOOLS } as Tool],
  });

  // Build history for multi-turn chat (all except the last user message)
  const history: Content[] = messages.slice(0, -1).map((m) => ({
    role: m.role,
    parts: m.parts as Part[],
  }));

  const lastMessage = messages[messages.length - 1].parts[0].text;
  const chat = model.startChat({ history });

  // ── Agentic Loop: keep calling tools until Gemini gives a final text response ──
  let response = await chat.sendMessage(lastMessage);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = response.response.candidates?.[0];
    if (!candidate) break;

    // Check if Gemini wants to call a function
    const functionCalls = response.response.functionCalls();
    if (!functionCalls || functionCalls.length === 0) {
      // No more tool calls — return the final text response
      break;
    }

    // Execute all requested function calls in parallel
    const toolResultParts: Part[] = await Promise.all(
      functionCalls.map(async (call) => {
        try {
          console.log(`[AIService] Calling tool: ${call.name}`, call.args);
          const result = await executeTool(
            call.name,
            call.args as Record<string, unknown>,
          );
          console.log(`[AIService] Tool ${call.name} returned result`);
          return {
            functionResponse: {
              name: call.name,
              response: { result },
            },
          } as Part;
        } catch (err) {
          console.error(`[AIService] Tool ${call.name} failed:`, err);
          return {
            functionResponse: {
              name: call.name,
              response: { error: (err as Error).message },
            },
          } as Part;
        }
      }),
    );

    // Send tool results back to Gemini and continue the loop
    response = await chat.sendMessage(toolResultParts);
  }

  return response.response.text();
};
