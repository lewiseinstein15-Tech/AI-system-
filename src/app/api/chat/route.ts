import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { Sandbox } from "@vercel/sandbox";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const runtime = "nodejs";

// Your original PROVIDERS
const PROVIDERS = [
  { name: "Qwen", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", key: "QWEN_API_KEY", model: process.env.QWEN_MODEL_ID || "qwen-plus" },
  { name: "Groq", baseURL: "https://api.groq.com/openai/v1", key: "GROQ_API_KEY", model: process.env.GROQ_MODEL_ID || process.env.GROQ_MODEL || "openai/gpt-oss-120b" },
  { name: "Cerebras", baseURL: "https://api.cerebras.ai/v1", key: "CEREBRAS_API_KEY", model: process.env.CEREBRAS_MODEL_ID || "gpt-oss-120b" },
  { name: "OpenRouter", baseURL: "https://openrouter.ai/api/v1", key: "OPENROUTER_API_KEY", model: process.env.OPENROUTER_MODEL_ID || "openrouter/free" },
  { name: "Gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", key: "GEMINI_API_KEY", model: process.env.GEMINI_MODEL_ID || "gemini-3.5-flash" },
];

// Fast Web Link Opener
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

const SMALL_TALK_RE = /^(hi|hello|hey|yo|sup|hiya|howdy|good\s?morning|good\s?evening|good\s?night|how\s?are\s?you|thanks?|thank\s?you|ok|okay|cool|nice|great|lol|haha|bye)[\s!.,?]*$/i;

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    const body = await req.json();
    const { messages, conversationId, autoVerify = false, imageBase64, mode, audioBase64, enableTTS = false } = body;

    let userPrompt = messages[messages.length - 1].content || "";
    const lowerPrompt = userPrompt.toLowerCase().trim();

    // Fast Small Talk
    if (userPrompt.length <= 60 && SMALL_TALK_RE.test(lowerPrompt)) {
      const casualResponse = "Hey! How can I help you today? 😊";
      return new Response(JSON.stringify({ choices: [{ delta: { content: casualResponse } }] }), { status: 200 });
    }

    // Link Opening
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = userPrompt.match(urlRegex) || [];
    let linkContext = "";

    if (urls.length > 0) {
      for (const url of urls) {
        linkContext += await fetchWebpage(url) + "\n\n";
      }
    }

    // Basic Response for now
    const responseText = linkContext 
      ? `I opened the link(s) for you:\n${linkContext}` 
      : "I'm here! Send me a question or a link to open.";

    return new Response(JSON.stringify({ choices: [{ delta: { content: responseText } }] }), { status: 200 });

  } catch (error: any) {
    console.error("API Error:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error", details: error.message }), { status: 500 });
  }
}