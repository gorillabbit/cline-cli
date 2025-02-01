import { GoogleGenerativeAI } from "@google/generative-ai";

function initGeminiClient(apiKey: string | undefined) {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set in environment variables.");
  }
  return new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: "gemini-pro" });
}

async function sendChatMessage(client: any, model: string, message: string, context?: string) {
  try {
    const chat = client.startChat({
      history: [],
      generationConfig: {
        maxOutputTokens: 2048,
      },
    });

    const result = await chat.sendMessage(message);
    const response = result.response;
    return response.text();

  } catch (error: any) {
    console.error("Gemini API error:", error);
    return "Error communicating with Gemini API. Please check console for details.";
  }
}

export { initGeminiClient, sendChatMessage };
