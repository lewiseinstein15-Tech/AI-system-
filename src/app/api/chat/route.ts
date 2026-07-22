import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { Sandbox } from "@vercel/sandbox";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const runtime = "nodejs";

const PROVIDERS = [ /* your existing PROVIDERS array - keep unchanged */ ];

async function fetchWebpage(url: string): Promise<string> {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ userAgent: "Mozilla/5.0" });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

    if (url.includes("x.com") || url.includes("twitter.com")) {
      await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
      await new Promise(r => setTimeout(r, 1500));
    }

    const title = await page.title();
    const content = await page.inner_text("body");

    await browser.close();
    return `Title: ${title}\nURL: \( {url}\n\nContent:\n \){content.slice(0, 12000)}`;
  } catch (err: any) {
    return `Could not open link ${url}: ${err.message}`;
  }
}

async function callSingleAI(messages: any[], temp: number, maxTokens: number) {
  // ... keep your existing function
}

async function callAllAI(messages: any[], temp: number, maxTokens: number, timeoutMs = 30000) {
  // ... keep your existing function
}

// Keep all your other functions (synthesizeResponses, speechToText, textToSpeech, search functions, verifyClaim, etc.) unchanged

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    const body = await req.json();
    const { messages, conversationId, autoVerify = false, imageBase64, mode, audioBase64, enableTTS = false } = body;

    let userPrompt = messages[messages.length - 1].content;

    // ... (keep your voice mode, conversation creation, small talk detection, coding mode unchanged)

    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(ctrl) {
        const sendStatus = (msg: string) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ status: msg })}\n\n`));
        let chatTxt = "";

        try {
          sendStatus("🔎 Searching live sources...");

          // URL detection and fetching
          const urlRegex = /(https?:\/\/[^\s]+)/g;
          const urls = userPrompt.match(urlRegex) || [];
          let linkContext = "";

          if (urls.length > 0) {
            sendStatus(`🌐 Opening ${urls.length} link(s)...`);
            for (const url of urls) {
              const pageContent = await fetchWebpage(url);
              linkContext += `\n\n[LINK CONTENT FROM \( {url}]\n \){pageContent}\n`;
            }
          }

          // ... keep your existing searchCtx logic

          const fullContext = searchCtx + linkContext;
          const systemWithContext = fullContext ? `\( {SYSTEM}\n\n---\nLIVE DATA:\n \){fullContext}` : SYSTEM;

          // ... rest of your AI calling, synthesis, streaming, verification, TTS logic unchanged

        } catch (e: any) {
          console.error("Chat error:", e);
          chatTxt = `*(Error: ${e.message})*`;
        } finally {
          // your DB save logic
        }
      },
    });

    return new Response(stream, { 
      headers: { 
        "Content-Type": "text/event-stream", 
        "Cache-Control": "no-cache", 
        "Connection": "keep-alive" 
      } 
    });
  } catch (error: any) {
    console.error("API Error:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 });
  }
}