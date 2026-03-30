import { GoogleGenerativeAI } from "@google/generative-ai";

let genAIInstance: GoogleGenerativeAI | null = null;

export const getGenAI = () => {
    if (!genAIInstance) {
        const key = process.env.GEMINI_API_KEY;
        if (!key) throw new Error("GEMINI_API_KEY is not set.");
        genAIInstance = new GoogleGenerativeAI(key); // Default should work, but let's check
    }
    return genAIInstance;
};
