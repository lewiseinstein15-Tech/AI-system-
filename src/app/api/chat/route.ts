import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const runtime = "nodejs";

const PROVIDERS = [ /* keep your full PROVIDERS array */ ];

async function fetchWebpage(url: string): Promise<string> {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ userAgent: "Mozilla/5.0" });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 25000 });
    if (url.includes("x.com") || url.includes("twitter.com")) {
      await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
      await new Promise(r => setTimeout(r, 1000));
    }
    const title = await page.title();
    const content = await page.inner_text("body");
    await browser.close();
    return `Title: ${title}\nURL: ${url}\nContent: ${content.slice(0, 10000)}`;
  } catch (err: any) {
    return `Could not open link: ${err.message}`;
  }
}

// Small Talk Regex (keep yours)
const SMALL_TALK_RE = /^(hi|hello|hey|yo|sup|hiya|howdy|good\s?morning|good\s?evening|good\s?night|how\s?are\s?you|thanks?|thank\s?you|ok|okay|cool|nice|great|lol|haha|bye)[\s!.,?]*$/i;

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    const body = await req.json();
    const { messages, conversationId, mode, audioBase64, enableTTS = false } = body;

    let userPrompt = messages[messages.length - 1].content || "";
    const lowerPrompt = userPrompt.toLowerCase().trim();

    // === INSTANT SMALL TALK PATH ===
    if (userPrompt.length <= 60 && SMALL_TALK_RE.test(lowerPrompt)) {
      const casualResponse = `Hey! How can I help you today? 😊`;
      // Save to DB and return fast
      // ... your DB code for small talk
      return new Response(JSON.stringify({ choices: [{ delta: { content: casualResponse } }] }), { status: 200 });
    }

    // === NORMAL PATH ===
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = userPrompt.match(urlRegex) || [];
    let linkContext = "";

    if (urls.length > 0) {
      for (const url of urls) {
        linkContext += await fetchWebpage(url) + "\n\n";
      }
    }

    // Use single fast provider for normal chats
    const { result } = await callSingleAI(/* your messages with context */, 0.7, 1500);

    // ... continue with your streaming logic

  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: "Error" }), { status: 500 });
  }
}