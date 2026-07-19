import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';
import vm from 'vm';

// ─── CONFIG ───
const PROVIDERS: { name: string; baseURL: string; apiKeyEnv: string; model: string }[] = [
  { name: "Cerebras", baseURL: "https://api.cerebras.ai/v1", apiKeyEnv: "CEREBRAS_API_KEY", model: process.env.CEREBRAS_MODEL_ID || "llama3.1-8b" },
  { name: "Groq", baseURL: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_API_KEY", model: process.env.GROQ_MODEL_ID || "llama-3.1-8b-instant" },
  { name: "OpenRouter", baseURL: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY", model: process.env.OPENROUTER_MODEL_ID || "deepseek/deepseek-chat-v3:free" },
  { name: "Gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", apiKeyEnv: "GEMINI_API_KEY", model: process.env.GEMINI_MODEL_ID || "gemini-2.5-flash" },
];

async function streamWithFallback(buildArgs: (model: any) => Parameters<typeof streamText>[0]) {
  let lastError: any = null;
  for (const p of PROVIDERS) {
    const key = process.env[p.apiKeyEnv];
    if (!key) continue;
    try {
      const client = createOpenAI({ baseURL: p.baseURL, apiKey: key });
      const result = await streamText(buildArgs(client(p.model)));
      return { result, providerName: p.name };
    } catch (e: any) { lastError = e; continue; }
  }
  throw new Error(`All providers failed: ${lastError?.message || "unknown"}`);
}

function truncate(str: string | null, max: number://api.cerebras.ai/v1", apiKeyEnv: "CEREBRAS_API_KEY", model: process.env.CEREBRAS_MODEL_ID || "llama3.1-8b" },
  { name: "Groq", baseURL: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_API_KEY", model: process.env.GROQ_MODEL_ID || "llama-3.1-8b-instant" },
  { name: "OpenRouter", baseURL: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY", model: process.env.OPENROUTER_MODEL_ID || "deepseek/deepseek-chat-v3:free" },
  { name: "Gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", apiKeyEnv: "GEMINI_API_KEY", model: process.env.GEMINI_MODEL_ID || "gemini-2.5-flash" },
];

async function streamWithFallback(buildArgs: (model: any) => Parameters<typeof streamText>[0]) {
  let lastError: any = null;
  for (const p of PROVIDERS) {
    const key = process.env[p.apiKeyEnv];
    if (!key) continue;
    try {
      const client = createOpenAI({ baseURL: p.baseURL, apiKey: key });
      const result = await streamText(buildArgs(client(p.model)));
      return { result, providerName: p.name };
    } catch (e: any) { lastError = e; continue; }
  }
  throw new Error(`All providers failed: ${lastError?.message || "unknown"}`);
}

function truncate(str: string | null, max: number) {
  return str && str.length > max ? str.substring(0, max) + "..." : str;
}

async function fetchWithTimeout(url: string, options: any = {}, ms = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

// ─── JS EXECUTION ───
function executeJsSafely(code: string) {
  let stdout = "", stderr = "";
  try {
    const sandbox = {
      console: { log: (...a: any[]) => stdout += a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ') + '\n' },
      Math, Date, JSON, Array, Map, Set
    };
    vm.runInContext(code, vm.createContext(sandbox), { timeout: 3000 });
  } catch (e: any) { stderr = e.message; }
  return { stdout, stderr };
}

function extractJsCode(text: string) {
  const m = text.match(/```(?:javascript|js)\s*([\s\S]*?)```/);
  if (m) return m[1].trim();
  const g = text.match(/```\s*([\s\S]*?)```/);
  return g ? g[1].trim() : null;
}

function backendExecute(code: string) {
  try {
    const { stdout, stderr } = executeJsSafely(code);
    return { ok: !stderr, stdout, stderr };
  } catch (e: any) { return { ok: false, stdout: "", stderr: e.message }; }
}

// ─── SEARCH HELPERS ───
async function searchWiki(q: string) {
  try {
    const s = await fetchWithTimeout(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&origin=*`);
    const d = await s.json();
    if (d.query?.search?.[0]) {
      const sum = await fetchWithTimeout(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(d.query.search[0].title)}`);
      const sd = await sum.json();
      if (sd.extract) return `Wikipedia: ${sd.extract}`;
    }
  } catch {}
  return null;
}

async function searchDdg(q: string) {
  try {
    const r = await fetchWithTimeout(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`, { headers: { 'Accept': 'application/json', 'User-Agent': 'CSHubBot/1.0' } });
    const d = await r.json();
    if (d.AbstractText) return `DuckDuckGo: ${d.AbstractText}`;
    if (d.RelatedTopics?.[0]?.Text) return `DuckDuckGo: ${d.RelatedTopics[0].Text}`;
  } catch {}
  return null;
}

async function searchHn(q: string) {
  try {
    const r = await fetchWithTimeout(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=2`);
    const d = await r.json();
    if (d.hits?.length) return `Hacker News: ${d.hits.map((h: any) => h.title).join(' | ')}`;
  } catch {}
  return null;
}

async function searchSo(q: string) {
  try {
    const r = await fetchWithTimeout(`https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(q)}&site=stackoverflow&pagesize=2`);
    const d = await r.json();
    if (d.items?.length) return `StackOverflow: ${d.items.map((i: any) => i.title).join(' | ')}`;
  } catch {}
  return null;
}

async function searchGh(q: string) {
  try {
    const h: Record<string, string> = { 'Accept': 'application/vnd.github.v3+json' };
    if (process.env.GITHUB_TOKEN) h['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
    const r = await fetchWithTimeout(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=2`, { headers: h });
    const d = await r.json();
    if (d.items?.length) return `GitHub: ${d.items.map((i: any) => i.full_name).join(' | ')}`;
  } catch {}
  return null;
}

async function searchArxiv(q: string) {
  try {
    const r = await fetchWithTimeout(`https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&max_results=2`);
    const t = await r.text();
    const titles = [...t.matchAll(/<title>(.*?)<\/title>/g)].map(m => m[1]).filter(t => t !== "arXiv Query Result");
    if (titles.length) return `arXiv Papers: ${titles.join(' | ')}`;
  } catch {}
  return null;
}

// ─── MAIN ROUTE ───
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    const body = await req.json();
    const { messages, conversationId } = body;
    const userPrompt = messages[messages.length - 1].content;
    const lowerUserPrompt = userPrompt.toLowerCase();

    let currentConvId = conversationId;
    if (!currentConvId) {
      const nc = await prisma.conversation.create({ data: { userId: session.user.id, title: userPrompt.substring(0, 30) + "..." } });
      currentConvId = nc.id;
    }

    await prisma.message.create({ data: { conversationId: currentConvId, role: "user", content: userPrompt } });

    // ─── SEARCH ───
    const isSearch = lowerUserPrompt.startsWith("search for") || lowerUserPrompt.includes("search the web") || lowerUserPrompt.startsWith("look up") || lowerUserPrompt.startsWith("search ");
    if (isSearch) {
      const query = userPrompt.replace(/(search for|search the web for|look up|search)/i, "").trim().replace(/["']/g, "").trim();
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({
        async start(controller) {
          const send = (s: string) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ searchStep: s })}\n\n`));
          send("Wikipedia"); send("DuckDuckGo"); send("Hacker News"); send("StackOverflow"); send("GitHub"); send("arXiv");

          const [wiki, ddg, hn, so, gh, arxiv] = await Promise.all([
            searchWiki(query), searchDdg(query), searchHn(query),
            searchSo(query), searchGh(query), searchArxiv(query)
          ]);

          let ctx = "";
          [wiki, ddg, hn, so, gh, arxiv].forEach(r => { if (r) ctx += `${truncate(r, 300)}\n\n`; });

          let aiText = "";
          if (ctx) {
            try {
              const { result } = await streamWithFallback(m => ({ model: m, messages: [{ role: "system", content: `Searched 6 sources for "${query}".\n\n${ctx}\n\nSummarize and cite.` }, { role: "user", content: query }], temperature: 0.3, maxTokens: 1000, maxRetries: 3 }));
              for await (const d of result.textStream) { aiText += d; controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`)); }
            } catch {
              aiText = "*(All AI providers unavailable)*";
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: aiText } }] })}\n\n`));
            }
          } else {
            aiText = `No results for "${query}".`;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: aiText } }] })}\n\n`));
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close();
          try { await prisma.message.create({ data: { conversationId: currentConvId, role: "assistant", content: aiText } }); await prisma.conversation.update({ where: { id: currentConvId }, data: { updatedAt: new Date() } }); } catch (e) { console.error(e); }
        }
      }), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
    }

    // ─── CODING: 4-PHASE ACT ───
    const isCoding = lowerUserPrompt.includes("code") || lowerUserPrompt.includes("algorithm") || lowerUserPrompt.includes("solve") || lowerUserPrompt.includes("function") || lowerUserPrompt.includes("write a") || lowerUserPrompt.includes("dp") || lowerUserPrompt.includes("array") || lowerUserPrompt.includes("tree") || lowerUserPrompt.includes("graph");

    if (isCoding) {
      const encoder = new TextEncoder();
      const MAX_ROUNDS = 2;

      const REASON_PROMPT = `You are an elite software engineer analyzing a coding problem.
Analyze concisely:
- Exact inputs, outputs, constraints
- If sequence constraints exist: "State design must track last move. dp[i] alone is NEVER enough. Use dp[i][last_move][consecutive_count]."
- Step-by-step algorithmic plan
- Time/space complexity
Output ONLY analysis. NO code.`;

      const EXECUTE_PROMPT = `Based on the analysis, write JavaScript solution.
- Single named function
- Include console.log test cases at bottom
Output ONLY the code block.`;

      const CRITIC_PROMPT = `You are a strict code reviewer. Analyze code vs analysis.
- Does code implement the described state design?
- Are ALL constraints enforced?
Score 0-100. Output ONLY score + brief critique.`;

      return new Response(new ReadableStream({
        async start(controller) {
          let recentMessages = messages.slice(-4).map((m: any) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content.includes("data:image") ? "[Image]" : m.content
          }));

          let codingFullText = "";
          let lastCode = "";
          let verified = false;
          let roundsUsed = 0;

          try {
            for (let r = 1; r <= MAX_ROUNDS; r++) {
              roundsUsed = r;

              // REASON
              const reasonHeader = `\n🧠 **REASONING (Round ${r})...**\n\n`;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: reasonHeader } }] })}\n\n`));
              const reasonResult = await streamWithFallback(m => ({ model: m, messages: [{ role: "system", content: REASON_PROMPT }, ...recentMessages], temperature: 0.2, maxTokens: 800, maxRetries: 3 }));
              let reasonText = "";
              for await (const d of reasonResult.result.textStream) { reasonText += d; controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`)); }
              codingFullText += reasonHeader + reasonText;

              // EXECUTE
              const executeHeader = `\n\n💻 **CODING...**\n\n`;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: executeHeader } }] })}\n\n`));
              const executeResult = await streamWithFallback(m => ({ model: m, messages: [{ role: "system", content: EXECUTE_PROMPT }, ...recentMessages, { role: "assistant", content: reasonText }, { role: "user", content: "Write the code now." }], temperature: 0.1, maxTokens: 1200, maxRetries: 3 }));
              let executeText = "";
              for await (const d of executeResult.result.textStream) { executeText += d; controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`)); }
              codingFullText += executeHeader + executeText;

              // CRITIC
              const criticHeader = `\n\n🕵️ **CRITIQUING...**\n\n`;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: criticHeader } }] })}\n\n`));
              const criticResult = await streamWithFallback(m => ({ model: m, messages: [{ role: "system", content: CRITIC_PROMPT }, ...recentMessages, { role: "assistant", content: reasonText }, { role: "assistant", content: executeText }, { role: "user", content: "Critique this code." }], temperature: 0.2, maxTokens: 600, maxRetries: 3 }));
              let criticText = "";
              for await (const d of criticResult.result.textStream) { criticText += d; controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`)); }
              codingFullText += criticHeader + criticText;

              // VERIFY
              const code = extractJsCode(executeText);
              if (!code) {
                const noCodeMsg = `\n\n⚠️ No code block found. Retrying...\n`;
                codingFullText += noCodeMsg; controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: noCodeMsg } }] })}\n\n`)); continue;
              }

              const execResult = backendExecute(code);
              if (execResult.ok) {
                verified = true;
                const verifiedMsg = `\n\n✅ **BACKEND-VERIFIED** — Round ${r} success. Output: \`${execResult.stdout.trim()}\``;
                codingFullText += verifiedMsg; controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: verifiedMsg } }] })}\n\n`)); break;
              }

              const failMsg = `\n\n❌ **VERIFICATION FAILED:** \`${execResult.stderr}\`\n🔄 Re-analyzing...\n`;
              codingFullText += failMsg; controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: failMsg } }] })}\n\n`));

              if (code === lastCode) {
                const stuckMsg = `\n\n⚠️ **Stop condition:** Identical code. Halting.`;
                codingFullText += stuckMsg; controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: stuckMsg } }] })}\n\n`)); break;
              }
              lastCode = code;
              recentMessages = [...recentMessages, { role: "assistant", content: reasonText + "\n" + executeText }, { role: "user", content: `Your code failed:\n\n${execResult.stderr}\n\nFix it.` }];
            }

            if (!verified) {
              const unverifiedMsg = `\n\n⚠️ **Could not verify** after ${roundsUsed} attempts. Try rephrasing.`;
              codingFullText += unverifiedMsg; controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: unverifiedMsg } }] })}\n\n`));
            }
          } catch (e: any) {
            console.error("Stream error:", e);
            const errMsg = "\n\n*(System: Stream interrupted. Please try again.)*";
            if (!codingFullText.includes(errMsg)) { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: errMsg } }] })}\n\n`)); codingFullText += errMsg; }
          } finally {
            controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close();
            try { await prisma.message.create({ data: { conversationId: currentConvId, role: "assistant", content: codingFullText } }); await prisma.conversation.update({ where: { id: currentConvId }, data: { updatedAt: new Date() } }); } catch (e) { console.error(e); }
          }
        }
      }), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
    }

    // ─── NORMAL CHAT ───
    const systemPrompt = `You are CS Hub AI, built by Lewis Einstein (AI/ML Engineer) at Kibabii University. Answer clearly in markdown. Only output action commands when EXPLICITLY asked:
[ACTION:CREATE_FLASHCARD] Front: <text> | Back: <text>
[ACTION:SAVE_NOTE] Title: <text> | Content: <text>
[ACTION:CREATE_ASSIGNMENT] Title: <text> | Due: <YYYY-MM-DDTHH:MM:SS>`;

    const aiMessages = [{ role: "system", content: systemPrompt }, ...messages.slice(-6).map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content.includes("data:image") ? "[Image]" : m.content }))];

    let chatStreamResult;
    try {
      const { result } = await streamWithFallback(m => ({ model: m, messages: aiMessages, temperature: 0.5, maxTokens: 2000, maxRetries: 3 }));
      chatStreamResult = result;
    } catch (e: any) {
      const enc = new TextEncoder();
      return new Response(new ReadableStream({ start(c) { const m = `*(All AI providers unavailable: ${e.message})*`; c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: m } }] })}\n\n`)); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
    }

    const chatEncoder = new TextEncoder();
    let chatFullText = "";
    return new Response(new ReadableStream({
      async start(controller) {
        for await (const d of chatStreamResult.textStream) { chatFullText += d; controller.enqueue(chatEncoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`)); }
        controller.enqueue(chatEncoder.encode('data: [DONE]\n\n')); controller.close();

        const lt = chatFullText.toLowerCase();
        try {
          if ((lt.includes("action:create_flashcard") || (lowerUserPrompt.includes("create") && lowerUserPrompt.includes("flashcard"))) && !chatFullText.includes("[SAVED:FLASHCARD]")) {
            const m = chatFullText.match(/Front:\s*(.*?)\s*\|\s*Back:\s*(.*)/i);
            if (m) { await prisma.flashcard.create({ data: { front: m[1].trim(), back: m[2].trim(), userId: session.user.id } }); chatFullText += "\n[SAVED:FLASHCARD]"; }
          } else if ((lt.includes("action:save_note") || (lowerUserPrompt.includes("save") && lowerUserPrompt.includes("note"))) && !chatFullText.includes("[SAVED:NOTE]")) {
            const m = chatFullText.match(/Title:\s*(.*?)\s*\|\s*Content:\s*(.*)/i);
            if (m) { await prisma.note.create({ data: { title: m[1].trim(), content: m[2].trim(), userId: session.user.id } }); chatFullText += "\n[SAVED:NOTE]"; }
          } else if ((lt.includes("action:create_assignment") || (lowerUserPrompt.includes("add") && lowerUserPrompt.includes("assignment"))) && !chatFullText.includes("[SAVED:ASSIGNMENT]")) {
            const m = chatFullText.match(/Title:\s*(.*?)\s*\|\s*Due:\s*(.*)/i);
            if (m) { const dd = new Date(m[2].trim()); if (!isNaN(dd.getTime())) { await prisma.assignment.create({ data: { title: m[1].trim(), dueDate: dd, userId: session.user.id } }); chatFullText += "\n[SAVED:ASSIGNMENT]"; } }
          }
          await prisma.message.create({ data: { conversationId: currentConvId, role: "assistant", content: chatFullText } });
          await prisma.conversation.update({ where: { id: currentConvId }, data: { updatedAt: new Date() } });
        } catch (e) { console.error(e); }
      }
    }), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });

  } catch (error: any) {
    console.error("API Error:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error", details: error.message }), { status: 500 });
  }
}
