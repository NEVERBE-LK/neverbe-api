import { GoogleGenerativeAI } from "@google/generative-ai";

let genAIInstance: GoogleGenerativeAI | null = null;
const getGenAI = () => {
  if (!genAIInstance) {
    const key = process.env.GEMINI_API_KEY;
    if (!key)
      throw new Error("GEMINI_API_KEY environment variable is not set.");
    genAIInstance = new GoogleGenerativeAI(key);
  }
  return genAIInstance;
};

/**
 * Global AI method to generate tags/keywords from any text.
 * @param contextDescription - A description of what the AI should extract (e.g., "Extract tags for a product").
 * @param content - The actual text/content to extract tags from.
 * @param maxTags - Optional maximum number of tags to return (default 15)
 * @returns Array of unique, lowercase tags
 */
export const generateTags = async (
  contextDescription: string,
  content: string,
  maxTags: number = 15,
): Promise<string[]> => {
  try {
    const model = getGenAI().getGenerativeModel({
      model: "gemini-2.0-flash-lite",
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
