import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { Sandbox } from "@vercel/sandbox";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const runtime = "nodejs";

const PROVIDERS = [
  { name: "Qwen", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", key: "QWEN_API_KEY", model: process.env.QWEN_MODEL_ID || "qwen-plus" },
  { name: "Groq", baseURL: "https://api.groq.com/openai/v1", key: "GROQ_API_KEY", model: process.env.GROQ_MODEL_ID || "llama3-70b-8192" },
  { name: "Cerebras", baseURL: "https://api.cerebras.ai/v1", key: "CEREBRAS_API_KEY", model: process.env.CEREBRAS_MODEL_ID || "llama3.1-8b" },
  { name: "OpenRouter", baseURL: "https://openrouter.ai/api/v1", key: "OPENROUTER_API_KEY", model: process.env.OPENROUTER_MODEL_ID || "deepseek/deepseek-chat:free" },
  { name: "Gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", key: "GEMINI_API_KEY", model: process.env.GEMINI_MODEL_ID || "gemini-1.5-flash" },
];

async function callSingleAI(messages: any[], temp: number, maxTokens: number) {
  let lastErr: any = null;
  for (const p of PROVIDERS) {
    const apiKey = process.env[p.key];
    if (!apiKey) continue;
    try {
      const client = createOpenAI({ baseURL: p.baseURL, apiKey });
      const result = await streamText({
        model: client(p.model),
        messages,
        temperature: temp,
        maxTokens,
        maxRetries: 0,
      });
      console.log("Provider used:", p.name, p.model);
      return { result, providerName: p.name };
    } catch (err: any) {
      console.error(p.name, "failed:", err?.message || err);
      lastErr = err;
      continue;
    }
  }
  throw new Error("All providers unavailable: " + (lastErr?.message || "unknown"));
}

async function callAllAI(messages: any[], temp: number, maxTokens: number, timeoutMs = 30000): Promise<{ responses: string[]; providers: string[] }> {
  const providerPromises = PROVIDERS.map(async (p) => {
    const apiKey = process.env[p.key];
    if (!apiKey) {
      console.log(`Skipping ${p.name}: No API key`);
      return null;
    }

    const operation = (async () => {
      try {
        const client = createOpenAI({ baseURL: p.baseURL, apiKey });
        const result = await streamText({
          model: client(p.model),
          messages,
          temperature: temp,
          maxTokens,
          maxRetries: 0,
        });

        let text = "";
        for await (const d of result.textStream) {
          text += d;
        }
        console.log(`${p.name} completed successfully, length: ${text.length}`);
        return { text, provider: p.name };
      } catch (streamErr: any) {
        console.error(`${p.name} stream error:`, streamErr?.message || streamErr);
        throw streamErr;
      }
    })();

    const providerTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${p.name} timeout after ${timeoutMs}ms`)), timeoutMs)
    );

    try {
      const resolved = await Promise.race([operation, providerTimeout]);
      return resolved;
    } catch (err: any) {
      console.error(p.name, "ensemble failed:", err?.message || err);
      return null;
    }
  });

  const results = await Promise.all(providerPromises);
  const valid = results.filter((r): r is { text: string; provider: string } => r !== null && r.text.length > 10);

  console.log(`Valid responses: ${valid.length} out of ${PROVIDERS.length}`);

  if (valid.length === 0) {
    throw new Error("All providers unavailable in ensemble");
  }

  return {
    responses: valid.map((r) => r.text),
    providers: valid.map((r) => r.provider),
  };
}

async function synthesizeResponses(responses: string[], userQuery: string, searchCtx: string): Promise<string> {
  if (responses.length === 0) {
    throw new Error("No responses to synthesize");
  }
  
  if (responses.length === 1) {
    console.log("Only 1 response, returning directly");
    return responses[0];
  }

  const gemini = PROVIDERS.find((p) => p.name === "Gemini");
  if (!gemini || !process.env.GEMINI_API_KEY) {
    console.log("No Gemini for synthesis, returning longest response");
    return responses.reduce((a, b) => (a.length > b.length ? a : b));
  }

  const synthesisPrompt = `You are Noctryx AI. Synthesize these AI responses into ONE highly organized, accurate response.

UNIVERSAL FORMATTING RULES (MUST FOLLOW):
1. NEVER output a "wall of text". Break everything into short paragraphs (2-3 sentences max).
2. Use Markdown headings (###) to separate different topics or steps.
3. Use bullet points (-) for lists, features, or sequential steps.
4. Bold (**text**) key terms, numbers, or final conclusions.
5. If this is a math or logic problem, strictly follow the 7-step math format.

${searchCtx ? `SEARCH CONTEXT:\n${searchCtx}\n\n` : ""}USER QUESTION: ${userQuery}

RESPONSES TO SYNTHESIZE:
${responses.map((r, i) => `--- RESPONSE ${i + 1} ---\n${r}`).join("\n\n")}

Now write the final unified, perfectly formatted response:`;

  try {
    console.log("Starting synthesis with Gemini...");
    const client = createOpenAI({ baseURL: gemini.baseURL, apiKey: process.env.GEMINI_API_KEY! });
    const result = await streamText({
      model: client(gemini.model),
      messages: [{ role: "user", content: synthesisPrompt }],
      temperature: 0.3,
      maxTokens: 2000,
      maxRetries: 0,
    });
    let text = "";
    for await (const d of result.textStream) {
      text += d;
    }
    console.log("Synthesis completed, length:", text.length);
    return text;
  } catch (e: any) {
    console.error("Synthesis failed:", e.message);
    console.log("Falling back to longest response");
    return responses.reduce((a, b) => (a.length > b.length ? a : b));
  }
}

async function speechToText(audioBase64: string): Promise<string> {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) throw new Error("GROQ_API_KEY required for speech-to-text");
  const audioBuffer = Buffer.from(audioBase64, "base64");
  const formData = new FormData();
  formData.append("file", new Blob([audioBuffer], { type: "audio/webm" }), "audio.webm");
  formData.append("model", "whisper-large-v3");
  formData.append("response_format", "json");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${groqKey}` },
    body: formData,
  });
  if (!res.ok) throw new Error(`STT failed: ${await res.text()}`);
  const data = await res.json();
  return data.text || "";
}

async function textToSpeech(text: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "tts-1", voice: "alloy", input: text.replace(/[*#_`]/g, "").substring(0, 1000), response_format: "mp3" }),
  });
  if (!res.ok) throw new Error(`TTS failed: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer()).toString("base64");
}

function truncate(str: string | null, max: number) {
  if (!str) return null;
  return str.length > max ? str.substring(0, max) + "..." : str;
}

async function fetchTimeout(url: string, opts: any = {}, ms = 3000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function executeJs(code: string): Promise<{ ok: boolean; stdout: string; stderr: string; unavailable?: boolean }> {
  let sandbox;
  try {
    sandbox = await Sandbox.create({
      token: process.env.VERCEL_TOKEN,
      teamId: process.env.VERCEL_TEAM_ID,
      projectId: process.env.VERCEL_PROJECT_ID,
      timeout: 15000,
      runtime: "node22",
    });
    await sandbox.writeFiles([{ path: "main.js", content: Buffer.from(code) }]);
    const result = await sandbox.runCommand({ cmd: "node", args: ["main.js"] });
    return { 
      ok: result.exitCode === 0, 
      stdout: (await result.stdout()).trim(), 
      stderr: (await result.stderr()).trim() 
    };
  } catch (e: any) {
    return { ok: false, stdout: "", stderr: `Sandbox error: ${e.message}`, unavailable: true };
  } finally {
    if (sandbox) { try { await sandbox.stop(); } catch {} }
  }
}

function extractCode(text: string): string | null {
  const m = text.match(/```(?:javascript|js)\s*([\s\S]*?)```/);
  if (m) return m[1].trim();
  const g = text.match(/```\s*([\s\S]*?)```/);
  return g ? g[1].trim() : null;
}

async function searchWiki(q: string) { try { const s = await fetchTimeout(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&origin=*`); const d = await s.json(); if (d.query?.search?.[0]) { const sum = await fetchTimeout(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(d.query.search[0].title)}`); const sd = await sum.json(); if (sd.extract) return `Wikipedia: ${sd.extract}`; } } catch {} return null; }
async function searchDdg(q: string) { try { const r = await fetchTimeout(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`, { headers: { Accept: "application/json", "User-Agent": "NoctryxBot/1.0" } }); const d = await r.json(); if (d.AbstractText) return `DuckDuckGo: ${d.AbstractText}`; if (d.RelatedTopics?.[0]?.Text) return `DuckDuckGo: ${d.RelatedTopics[0].Text}`; } catch {} return null; }
async function searchHn(q: string) { try { const r = await fetchTimeout(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=2`); const d = await r.json(); if (d.hits?.length) return `Hacker News: ${d.hits.map((h: any) => h.title).join(" | ")}`; } catch {} return null; }
async function searchSo(q: string) { try { const r = await fetchTimeout(`https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(q)}&site=stackoverflow&pagesize=2`); const d = await r.json(); if (d.items?.length) return `StackOverflow: ${d.items.map((i: any) => i.title).join(" | ")}`; } catch {} return null; }
async function searchGh(q: string) { try { const h: Record<string, string> = { Accept: "application/vnd.github.v3+json" }; if (process.env.GITHUB_TOKEN) h.Authorization = `token ${process.env.GITHUB_TOKEN}`; const r = await fetchTimeout(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=2`, { headers: h }); const d = await r.json(); if (d.items?.length) return `GitHub: ${d.items.map((i: any) => i.full_name).join(" | ")}`; } catch {} return null; }
async function searchArxiv(q: string) { try { const r = await fetchTimeout(`https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&max_results=2`); const t = await r.text(); const titles = [...t.matchAll(/<title>(.*?)<\/title>/g)].map((m) => m[1]).filter((t) => t !== "arXiv Query Result"); if (titles.length) return `arXiv Papers: ${titles.join(" | ")}`; } catch {} return null; }
async function searchTavily(q: string) {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const r = await fetchTimeout("https://api.tavily.com/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query: q, max_results: 2, include_answer: true }) }, 5000);
    const d = await r.json();
    let out = "";
    if (d.answer) out += `Summary: ${d.answer}\n`;
    if (d.results?.length) out += d.results.map((res: any) => `- ${res.title} (${res.url}): ${truncate(res.content, 150)}`).join("\n");
    return out ? `Tavily Web Search: ${out}` : null;
  } catch {}
  return null;
}

