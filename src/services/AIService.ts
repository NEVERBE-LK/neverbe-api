import { GoogleGenerativeAI } from "@google/generative-ai";

let genAIInstance: GoogleGenerativeAI | null = null;

export const getGenAI = () => {
  if (!genAIInstance) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not set.");
    genAIInstance = new GoogleGenerativeAI(key);
  }
  return genAIInstance;
};

export const getModel = (modelName: string = "gemini-2.5-flash-lite") => {
  return getGenAI().getGenerativeModel({
    model: modelName,
  });
};

/**
 * Generate product description from title and features
 */
export const generateDescription = async (title: string, features: string[]) => {
  const model = getModel();
  const prompt = `Create a professional product description for "${title}" with these features: ${features.join(", ")}`;

  const result = await model.generateContent(prompt);
  return result.response.text();
};

export interface SuggestAttributesInput {
  name: string;
  category?: string;
  brand?: string;
  description?: string;
}

export interface SuggestAttributesOutput {
  gender: string[];
  occasion: string[];
  style: string[];
  season: string[];
  fit: string;
  material: string;
}

export const suggestAttributes = async (input: SuggestAttributesInput): Promise<SuggestAttributesOutput> => {
  const { name, category, brand, description } = input;
  const model = getModel("gemini-2.5-flash");

  const context = [
    `Product Name: ${name}`,
    brand && `Brand: ${brand}`,
    category && `Category: ${category}`,
    description && `Description: ${description}`,
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `You are a professional e-commerce product categorization AI for a premium Sri Lankan fashion brand called NeverBe.

Based on the product details below, predict the best fitting attributes from the allowed option values.

Product Details:
${context}

Allowed Options (Use exactly these values):
- gender (subset of): ["men", "women", "kids", "unisex"]
- occasion (subset of): ["casual", "formal", "business-casual", "sport", "party", "office", "beach", "lounge", "travel", "gym"]
- style (subset of): ["modern", "vintage", "streetwear", "minimalist", "boho", "athleisure", "classic", "grunge", "chic", "casual", "high-fashion"]
- season (subset of): ["summer", "winter", "spring", "autumn", "monsoon", "all-season"]
- fit (one of): ["regular", "slim", "oversized", "loose", "skinny", "relaxed", "athletic", "tailored", "boxy"]
- material (one of): ["cotton", "polyester", "linen", "nylon", "spandex", "viscose", "rayon", "satin", "velvet", "fleece", "knitwear", "leather", "suede", "canvas", "chiffon", "silk", "wool"]

Return ONLY a raw JSON object with the keys "gender", "occasion", "style", "season", "fit", and "material". 
Your output must be parseable JSON and nothing else. No markdown wrapping, no backticks \`\`\`.

Example response:
{
  "gender": ["women"],
  "occasion": ["casual", "beach"],
  "style": ["boho", "minimalist"],
  "season": ["summer"],
  "fit": "oversized",
  "material": "linen"
}`;

  const result = await model.generateContent(prompt);
  let text = result.response.text().trim();
  
  if (text.startsWith("```")) {
    text = text.replace(/^```(json)?/, "").replace(/```$/, "").trim();
  }

  return JSON.parse(text) as SuggestAttributesOutput;
};

