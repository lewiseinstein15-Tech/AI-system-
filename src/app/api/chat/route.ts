import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';
import vm from 'vm';

// ============================================================
// MULTI-PROVIDER FALLBACK
// ============================================================

type ProviderConfig = {
  name: string;
  baseURL: string;
  apiKeyEnv: string;
  model: string;
};

const PROVIDERS: ProviderConfig[] = [
  { name: "Cerebras", baseURL: "https://api.cerebras.ai/v1", apiKeyEnv: "CEREBRAS_API_KEY", model: process.env.CEREBRAS_MODEL_ID || "llama3.1-8b" },
  { name: "Groq", baseURL: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_API_KEY", model: process.env.GROQ_MODEL_ID || "llama-3.1-8b-instant" },
  { name: "OpenRouter", baseURL: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY", model: process.env.OPENROUTER_MODEL_ID || "deepseek/deepseek-chat-v3:free" },
  { name: "Gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", apiKeyEnv: "GEMINI_API_KEY", model: process.env.GEMINI_MODEL_ID || "gemini-2.5-flash" },
];

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

// --- LOCAL JAVASCRIPT EXECUTION ENGINE ---
function executeJsSafely(code: string): { stdout: string; stderr: string } {
  let stdout = "";
  let stderr = "";
  try {
    const sandbox = {
      console: {
        log: (...args: any[]) => { stdout += args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') + '\n'; }
      },
      Math: Math,
      Date: Date,
      JSON: JSON
    };
    
    const context = vm.createContext(sandbox);
    vm.runInContext(code, context, { timeout: 3000 });
  } catch (e: any) {
    stderr = e.message || "Execution error";
  }
  return { stdout, stderr };
}

// ============================================================
// THE VERIFICATION LOOP (CLAUDE'S ARCHITECTURE + LOCAL JS)
// ============================================================

const MAX_LOOP_ROUNDS = 3;

function extractJsCode(text: string): string | null {
  const match = text.match(/```javascript\s*([\s\S]*?)```/) || text.match(/```\s*([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}

function extractFunctionName(code: string): string | null {
  const match = code.match(/function\s+(\w+)\s*\(/);
  return match ? match[1] : null;
}

// Independently re-executes code LOCALLY. Does not rely on anything the model claims.
function backendExecute(code: string, funcName: string): { ok: boolean; stdout: string; stderr: string } {
  // Build a test harness that actually calls the AI's function with a test input
  const testInput = `"a1b2c3"`; // Test string input
  const harness = `${code}\n\nconsole.log(${funcName}(${testInput}));`;
  try {
    const { stdout, stderr } = executeJsSafely(harness);
    return { ok: stderr.length === 0, stdout, stderr };
  } catch (e: any) {
    return { ok: false, stdout: "", stderr: `Execution error: ${e.message}` };
  }
}

// Runs the model in a loop: generate -> backend-verify -> if failed,
// feed the REAL error back and force a fix -> repeat until it actually works.
async function verificationLoop(
  systemPrompt: string,
  userMessages: any[]
): Promise<{ finalText: string; verified: boolean; rounds: number; log: string[] }> {
  const log: string[] = [];
  let messages = [...userMessages];
  let lastText = "";

  for (let round = 1; round <= MAX_LOOP_ROUNDS; round++) {
    const { result } = await streamWithFallback((model) => ({
      model,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      temperature: 0.1,
      maxTokens: 2000,
      maxRetries: 1,
    }));

    let text = "";
    for await (const delta of result.textStream) text += delta;
    lastText = text;

    const code = extractJsCode(text);
    if (!code) {
      log.push(`Round ${round}: no code block found in model output.`);
      messages.push({ role: "assistant", content: text });
      messages.push({ role: "user", content: "You did not provide a javascript code block. Provide one now, wrapped in triple backticks." });
      continue;
    }

    const funcName = extractFunctionName(code);
    if (!funcName) {
      log.push(`Round ${round}: could not detect a function definition.`);
      messages.push({ role: "assistant", content: text });
      messages.push({ role: "user", content: "Your code has no detectable function definition. Wrap your solution in a single named function." });
      continue;
    }

    const execResult = backendExecute(code, funcName);

    if (execResult.ok) {
      log.push(`Round ${round}: backend execution succeeded. Real stdout: ${execResult.stdout}`);
      return { finalText: text, verified: true, rounds: round, log };
    }

    // Real failure — feed the REAL error back, not a hint, the actual stderr.
    log.push(`Round ${round}: backend execution FAILED. Real stderr: ${execResult.stderr}`);
    messages.push({ role: "assistant", content: text });
    messages.push({
      role: "user",
      content: `Your code failed when actually executed by the backend. This is the REAL error, not a simulation:\n\n${execResult.stderr}\n\nFix the code. Do not claim success until this actually stops erroring.`,
    });
  }

  return { finalText: lastText, verified: false, rounds: MAX_LOOP_ROUNDS, log };
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
      const systemPrompt = `You are CS Hub AI, an expert coding assistant. 
      When asked a coding question, write the solution in JavaScript inside a markdown block. 
      Explain your approach, state design, and time/space complexity. 
      DO NOT write a "Verification" section. DO NOT claim to have run or verified the code. 
      The backend system will automatically run and verify your code independently.`;

      const recentMessages = messages.slice(-4).map((m: any) => {
        let safeContent = m.content;
        if (safeContent.includes("data:image")) safeContent = "[User attached an image.]";
        return { role: m.role === "assistant" ? "assistant" : "user", content: safeContent };
      });

      // ── THE VERIFICATION LOOP RUNS HERE ──
      const loopResult = await verificationLoop(
        systemPrompt,
        recentMessages
      );

      const encoder = new TextEncoder();
      let fullText = loopResult.finalText;
      
      // Append verification stamp
      if (loopResult.verified) {
        fullText += `\n\n✅ **Backend-verified** — this code was independently re-executed by the server (${loopResult.rounds} round${loopResult.rounds > 1 ? "s" : ""} needed) and confirmed to run without error. This is not a self-reported claim from the AI.`;
      } else {
        fullText += `\n\n⚠️ **Could not verify this solution.** After ${loopResult.rounds} attempts, the backend still could not get this code to execute successfully. Do not treat this as a correct answer — please try again or rephrase the question.`;
      }

      const customStream = new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: fullText } }] })}\n\n`));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();

          console.log("Verification loop log:", loopResult.log);

          await prisma.message.create({ data: { conversationId: currentConvId, role: "assistant", content: fullText } });
          await prisma.conversation.update({ where: { id: currentConvId }, data: { updatedAt: new Date() } });
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
          maxRetries: 2
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