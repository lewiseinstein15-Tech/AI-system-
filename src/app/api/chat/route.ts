import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { Sandbox } from "@vercel/sandbox";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const runtime = "nodejs";

// NOTE: Model defaults below were updated...
const PROVIDERS = [
  { name: "Qwen", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", key: "QWEN_API_KEY", model: process.env.QWEN_MODEL_ID || "qwen-plus" },
  { name: "Groq", baseURL: "https://api.groq.com/openai/v1", key: "GROQ_API_KEY", model: process.env.GROQ_MODEL_ID || process.env.GROQ_MODEL || "openai/gpt-oss-120b" },
  { name: "Cerebras", baseURL: "https://api.cerebras.ai/v1", key: "CEREBRAS_API_KEY", model: process.env.CEREBRAS_MODEL_ID || "gpt-oss-120b" },
  { name: "OpenRouter", baseURL: "https://openrouter.ai/api/v1", key: "OPENROUTER_API_KEY", model: process.env.OPENROUTER_MODEL_ID || "openrouter/free" },
  { name: "Gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", key: "GEMINI_API_KEY", model: process.env.GEMINI_MODEL_ID || "gemini-3.5-flash" },
];

// === NEW: LINK OPENING FEATURE ===
async function fetchWebpage(url: string): Promise<string> {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ userAgent: "Mozilla/5.0" });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    if (url.includes("x.com") || url.includes("twitter.com")) {
      await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
      await new Promise(r => setTimeout(r, 1200));
    }
    const title = await page.title();
    const content = await page.inner_text("body");
    await browser.close();
    return `Title: ${title}\nURL: \( {url}\n\nContent:\n \){content.slice(0, 12000)}`;
  } catch (err: any) {
    return `Could not open link ${url}: ${err.message}`;
  }
}

// === YOUR ORIGINAL FUNCTIONS (unchanged) ===
async function callSingleAI(messages: any[], temp: number, maxTokens: number) {
  // ... (your original function)
}

async function callAllAI(messages: any[], temp: number, maxTokens: number, timeoutMs = 30000) {
  // ... (your original function)
}

async function synthesizeResponses(responses: string[], userQuery: string, searchCtx: string): Promise<string> {
  // ... (your original function)
}

// Keep all other original functions (speechToText, textToSpeech, search functions, verifyClaim, etc.) exactly as they were.

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    const body = await req.json();
    const { messages, conversationId, autoVerify = false, imageBase64, mode, audioBase64, enableTTS = false } = body;

    let userPrompt = messages[messages.length - 1].content;
    const lowerPrompt = userPrompt.toLowerCase();

    // === LINK DETECTION (added) ===
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = userPrompt.match(urlRegex) || [];
    let linkContext = "";

    if (urls.length > 0) {
      for (const url of urls) {
        linkContext += await fetchWebpage(url) + "\n\n";
      }
    }

    if (mode === "voice" && audioBase64) {
      try { const transcript = await speechToText(audioBase64); if (transcript) userPrompt = transcript; } catch (e: any) { console.error("STT failed:", e.message); }
    }

    let convId = conversationId;
    if (!convId) {
      const nc = await prisma.conversation.create({ data: { userId: session.user.id, title: userPrompt.substring(0, 30) + "..." } });
      convId = nc.id;
    }
    await prisma.message.create({ data: { conversationId: convId, role: "user", content: userPrompt } });

    if (mode === "live" && imageBase64) {
      // ... your original image mode code (unchanged)
    }

    const SMALL_TALK_RE = /^(hi|hello|hey|yo|sup|hiya|howdy|good\s?morning|good\s?evening|good\s?night|goodnight|how\s?are\s?you|how'?s\s?it\s?going|what'?s\s?up|whats\s?up|thanks?|thank\s?you|thanks?\s?a\s?lot|ok|okay|cool|nice|great|lol|haha|bye|goodbye|see\s?you|see\s?ya|good\s?day)[\s!.,?]*$/i;
    const isSmallTalk = userPrompt.trim().length <= 40 && SMALL_TALK_RE.test(userPrompt.trim());

    const isCoding = !isSmallTalk && (lowerPrompt.includes("code") || lowerPrompt.includes("algorithm") || lowerPrompt.includes("function") || lowerPrompt.includes("write a") || lowerPrompt.includes("array") || lowerPrompt.includes("tree"));

    if (isSmallTalk) {
      // ... your original small talk code (unchanged)
    }

    if (isCoding) {
      // ... your original coding mode code (unchanged)
    }

    const SYSTEM = `You are Noctryx AI...`; // your full original SYSTEM prompt

    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(ctrl) {
        const sendStatus = (msg: string) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ status: msg })}\n\n`));
        let chatTxt = "";

        try {
          sendStatus("🔎 Searching live sources...");

          // ... your original search code (tavily, wiki, etc.)

          let searchCtx = "";
          // ... your original searchCtx building

          // Add link context to search results
          const fullContext = searchCtx + linkContext;
          const systemWithSearch = fullContext ? `\( {SYSTEM}\n\n---\nLIVE SEARCH + LINK RESULTS:\n\n \){fullContext}` : SYSTEM;

          sendStatus("🧠 Accessing AI brain...");
          const aiMessages = [{ role: "system", content: systemWithSearch }, ...messages.slice(-6).map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content.includes("data:image") ? "[Image]" : m.content }))];

          let aiResponses: string[] = [];
          try {
            sendStatus("🔄 Querying multiple AI models...");
            const ensembleResult = await callAllAI(aiMessages, 0.5, 2000);
            aiResponses = ensembleResult.responses;
          } catch {
            const { result } = await callSingleAI(aiMessages, 0.5, 2000);
            let fallbackText = "";
            for await (const d of result.textStream) fallbackText += d;
            aiResponses = [fallbackText];
          }

          sendStatus("🔄 Synthesizing best answer...");
          chatTxt = await synthesizeResponses(aiResponses, userPrompt, fullContext);

          // ... the rest of your original streaming, word-by-word, verification, TTS, DB code remains exactly the same
        } catch (e: any) {
          // your original error handling
        }
      },
    });

    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no" } });
  } catch (error: any) {
    console.error("API Error:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error", details: error.message }), { status: 500 });
  }
}