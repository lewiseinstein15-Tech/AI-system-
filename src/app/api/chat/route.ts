import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createOpenAI } from '@ai-sdk/openai';
import { streamText, tool } from 'ai';
import { z } from 'zod';

// ============================================================
// MULTI-PROVIDER FALLBACK
// Tries each free provider in order. If one fails at request
// start (rate limit, quota exhausted, payment_required, model
// not found), it moves to the next automatically.
// ============================================================

type ProviderConfig = {
  name: string;
  baseURL: string;
  apiKeyEnv: string;
  model: string;
};

const PROVIDERS: ProviderConfig[] = [
  { name: "Cerebras", baseURL: "https://api.cerebras.ai/v1", apiKeyEnv: "CEREBRAS_API_KEY", model: process.env.CEREBRAS_MODEL_ID || "gpt-oss-120b" },
  { name: "Groq", baseURL: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_API_KEY", model: process.env.GROQ_MODEL_ID || "openai/gpt-oss-20b" },
  { name: "OpenRouter", baseURL: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY", model: process.env.OPENROUTER_MODEL_ID || "deepseek/deepseek-chat-v3:free" },
  { name: "Gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", apiKeyEnv: "GEMINI_API_KEY", model: process.env.GEMINI_MODEL_ID || "gemini-2.5-flash" },
];

// Attempts each provider in order until one successfully starts streaming.
async function streamWithFallback(
  buildArgs: (model: any) => Parameters<typeof streamText>[0]
): Promise<{ result: Awaited<ReturnType<typeof streamText>>; providerName: string }> {
  let lastError: any = null;

  for (const provider of PROVIDERS) {
    const apiKey = process.env[provider.apiKeyEnv];
    if (!apiKey) {
      console.warn(`Skipping ${provider.name}: ${provider.apiKeyEnv} not set`);
      continue;
    }

    try {
      const client = createOpenAI({ baseURL: provider.baseURL, apiKey });
      const model = client(provider.model);
      const args = buildArgs(model);
      const result = await streamText(args);
      console.log(`Using provider: ${provider.name} (${provider.model})`);
      return { result, providerName: provider.name };
    } catch (err: any) {
      console.error(`Provider ${provider.name} failed:`, err?.message || err);
      lastError = err;
      continue;
    }
  }

  throw new Error(
    `All providers exhausted. Last error: ${lastError?.message || "unknown"}`
  );
}

// Helper to truncate text
function truncate(str: string | null, max: number) {
  if (!str) return null;
  return str.length > max ? str.substring(0, max) + "..." : str;
}

// Helper to fetch with a timeout
async function fetchWithTimeout(url: string, options: any = {}, ms: number = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeout);
    return res;
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

// --- MEGA SEARCH AGENT HELPERS ---
async function searchWiki(query: string) {
  const searchRes = await fetchWithTimeout(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`);
  const searchData = await searchRes.json();
  if (searchData.query?.search?.length > 0) {
    const title = searchData.query.search[0].title;
    const sumRes = await fetchWithTimeout(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
    const sumData = await sumRes.json();
    if (sumData.extract) return `Wikipedia: ${sumData.extract}`;
  }
  return null;
}

async function searchDdg(query: string) {
  const res = await fetchWithTimeout(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`);
  const data = await res.json();
  if (data.AbstractText) return `DuckDuckGo: ${data.AbstractText}`;
  if (data.RelatedTopics?.[0]?.Text) return `DuckDuckGo: ${data.RelatedTopics[0].Text}`;
  return null;
}

async function searchHn(query: string) {
  const res = await fetchWithTimeout(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=2`);
  const data = await res.json();
  if (data.hits?.length > 0) return `Hacker News: ${data.hits.map((h: any) => h.title).join(' | ')}`;
  return null;
}

async function searchSo(query: string) {
  const res = await fetchWithTimeout(`https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(query)}&site=stackoverflow&pagesize=2`);
  const data = await res.json();
  if (data.items?.length > 0) return `StackOverflow: ${data.items.map((i: any) => i.title).join(' | ')}`;
  return null;
}

async function searchGh(query: string) {
  const res = await fetchWithTimeout(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=2`);
  const data = await res.json();
  if (data.items?.length > 0) return `GitHub: ${data.items.map((i: any) => i.full_name).join(' | ')}`;
  return null;
}

async function searchArxiv(query: string) {
  const res = await fetchWithTimeout(`https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=2`);
  const xmlText = await res.text();
  const titles = [...xmlText.matchAll(/<title>(.*?)<\/title>/g)].map(m => m[1]).filter(t => t !== "arXiv Query Result");
  if (titles.length > 0) return `arXiv Papers: ${titles.join(' | ')}`;
  return null;
}

// --- CLAUDE'S HALLUCINATION CHECK ---
const VERIFICATION_CLAIM_PATTERNS = [
  /verified/i,
  /passes? all( the)? tests?/i,
  /tested against/i,
  /ran (this|the) (code|solution)/i,
  /confirmed (to be )?correct/i,
  /0 mismatches/i,
];

function checkForUnverifiedClaims(finalAnswer: string, toolCalls: any[]): { flagged: boolean; note?: string } {
  const claimsVerification = VERIFICATION_CLAIM_PATTERNS.some((re) => re.test(finalAnswer));
  if (!claimsVerification) return { flagged: false };

  const ranExecuteCode = toolCalls.some((c: any) => c.type === "execute_code");

  if (!ranExecuteCode) {
    return {
      flagged: true,
      note: "⚠️ **System Warning:** This response claims the code was tested/verified, but no execute_code tool was actually called in this session. Treat any 'verified' claim above with caution — it may be fabricated."
    };
  }

  return { flagged: false };
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    const { messages, conversationId } = await req.json();
    const userPrompt = messages[messages.length - 1].content;

    let currentConvId = conversationId;

    if (!currentConvId) {
      const newConversation = await prisma.conversation.create({
        data: { userId: session.user.id, title: userPrompt.substring(0, 30) + "..." },
      });
      currentConvId = newConversation.id;
    }

    await prisma.message.create({
      data: { conversationId: currentConvId, role: "user", content: userPrompt },
    });

    const lowerUserPrompt = userPrompt.toLowerCase();

    // --- INSTANT SEARCH TRIGGER ---
    const isSearchIntent = lowerUserPrompt.startsWith("search for") || lowerUserPrompt.includes("search the web") || lowerUserPrompt.startsWith("look up") || lowerUserPrompt.startsWith("search ");

    if (isSearchIntent) {
      let query = userPrompt.replace(/(search for|search the web for|look up|search)/i, "").trim();
      query = query.replace(/["']/g, "").trim();

      const encoder = new TextEncoder();
      const searchStream = new ReadableStream({
        async start(controller) {
          const sendStep = (step: string) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ searchStep: step })}\n\n`));
          sendStep("Wikipedia"); sendStep("DuckDuckGo"); sendStep("Hacker News"); sendStep("StackOverflow"); sendStep("GitHub"); sendStep("arXiv");

          const [wiki, ddg, hn, so, gh, arxiv] = await Promise.all([
            searchWiki(query).catch(() => null), searchDdg(query).catch(() => null), searchHn(query).catch(() => null),
            searchSo(query).catch(() => null), searchGh(query).catch(() => null), searchArxiv(query).catch(() => null)
          ]);

          let searchContext = "";
          if (wiki) searchContext += `${truncate(wiki, 300)}\n\n`;
          if (ddg) searchContext += `${truncate(ddg, 300)}\n\n`;
          if (hn) searchContext += `${truncate(hn, 300)}\n\n`;
          if (so) searchContext += `${truncate(so, 300)}\n\n`;
          if (gh) searchContext += `${truncate(gh, 300)}\n\n`;
          if (arxiv) searchContext += `${truncate(arxiv, 300)}\n\n`;

          let aiText = "";
          if (searchContext) {
            const synthesizeMessages = [
              { role: "system", content: `You searched 6 sources for "${query}". Results:\n\n${searchContext}\n\nSummarize and cite sources.` },
              { role: "user", content: query }
            ];

            try {
              const { result } = await streamWithFallback((model) => ({
                model,
                messages: synthesizeMessages,
                temperature: 0.3,
                maxTokens: 1000,
                maxRetries: 1, 
              }));

              for await (const delta of result.textStream) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`));
                aiText += delta;
              }
            } catch (e: any) {
              aiText = "*(System: All AI providers are currently unavailable or rate-limited. Please try again shortly.)*";
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: aiText } }] })}\n\n`));
            }
          } else {
            aiText = `I searched for "${query}", but couldn't find a direct answer.`;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: aiText } }] })}\n\n`));
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();

          await prisma.message.create({ data: { conversationId: currentConvId, role: "assistant", content: aiText } });
          await prisma.conversation.update({ where: { id: currentConvId }, data: { updatedAt: new Date() } });
        }
      });
      return new Response(searchStream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
    }

    // --- AUTONOMOUS CODE PIPELINE ---
    const isCodingQuestion = lowerUserPrompt.includes("code") || lowerUserPrompt.includes("algorithm") || lowerUserPrompt.includes("trace") || lowerUserPrompt.includes("solve") || lowerUserPrompt.includes("string") || lowerUserPrompt.includes("array") || lowerUserPrompt.includes("tree") || lowerUserPrompt.includes("graph") || lowerUserPrompt.includes("dp");

    if (isCodingQuestion) {
      const systemPrompt = `You are the CS Hub AI, an expert coding assistant.
      MANDATORY DEBUGGING WORKFLOW:
      1. Write your first attempt at the solution.
      2. You MUST invoke the execute_code tool to actually run it.
      3. Read the REAL output/error returned by the tool. Do not guess.
      4. If there is an error, FIX the code and invoke execute_code again. Repeat until correct.
      5. Only after the tool passes should you give your final answer to the user. State what you verified.

      ABSOLUTE RULE ON TOOL USAGE:
      - You CANNOT call tools by writing Python code like "execute_code(...)". That code will never run.
      - You MUST invoke the tool DIRECTLY using the native function calling mechanism (JSON format).
      - You must NEVER write prose claiming code was executed or verified unless you actually invoked the tool directly and are looking at its real returned result.`;

      const recentMessages = messages.slice(-2).map((m: any) => {
        let safeContent = m.content;
        if (safeContent.includes("data:image")) safeContent = "[User attached an image.]";
        return { role: m.role === "assistant" ? "assistant" : "user", content: safeContent };
      });

      const toolCallLog: any[] = [];

      let streamResult;
      let usedProvider = "none";
      try {
        const { result, providerName } = await streamWithFallback((model) => ({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            ...recentMessages
          ],
          temperature: 0.1,
          maxSteps: 3,
          maxTokens: 3000,
          maxRetries: 1,
          toolChoice: 'required',
          tools: {
            execute_code: tool({
              description: 'Executes Python code and returns stdout, stderr, and exit code.',
              parameters: z.object({
                code: z.string().describe('The complete Python code to execute'),
              }),
              execute: async ({ code }) => {
                try {
                  const pistonRes = await fetchWithTimeout("https://emkc.org/api/v2/piston/execute", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      language: "python",
                      version: "3.10.0",
                      files: [{ name: "main.py", content: code }]
                    })
                  }, 15000);

                  if (pistonRes.ok) {
                    const pistonData = await pistonRes.json();
                    const stdout = pistonData.run.output || "";
                    const stderr = pistonData.run.stderr || "";
                    toolCallLog.push({ type: "execute_code", result: { stdout, stderr } });
                    return { stdout, stderr };
                  } else {
                    toolCallLog.push({ type: "execute_code", result: { error: "Sandbox rate limited" } });
                    return { stdout: "", stderr: "Sandbox rate limited or unavailable." };
                  }
                } catch (e) {
                  toolCallLog.push({ type: "execute_code", result: { error: "Network error" } });
                  return { stdout: "", stderr: "Execution network error." };
                }
              }
            })
          }
        }));
        streamResult = result;
        usedProvider = providerName;
      } catch (fallbackError: any) {
        return new Response(
          JSON.stringify({ error: "All AI providers are currently unavailable.", details: fallbackError.message }),
          { status: 503 }
        );
      }

      // Stream the response to the UI
      const encoder = new TextEncoder();
      let fullText = "";
      const customStream = new ReadableStream({
        async start(controller) {
          const heartbeat = setInterval(() => {
            controller.enqueue(encoder.encode(`: heartbeat\n\n`));
          }, 5000);

          try {
            for await (const delta of streamResult.textStream) {
              fullText += delta;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`));
            }
          } catch (streamError: any) {
            console.error(`Stream Interruption (provider: ${usedProvider}):`, streamError);
            const errorMsg = "\n\n*(System: The AI stream was interrupted due to a rate limit or network timeout. Please try again.)*";
            if (!fullText.includes(errorMsg)) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: errorMsg } }] })}\n\n`));
              fullText += errorMsg;
            }
          } finally {
            clearInterval(heartbeat);

            const verificationCheck = checkForUnverifiedClaims(fullText, toolCallLog);
            if (verificationCheck.flagged) {
              const warning = `\n\n${verificationCheck.note}`;
              if (!fullText.includes(warning)) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: warning } }] })}\n\n`));
                fullText += warning;
              }
            }

            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();

            await prisma.message.create({ data: { conversationId: currentConvId, role: "assistant", content: fullText } });
            await prisma.conversation.update({ where: { id: currentConvId }, data: { updatedAt: new Date() } });
          }
        }
      });

      return new Response(customStream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });

    } else {
      // --- NORMAL AI CHAT ---
      const systemPrompt = `You are CS Hub AI, created by Lewis Einstein. If asked who built you, say "I was built by Lewis Einstein." You have TOOLS. Output ONLY the command: 1. [ACTION:CREATE_FLASHCARD] Front: <text> | Back: <text> 2. [ACTION:SAVE_NOTE] Title: <text> | Content: <text> 3. [ACTION:CREATE_ASSIGNMENT] Title: <text> | Due: <YYYY-MM-DDTHH:MM:SS>`;
      const recentMessages = messages.slice(-6);
      const aiMessages = [
        { role: "system", content: systemPrompt },
        ...recentMessages.map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content.includes("data:image") ? "[Image]" : m.content }))
      ];

      let streamResult;
      try {
        const { result } = await streamWithFallback((model) => ({
          model,
          messages: aiMessages,
          temperature: 0.5,
          maxTokens: 2000,
          maxRetries: 1,
        }));
        streamResult = result;
      } catch (fallbackError: any) {
        return new Response(
          JSON.stringify({ error: "All AI providers are currently unavailable.", details: fallbackError.message }),
          { status: 503 }
        );
      }

      const encoder = new TextEncoder();
      let fullText = "";
      const customStream = new ReadableStream({
        async start(controller) {
          for await (const delta of streamResult.textStream) {
            fullText += delta;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`));
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();

          const lowerAiText = fullText.toLowerCase();
          if (lowerAiText.includes("action:create_flashcard") || (lowerUserPrompt.includes("create") && lowerUserPrompt.includes("flashcard"))) {
            const match = fullText.match(/Front:\s*(.*?)\s*\|\s*Back:\s*(.*)/i);
            if (match) {
              await prisma.flashcard.create({ data: { front: match[1].trim(), back: match[2].trim(), userId: session.user.id } });
            }
          } else if (lowerAiText.includes("action:save_note") || (lowerUserPrompt.includes("save") && lowerUserPrompt.includes("note"))) {
            const match = fullText.match(/Title:\s*(.*?)\s*\|\s*Content:\s*(.*)/i);
            if (match) {
              await prisma.note.create({ data: { title: match[1].trim(), content: match[2].trim(), userId: session.user.id } });
            }
          } else if (lowerAiText.includes("action:create_assignment") || (lowerUserPrompt.includes("add") && lowerUserPrompt.includes("assignment"))) {
            const match = fullText.match(/Title:\s*(.*?)\s*\|\s*Due:\s*(.*)/i);
            if (match) {
              const dueDate = new Date(match[2].trim());
              if (!isNaN(dueDate.getTime())) {
                await prisma.assignment.create({ data: { title: match[1].trim(), dueDate, userId: session.user.id } });
              }
            }
          }

          await prisma.message.create({ data: { conversationId: currentConvId, role: "assistant", content: fullText } });
          await prisma.conversation.update({ where: { id: currentConvId }, data: { updatedAt: new Date() } });
        }
      });

      return new Response(customStream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
    }
  } catch (error: any) {
    console.error("Chat API Error:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error", details: error.message }), { status: 500 });
  }
}