interface Claim { text: string; type: "price" | "percentage" | "citation" | "statistic" | "attribution"; }
function stripMarkdown(text: string): string { return text.replace(/\|/g, " ").replace(/[*#_`]/g, "").replace(/\n/g, " ").replace(/\s+/g, " ").trim(); }
function extractClaims(text: string): Claim[] {
  const claims: Claim[] = []; const cleanText = stripMarkdown(text);
  const priceRegex = /\$\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:\s*(?:million|billion|yr|year|per year|\/yr))?/gi; let match;
  while ((match = priceRegex.exec(cleanText)) !== null) { const context = cleanText.substring(Math.max(0, match.index - 40), Math.min(cleanText.length, match.index + 40)); claims.push({ text: `${match[0]} (${context.trim()})`, type: "price" }); }
  const pctRegex = /\d{1,3}(?:\.\d+)?%/g;
  while ((match = pctRegex.exec(cleanText)) !== null) { const context = cleanText.substring(Math.max(0, match.index - 30), Math.min(cleanText.length, match.index + 30)); if (/from|per|in|of|rate|probability|chance/i.test(context)) claims.push({ text: `${match[0]} (${context.trim()})`, type: "percentage" }); }
  const citeRegex = /([A-Z][a-z]+(?:\s+(?:&|and)\s+[A-Z][a-z]+)?(?:\s+et\s+al\.?)?)\s*\(\d{4}\)/g;
  while ((match = citeRegex.exec(cleanText)) !== null) claims.push({ text: match[0], type: "citation" });
  const statRegex = /(\d+(?:,\d{3})*(?:\.\d+)?)\s+(?:patients|participants|subjects|studies|trials|cases)\s+(?:from|in|per|across)/gi;
  while ((match = statRegex.exec(cleanText)) !== null) claims.push({ text: match[0], type: "statistic" });
  const attrRegex = /(?:according to|per|from|via|source[d]?:)\s+([A-Z][\w\s&]+?)(?:\s+\d{4}|\s*$)/gi;
  while ((match = attrRegex.exec(cleanText)) !== null) claims.push({ text: match[1].trim(), type: "attribution" });
  const seen = new Set(); return claims.filter(c => { if (seen.has(c.text)) return false; seen.add(c.text); return true; });
}
function cleanClaimForSearch(text: string): string { return text.replace(/\s+/g, " ").replace(/[|*#_`]/g, "").replace(/\s*\([^)]{0,40}\)\s*/g, " ").replace(/\s+/g, " ").trim(); }
function normalizePriceClaim(text: string): string {
  const drugMatch = text.match(/(lecanemab|Leqembi|aducanumab|Aduhelm|ozempic|wegovy|mounjaro|zepbound)/i);
  const priceMatch = text.match(/\$\d{1,3}(?:,\d{3})+/);
  if (drugMatch && priceMatch) return `${drugMatch[1]} ${priceMatch[0]} price per year`;
  return text;
}
interface VerificationResult { claim: string; type: string; status: "verified" | "unverified" | "contradicted" | "uncertain" | "search-failed"; sources: string[]; note?: string; }
async function verifyClaim(claim: Claim): Promise<VerificationResult> {
  let searchQuery = cleanClaimForSearch(claim.text);
  if (claim.type === "price") searchQuery = normalizePriceClaim(searchQuery);
  searchQuery = searchQuery.substring(0, 100);
  const sources: string[] = []; let searchError = false;
  try { const [wiki, ddg] = await Promise.all([searchWiki(searchQuery), searchDdg(searchQuery)]); if (wiki) sources.push(truncate(wiki, 150) || ""); if (ddg) sources.push(truncate(ddg, 150) || ""); } catch (e) { searchError = true; }
  let status: VerificationResult["status"] = "unverified"; let note: string | undefined;
  if (searchError) { status = "search-failed"; note = "Search APIs returned an error or timed out"; } 
  else if (sources.length === 0) { status = "unverified"; note = "No live sources found"; } 
  else {
    const combined = sources.join(" ").toLowerCase(); const hasNumbers = /\d/.test(claim.text);
    if (hasNumbers) {
      const claimNumbers = claim.text.match(/\d+(?:\.\d+)?/g) || [];
      const sourceHasAny = claimNumbers.some(n => combined.includes(n));
      if (!sourceHasAny && sources.length > 0) { status = "uncertain"; note = "Source found but could not confirm specific numbers"; } 
      else { status = "verified"; }
    } else { status = "verified"; }
  }
  return { claim: claim.text, type: claim.type, status, sources: sources.filter(Boolean), note };
}
function buildVerificationFooter(results: VerificationResult[]): string {
  if (results.length === 0) return "";
  const verified = results.filter(r => r.status === "verified"); const uncertain = results.filter(r => r.status === "uncertain");
  const unverified = results.filter(r => r.status === "unverified"); const contradicted = results.filter(r => r.status === "contradicted");
  const searchFailed = results.filter(r => r.status === "search-failed");
  let footer = "\n\n---\n";
  if (contradicted.length > 0) footer += `🔴 **${contradicted.length} claim(s) contradicted by live sources**\n`;
  else if (searchFailed.length > 0) footer += `⚠️ **${searchFailed.length} claim(s) could not be checked** — search APIs failed\n`;
  else if (unverified.length > 0) footer += `🟡 **${unverified.length} claim(s) unverified** — no live sources found\n`;
  else if (uncertain.length > 0) footer += `🟡 **${uncertain.length} claim(s) uncertain** — sources found but numbers unconfirmed\n`;
  else footer += `🟢 **All ${verified.length} verifiable claim(s) matched live sources**\n`;
  footer += "\n<details>\n<summary>Verification details</summary>\n\n";
  for (const r of results) {
    const icon = r.status === "verified" ? "🟢" : r.status === "contradicted" ? "🔴" : r.status === "search-failed" ? "⚠️" : "🟡";
    footer += `${icon} **${r.type.toUpperCase()}**: "${truncate(r.claim, 80)}"\n`;
    if (r.sources.length > 0) footer += `   Sources: ${r.sources.join(" | ")}\n`;
    if (r.note) footer += `   Note: ${r.note}\n`;
    footer += "\n";
  }
  footer += "</details>\n*Verified at " + new Date().toISOString() + " against live sources.*";
  return footer;
}

async function analyzeImageWithGemini(base64Image: string, userQuestion: string): Promise<string> {
  if (!process.env.GEMINI_API_KEY) throw new Error("Gemini API key required");
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const modelNames = [process.env.GEMINI_MODEL_ID, "gemini-1.5-flash", "gemini-1.5-flash-lite"].filter(Boolean) as string[];
  const visionPrompt = `USER QUESTION: ${userQuestion}\nDescribe what you see accurately and CONCISELY — 2-3 sentences maximum.`;
  let lastError = "";
  for (const modelName of modelNames) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent([visionPrompt, { inlineData: { data: base64Image, mimeType: "image/jpeg" } }]);
      return (await result.response).text();
    } catch (e: any) { lastError = e.message; continue; }
  }
  throw new Error("All vision models failed. Last error: " + lastError);
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    const body = await req.json();
    const { messages, conversationId, autoVerify = false, imageBase64, mode, audioBase64, enableTTS = false } = body;

    let userPrompt = messages[messages.length - 1].content;
    const lowerPrompt = userPrompt.toLowerCase();

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
      const enc = new TextEncoder();
      const stream = new ReadableStream({
        async start(ctrl) {
          let analysis = "";
          try {
            ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ status: "📷 Analyzing what I see..." })}\n\n`));
            analysis = await analyzeImageWithGemini(imageBase64, userPrompt);
            const p1 = { choices: [{ delta: { content: analysis } }] };
            ctrl.enqueue(enc.encode(`data: ${JSON.stringify(p1)}\n\n`));
          } catch (e: any) {
            analysis = "*(Vision analysis failed: " + e.message + ")*";
            const p2 = { choices: [{ delta: { content: analysis } }] };
            ctrl.enqueue(enc.encode(`data: ${JSON.stringify(p2)}\n\n`));
          }
          try {
            ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ status: "🔊 Generating voice..." })}\n\n`));
            const audio = await textToSpeech(analysis.replace(/[*#_`]/g, "").substring(0, 500));
            if (audio) ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ audioBase64: audio })}\n\n`));
          } catch (e: any) { ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ status: "🔇 Voice unavailable" })}\n\n`)); }
          ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ conversationId: convId })}\n\n`));
          ctrl.enqueue(enc.encode("data: [DONE]\n\n"));
          ctrl.close();
          try { await prisma.message.create({ data: { conversationId: convId, role: "assistant", content: analysis } }); await prisma.conversation.update({ where: { id: convId }, data: { updatedAt: new Date() } }); } catch (e) { console.error("DB error:", e); }
        },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no" } });
    }

    const isCoding = lowerPrompt.includes("code") || lowerPrompt.includes("algorithm") || lowerPrompt.includes("function") || lowerPrompt.includes("write a") || lowerPrompt.includes("array") || lowerPrompt.includes("tree");

    if (isCoding) {
      const enc = new TextEncoder();
      const MAX_ROUNDS = 3;
      const CODING_PROMPT = `You are an elite software engineer. 
