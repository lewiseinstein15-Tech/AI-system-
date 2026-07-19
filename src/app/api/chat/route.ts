import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';
import vm from 'vm';

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
    if (!apiKey) { console.warn(`Skipping ${provider.name}: ${provider.apiKeyEnv} not set`); continue; }
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
  throw new Error(`All providers exhausted. Last error: ${lastError?.message || "unknown"}`);
}

function truncate(str: string | null, max: number) {
  if (!str) return null;
  return str.length > max ? str.substring(0, max) + "..." : str;
}

async function fetchWithTimeout(url: string, options: any = {}, ms: number = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function executeJsSafely(code: string): { stdout: string; stderr: string } {
  let stdout = "";
  let stderr = "";
  try {
    const sandbox = {
      console: { log: (...args: any[]) => { stdout += args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') + '\n'; } },
      Math, Date, JSON, Array, Map, Set
    };
    const context = vm.createContext(sandbox);
    vm.runInContext(code, context, { timeout: 3000 });
  } catch (e: any) { stderr = e.message || "Execution error"; }
  return { stdout, stderr };
}

const MAX_ROUNDS = 2;

function extractJsCode(text: string): string | null {
  const jsMatch = text.match(/```(?:javascript|js)\s*([\s\S]*?)```/);
  if (jsMatch) return jsMatch[1].trim();
  const genericMatch = text.match(/```\s*([\s\S]*?)```/);
  return genericMatch ? genericMatch[1].trim() : null;
}

function backendExecute(code: string): { ok: boolean; stdout: string; stderr: string } {
  try {
    const { stdout, stderr } = executeJsSafely(code);
    return { ok: stderr.length === 0, stdout, stderr };
  } catch (e: any) { return { ok: false, stdout: "", stderr: `Execution error: ${e.message}` }; }
}

async function streamAIState(systemPrompt: string, messages: any[], temperature: number, controller: any, encoder: TextEncoder, header: string): Promise<string> {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: header } }] })}\n\n`));
  const { result } = await streamWithFallback((model) => ({
    model, messages: [{ role: "system", content: systemPrompt }, ...messages], temperature, maxTokens: 2000, maxRetries: 3,
  }));
  let text = "";
  for await (const delta of result.textStream) {
    text += delta;
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`));
  }
  return text;
}

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
  try {
    const res = await fetchWithTimeout(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`, { headers: { 'Accept': 'application/json', 'User-Agent': 'CSHubBot/1.0' } });
    const data = await res.json();
    if (data.AbstractText) return `DuckDuckGo: ${data.AbstractText}`;
    if (data.RelatedTopics?.[0]?.Text) return `DuckDuckGo: ${data.RelatedTopics[0].Text}`;
    return null;
  } catch { return null; }
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
  const headers: Record<string, string> = { 'Accept': 'application/vnd.github.v3+json' };
  if (process.env.GITHUB_TOKEN) headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
  const res = await fetchWithTimeout(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=2`, { headers });
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
      const newConversation = await prisma.conversation.create({ data: { userId: session.user.id, title: userPrompt.substring(0, 30) + "..." } });
      currentConvId = newConversation.id;
    }

    await prisma.message.create({ data: { conversationId: currentConvId, role: "user", content: userPrompt } });
    const lowerUserPrompt = userPrompt.toLowerCase();

    const isSearchIntent = lowerUserPrompt.startsWith("search for") || lowerUserPrompt.includes("search the web") || lowerUserPrompt.startsWith("look up") || lowerUserPrompt.startsWith("search ");

    if (isSearchIntent) {
      let query = userPrompt.replace(/(search for|search the web for|look up|search)/i, "").trim().replace(/["']/g, "").trim();
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
              const { result } = await streamWithFallback((model) => ({ model, messages: synthesizeMessages, temperature: 0.3, maxTokens: 1000, maxRetries: 3 }));
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
          try {
            await prisma.message.create({ data: { conversationId: currentConvId, role: "assistant", content: aiText } });
            await prisma.conversation.update({ where: { id: currentConvId }, data: { updatedAt: new Date() } });
          } catch (dbError) { console.error("Failed to save search message:", dbError); }
        }
      });
      return new Response(searchStream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
    }

    const isCodingQuestion = lowerUserPrompt.includes("code") || lowerUserPrompt.includes("algorithm") || lowerUserPrompt.includes("trace") || lowerUserPrompt.includes("solve") || lowerUserPrompt.includes("string") || lowerUserPrompt.includes("array") || lowerUserPrompt.includes("tree") || lowerUserPrompt.includes("graph") || lowerUserPrompt.includes("dp");

    if (isCodingQuestion) {
      let recentMessages = messages.slice(-4).map((m: any) => {
        let safeContent = m.content;
        if (safeContent.includes("data:image")) safeContent = "[User attached an image.]";
        return { role: m.role === "assistant" ? "assistant" : "user", content: safeContent };
      });

      const REASON_PROMPT = `You are an elite software engineer analyzing a coding problem.
Analyze the problem concisely:
- What are the exact inputs, outputs, and constraints?
- If there are sequence constraints, you MUST state: "State design must track the last move. Position alone (dp[i]) is NEVER enough. I will use dp[i][last_move] [consecutive_count]."
- What is the step-by-step algorithmic plan?
- What is the time and space complexity?
YOU MAY ONLY OUTPUT ONE PHASE. Do NOT write any code. Output ONLY analysis and a plan.`;

      const EXECUTE_PROMPT = `Based on the analysis, write the JavaScript solution.
- Wrap your solution in a single named function.
- Include a few \`console.log()\` test cases at the bottom of the code block.
YOU MAY ONLY OUTPUT ONE PHASE. Output ONLY the code block.`;

      const CRITIC_PROMPT = `You are a strict code reviewer. Analyze the provided code and analysis.
- Does the code actually implement the state design described in the analysis?
- Does the code enforce all constraints?
Score the code from 0 to 100.
YOU MAY ONLY OUTPUT ONE PHASE. Output ONLY the score and a brief critique.`;

      const encoder = new TextEncoder();
      let fullText = "", verified = false, roundsUsed = 0, lastCode = "";

      const customStream = new ReadableStream({
        async start(controller) {
          const heartbeat = setInterval(() => { controller.enqueue(encoder.encode(`: heartbeat\n\n`)); }, 5000);
          try {
            for (let round = 1; round <= MAX_ROUNDS; round++) {
              roundsUsed = round;
              const reasonHeader = `\n🧠 **REASONING (Round ${round})...**\n\n`;
              const reasonText = await streamAIState(REASON_PROMPT, recentMessages, 0.2, controller, encoder, reasonHeader);
              fullText += reasonHeader + reasonText;

              const executeHeader = `\n\n💻 **CODING...**\n\n`;
              const executeText = await streamAIState(EXECUTE_PROMPT, [...recentMessages, { role: "assistant", content: reasonText }, { role: "user", content: "Write the code now." }], 0.1, controller, encoder, executeHeader);
              fullText += executeHeader + executeText;

              const criticHeader = `\n\n🕵️ **CRITIQUING...**\n\n`;
              const criticText = await streamAIState(CRITIC_PROMPT, [...recentMessages, { role: "assistant", content: reasonText }, { role: "assistant", content: executeText }, { role: "user", content: "Critique this code." }], 0.2, controller, encoder, criticHeader);
              fullText += criticHeader + criticText;

              const code = extractJsCode(executeText);
              if (!code) {
                const noCodeMsg = `\n\n⚠️ No code block found. Retrying...\n`;
                fullText += noCodeMsg;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: noCodeMsg } }] })}\n\n`));
                continue;
              }

              const execResult = backendExecute(code);
              if (execResult.ok) {
                verified = true;
                const verifiedMsg = `\n\n✅ **BACKEND-VERIFIED** — Code was independently re-executed by the server (Round ${round}) and confirmed to run without error. Real output: \`${execResult.stdout.trim()}\``;
                fullText += verifiedMsg;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: verifiedMsg } }] })}\n\n`));
                break;
              }

              const failMsg = `\n\n❌ **VERIFICATION FAILED:** \`${execResult.stderr}\`\n🔄 Re-analyzing the problem...\n`;
              fullText += failMsg;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: failMsg } }] })}\n\n`));

              if (code === lastCode) {
                const stuckMsg = `\n\n⚠️ **Stop condition triggered:** Code is identical to previous attempt. Stopping to prevent infinite loop.`;
                fullText += stuckMsg;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: stuckMsg } }] })}\n\n`));
                break;
              }
              lastCode = code;
              recentMessages = [...recentMessages, { role: "assistant", content: reasonText + "\n" + executeText }, { role: "user", content: `Your code failed with this REAL error:\n\n${execResult.stderr}\n\nRe-analyze and fix it.` }];
            }
            if (!verified) {
              const unverifiedMsg = `\n\n⚠️ **Could not fully verify this solution.** After ${roundsUsed} attempts, the backend could not get this code to execute successfully. Please try rephrasing the question.`;
              fullText += unverifiedMsg;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: unverifiedMsg } }] })}\n\n`));
            }
          } catch (streamError: any) {
            console.error("Stream Interruption:", streamError);
            const errorMsg = "\n\n*(System: The AI stream was interrupted. Please try again.)*";
            if (!fullText.includes(errorMsg)) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: errorMsg } }] })}\n\n`));
              fullText += errorMsg;
            }
          } finally {
            clearInterval(heartbeat);
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
            try {
              await prisma.message.create({ data: { conversationId: currentConvId, role: "assistant", content: fullText } });
              await prisma.conversation.update({ where: { id: currentConvId }, data: { updatedAt: new Date() } });
            } catch (dbError) { console.error("Failed to save coding message:", dbError); }
          }
        }
      });
      return new Response(customStream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
    } else {
      const systemPrompt = `You are CS Hub AI, an elite assistant created by Lewis Einstein (AI/ML Engineer) for Kibabii University. 
      If asked who built you, say "I was built by Lewis Einstein, an AI and ML Engineer."
      You are a helpful, conversational AI. Answer questions clearly using markdown. 
      You have special commands (tools) that you can use to save things to the user's dashboard. You MUST ONLY output these commands if the user EXPLICITLY asks you to do so. Do not output these commands just to explain what you can do. 
      Commands:
      - If the user explicitly says "create flashcard" or "save flashcard", output ONLY: [ACTION:CREATE_FLASHCARD] Front: <text> | Back: <text>
      - If the user explicitly says "save note" or "create note", output ONLY: [ACTION:SAVE_NOTE] Title: <text> | Content: <text>
      - If the user explicitly says "add assignment" or "schedule assignment", output ONLY: [ACTION:CREATE_ASSIGNMENT] Title: <text> | Due: <YYYY-MM-DDTHH:MM:SS>
      If the user just asks a general question (like "What can you do?"), explain your capabilities in plain English. Do not output the raw command syntax unless you are actually performing the action.`;

      const recentMessages = messages.slice(-6);
      const aiMessages = [{ role: "system", content: systemPrompt }, ...recentMessages.map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content.includes("data:image") ? "[Image]" : m.content }))];

      let streamResult;
      try {
        const { result } = await streamWithFallback((model) => ({ model, messages: aiMessages, temperature: 0.5, maxTokens: 2000, maxRetries: 3 }));
        streamResult = result;
      } catch (fallbackError: any) {
        const encoder = new TextEncoder();
        const errorStream = new ReadableStream({
          start(controller) {
            const errorMsg = `*(System: All AI providers are currently unavailable. Details: ${fallbackError.message})*`;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: errorMsg } }] })}\n\n`));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          }
        });
        return new Response(errorStream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
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
          const hasFlashcardAction = lowerAiText.includes("action:create_flashcard");
          const userWantsFlashcard = lowerUserPrompt.includes("create") && lowerUserPrompt.includes("flashcard");
          const hasNoteAction = lowerAiText.includes("action:save_note");
          const userWantsNote = lowerUserPrompt.includes("save") && lowerUserPrompt.includes("note");
          const hasAssignmentAction = lowerAiText.includes("action:create_assignment");
          const userWantsAssignment = lowerUserPrompt.includes("add") && lowerUserPrompt.includes("assignment");

          try {
            if ((hasFlashcardAction || userWantsFlashcard) && !fullText.includes("[SAVED:FLASHCARD]")) {
              const match = fullText.match(/Front:\s*(.*?)\s*\|\s*Back:\s*(.*)/i);
              if (match) { await prisma.flashcard.create({ data: { front: match[1].trim(), back: match[2].trim(), userId: session.user.id } }); fullText += "\n[SAVED:FLASHCARD]"; }
            } else if ((hasNoteAction || userWantsNote) && !fullText.includes("[SAVED:NOTE]")) {
              const match = fullText.match(/Title:\s*(.*?)\s*\|\s*Content:\s*(.*)/i);
              if (match) { await prisma.note.create({ data: { title: match[1].trim(), content: match[2].trim(), userId: session.user.id } }); fullText += "\n[SAVED:NOTE]"; }
            } else if ((hasAssignmentAction || userWantsAssignment) && !fullText.includes("[SAVED:ASSIGNMENT]")) {
              const match = fullText.match(/Title:\s*(.*?)\s*\|\s*Due:\s*(.*)/i);
              if (match) {
                const dueDate = new Date(match[2].trim());
                if (!isNaN(dueDate.getTime())) { await prisma.assignment.create({ data: { title: match[1].trim(), dueDate, userId: session.user.id } }); fullText += "\n[SAVED:ASSIGNMENT]"; }
              }
            }
            await prisma.message.create({ data: { conversationId: currentConvId, role: "assistant", content: fullText } });
            await prisma.conversation.update({ where: { id: currentConvId }, data: { updatedAt: new Date() } });
          } catch (dbError) { console.error("Failed to save chat message:", dbError); }
        }
      });
      return new Response(customStream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
    }
  } catch (error: any) {
    console.error("Chat API Error:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error", details: error.message }), { status: 500 });
  }
}
