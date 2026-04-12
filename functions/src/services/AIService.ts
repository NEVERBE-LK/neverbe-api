import { GoogleGenerativeAI } from "@google/generative-ai";

let genAIInstance: GoogleGenerativeAI | null = null;

export const getGenAI = () => {
    if (!genAIInstance) {
        const key = process.env.GEMINI_API_KEY;
        if (!key) {
           console.error("[AIService] CRITICAL: GEMINI_API_KEY is not set in environment variables.");
           throw new Error("GEMINI_API_KEY is not set. Please configure it in Firebase Functions environment/secrets.");
        }
        genAIInstance = new GoogleGenerativeAI(key);
    }
    return genAIInstance;
};

/**
 * Heavy model for accuracy-critical forecasting.
 * Used by the sales prediction engine for maximum accuracy.
 */
export const getProModel = (systemInstruction?: string) => {
    return getGenAI().getGenerativeModel({
        model: "gemini-2.5-pro",
        ...(systemInstruction ? { systemInstruction } : {})
    });
};