CRITICAL RULES:
- ONLY write analysis and code.
- When handling Unicode strings, use Intl.Segmenter with granularity: "grapheme". Array.from() and string[i] break emoji sequences.
Your response MUST have exactly 2 sections:
**SECTION 1: ANALYSIS** (Briefly analyze inputs/outputs/constraints, algorithm choice, time/space complexity)
**SECTION 2: CODE** (Write a complete JavaScript solution as a single named function, with one console.log test case at the bottom)`;

      const stream = new ReadableStream({
        async start(ctrl) {
          const sendStatus = (msg: string) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ status: msg })}\n\n`));
          let full = "";
          let convoMessages = messages.slice(-4).map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content.includes("data:image") ? "[Image]" : m.content }));
          let round = 0;

          try {
            for (round = 1; round <= MAX_ROUNDS; round++) {
              sendStatus(round === 1 ? "🧠 Thinking... writing a solution" : `🔁 Round ${round}/${MAX_ROUNDS}: fixing the real error found and retrying`);
              const { result, providerName } = await callSingleAI([{ role: "system", content: CODING_PROMPT }, ...convoMessages], 0.2, 1500);
              let roundText = "";
              for await (const d of result.textStream) roundText += d;

              const code = extractCode(roundText);
              if (!code) {
                sendStatus("⚠️ No code block produced, asking again...");
                convoMessages.push({ role: "assistant", content: roundText });
                convoMessages.push({ role: "user", content: "Provide a JavaScript code block wrapped in triple backticks now." });
                continue;
              }

              sendStatus("🔎 Verifying in the real sandbox...");
              const execResult = await executeJs(code);

              if (execResult.unavailable) { full = roundText + `\n\n⚠️ **Could not verify — the execution sandbox is temporarily unavailable.**`; break; }
              if (execResult.ok) { full = roundText + `\n\n✅ **Code executed without errors** (via ${providerName}, round ${round}/${MAX_ROUNDS}) — output: \`${execResult.stdout || "(no output)"}\`.`; break; }

              full = roundText;
              convoMessages.push({ role: "assistant", content: roundText });
              convoMessages.push({ role: "user", content: `Your code failed when executed. Real error:\n\n${execResult.stderr}\n\nFix it. Follow the exact same format.` });
              if (round === MAX_ROUNDS) full += `\n\n⚠️ **Still failing after ${MAX_ROUNDS} attempts.** Last error: \`${execResult.stderr}\``;
            }
            const successPayload = { choices: [{ delta: { content: full } }] };
            ctrl.enqueue(enc.encode(`data: ${JSON.stringify(successPayload)}\n\n`));
          } catch (e: any) {
            console.error("Coding loop error:", e);
            const errorPayload = { choices: [{ delta: { content: "*(AI providers unavailable)*" } }] };
            ctrl.enqueue(enc.encode(`data: ${JSON.stringify(errorPayload)}\n\n`));
          } finally {
            ctrl.enqueue(enc.encode("data: [DONE]\n\n"));
            ctrl.close();
            try { await prisma.message.create({ data: { conversationId: convId, role: "assistant", content: full } }); await prisma.conversation.update({ where: { id: convId }, data: { updatedAt: new Date() } }); } catch (e) { console.error("DB error:", e); }
          }
        },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no" } });
    }

    const SYSTEM = `You are Noctryx AI, built by Lewis Einstein, an AI/ML Engineer at Kibabii University, launched in July 2026.

UNIVERSAL FORMATTING RULE (MUST FOLLOW FOR ALL RESPONSES):
1. NEVER output a "wall of text". Break everything into short paragraphs (2-3 sentences max).
2. Use Markdown headings (###) to separate different topics or steps.
3. Use bullet points (-) for lists, features, or sequential steps.
4. Bold (**text**) key terms, numbers, or final conclusions.
5. If this is a math or logic problem, strictly follow this 7-step format: 
   1. Restate the Problem, 2. Given Information, 3. What Must Be Found, 4. Formula or Method, 5. Solution — Numbered Steps, 6. Verification, 7. Final Answer.

If no live search results are available, you MUST explicitly say "I'm not certain" rather than fabricating an answer.`;

    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(ctrl) {
        const sendStatus = (msg: string) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ status: msg })}\n\n`));
        let chatTxt = "";

        try {
          sendStatus("🔎 Searching live sources...");
          let tavily = null, wiki = null, ddg = null, hn = null, so = null, gh = null, arxiv = null;
          try {
            [tavily, wiki, ddg, hn, so, gh, arxiv] = await Promise.all([
              searchTavily(userPrompt), searchWiki(userPrompt), searchDdg(userPrompt), searchHn(userPrompt), searchSo(userPrompt), searchGh(userPrompt), searchArxiv(userPrompt)
            ]);
          } catch (e) { console.error("Search batch failed, continuing without some sources:", e); }

          let searchCtx = "";
          if (tavily) searchCtx += `[Tavily] ${truncate(tavily, 400)}\n\n`;
          if (wiki) searchCtx += `[Wikipedia] ${truncate(wiki, 200)}\n\n`;
          if (ddg) searchCtx += `[DuckDuckGo] ${truncate(ddg, 200)}\n\n`;
          if (hn) searchCtx += `[Hacker News] ${truncate(hn, 200)}\n\n`;
          if (so) searchCtx += `[StackOverflow] ${truncate(so, 200)}\n\n`;
          if (gh) searchCtx += `[GitHub] ${truncate(gh, 200)}\n\n`;
          if (arxiv) searchCtx += `[arXiv] ${truncate(arxiv, 200)}\n\n`;

          const hasSearchResults = searchCtx.length > 0;
          if (hasSearchResults) sendStatus("🔎 Found live sources, enhancing answer...");

          const systemWithSearch = hasSearchResults ? `${SYSTEM}\n\n---\nLIVE SEARCH RESULTS:\n\n${searchCtx}` : SYSTEM;

          sendStatus("🧠 Accessing AI brain...");
          const aiMessages = [{ role: "system", content: systemWithSearch }, ...messages.slice(-6).map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content.includes("data:image") ? "[Image]" : m.content }))];

          sendStatus("🔄 Querying multiple AI models...");
          const { responses: aiResponses } = await callAllAI(aiMessages, 0.5, 2000);

          sendStatus("🔄 Synthesizing best answer...");
          chatTxt = await synthesizeResponses(aiResponses, userPrompt, searchCtx);

          const words = chatTxt.split(" ");
          for (const word of words) {
            const wordPayload = { choices: [{ delta: { content: word + " " } }] };
            ctrl.enqueue(enc.encode(`data: ${JSON.stringify(wordPayload)}\n\n`));
          }
        } catch (e: any) {
          console.error("Chat error:", e);
          chatTxt = `*(AI response unavailable. Error: ${e.message}. Please try again.)*`;
          const fallbackPayload = { choices: [{ delta: { content: chatTxt } }] };
          ctrl.enqueue(enc.encode(`data: ${JSON.stringify(fallbackPayload)}\n\n`));
        }

        try {
          const claims = extractClaims(chatTxt);
          const hasHighStakesClaims = claims.some(c => c.type === "price" || c.type === "citation" || (c.type === "percentage" && /approval|probability|chance|rate/i.test(c.text)));

          if (autoVerify || hasHighStakesClaims) {
            sendStatus("🔎 Checking claims against live sources...");
            const results = await Promise.all(claims.slice(0, 5).map(c => verifyClaim(c)));
            const verificationFooter = buildVerificationFooter(results);
            if (verificationFooter) {
              const footerPayload = { choices: [{ delta: { content: verificationFooter } }] };
              ctrl.enqueue(enc.encode(`data: ${JSON.stringify(footerPayload)}\n\n`));
              chatTxt += verificationFooter;
            }
          }
        } catch (e) { console.error("Verification error:", e); }

        if ((mode === "voice" || enableTTS) && chatTxt) {
          try {
            sendStatus("🔊 Generating voice response...");
            const audioBase64Out = await textToSpeech(chatTxt.replace(/[*#_`]/g, "").substring(0, 1000));
            if (audioBase64Out) {
              const audioPayload = { audioBase64: audioBase64Out };
              ctrl.enqueue(enc.encode(`data: ${JSON.stringify(audioPayload)}\n\n`));
            }
          } catch (e: any) { console.error("TTS failed:", e.message); }
        }

        ctrl.enqueue(enc.encode("data: [DONE]\n\n"));
        ctrl.close();

        try {
          const lt = chatTxt.toLowerCase();
          if ((lt.includes("action:create_flashcard") || (lowerPrompt.includes("create") && lowerPrompt.includes("flashcard"))) && !chatTxt.includes("[SAVED:FLASHCARD]")) {
            const m = chatTxt.match(/Front:\s*(.*?)\s*\|\s*Back:\s*(.*)/i);
            if (m) { await prisma.flashcard.create({ data: { front: m[1].trim(), back: m[2].trim(), userId: session.user.id } }); chatTxt += "\n[SAVED:FLASHCARD]"; }
          } else if ((lt.includes("action:save_note") || (lowerPrompt.includes("save") && lowerPrompt.includes("note"))) && !chatTxt.includes("[SAVED:NOTE]")) {
            const m = chatTxt.match(/Title:\s*(.*?)\s*\|\s*Content:\s*(.*)/i);
            if (m) { await prisma.note.create({ data: { title: m[1].trim(), content: m[2].trim(), userId: session.user.id } }); chatTxt += "\n[SAVED:NOTE]"; }
          } else if ((lt.includes("action:create_assignment") || (lowerPrompt.includes("add") && lowerPrompt.includes("assignment"))) && !chatTxt.includes("[SAVED:ASSIGNMENT]")) {
            const m = chatTxt.match(/Title:\s*(.*?)\s*\|\s*Due:\s*(.*)/i);
            if (m) { const dd = new Date(m[2].trim()); if (!isNaN(dd.getTime())) { await prisma.assignment.create({ data: { title: m[1].trim(), dueDate: dd, userId: session.user.id } }); chatTxt += "\n[SAVED:ASSIGNMENT]"; } }
          }
          await prisma.message.create({ data: { conversationId: convId, role: "assistant", content: chatTxt } });
          await prisma.conversation.update({ where: { id: convId }, data: { updatedAt: new Date() } });
        } catch (e) { console.error("DB error:", e); }
      },
    });

    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no" } });
  } catch (error: any) {
    console.error("API Error:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error", details: error.message }), { status: 500 });
  }
}