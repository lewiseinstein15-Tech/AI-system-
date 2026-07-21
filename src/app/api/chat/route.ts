import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { Sandbox } from "@vercel/sandbox";
import { GoogleGenerativeAI } from "@google/generative-ai";

const PROVIDERS = [
  { name: "Cerebras", baseURL: "https://api.cerebras.ai/v1", key: "CEREBRAS_API_KEY", model: process.env.CEREBRAS_MODEL_ID || "gpt-oss-120b" },
  { name: "Groq", baseURL: "https://api.groq.com/openai/v1", key: "GROQ_API_KEY", model: process.env.GROQ_MODEL_ID || "openai/gpt-oss-20b" },
  { name: "OpenRouter", baseURL: "https://openrouter.ai/api/v1", key: "OPENROUTER_API_KEY", model: process.env.OPENROUTER_MODEL_ID || "deepseek/deepseek-chat-v3:free" },
  { name: "Gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", key: "GEMINI_API_KEY", model: process.env.GEMINI_MODEL_ID || "gemini-3.5-flash" },
];

// Single provider with fallback chain
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

// Call ALL providers in parallel with proper per-provider timeout
async function callAllAI(messages: any[], temp: number, maxTokens: number, timeoutMs = 12000): Promise<{ responses: string[]; providers: string[] }> {
  const providerPromises = PROVIDERS.map(async (p) => {
    const apiKey = process.env[p.key];
    if (!apiKey) return null;

    const providerTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Provider timeout")), timeoutMs)
    );

    try {
      const client = createOpenAI({ baseURL: p.baseURL, apiKey });
      const result = await Promise.race([
        streamText({
          model: client(p.model),
          messages,
          temperature: temp,
          maxTokens,
          maxRetries: 0,
        }),
        providerTimeout,
      ]);

      let text = "";
      for await (const d of result.textStream) {
        text += d;
      }
      console.log("Ensemble response from:", p.name);
      return { text, provider: p.name };
    } catch (err: any) {
      console.error(p.name, "ensemble failed:", err?.message || err);
      return null;
    }
  });

  const results = await Promise.all(providerPromises);
  const valid = results.filter((r): r is { text: string; provider: string } => r !== null && r.text.length > 10);

  if (valid.length === 0) {
    throw new Error("All providers unavailable in ensemble");
  }

  return {
    responses: valid.map((r) => r.text),
    providers: valid.map((r) => r.provider),
  };
}

// Synthesize multiple responses into one
async function synthesizeResponses(responses: string[], userQuery: string, searchCtx: string): Promise<string> {
  if (responses.length === 1) {
    return responses[0];
  }

  const gemini = PROVIDERS.find((p) => p.name === "Gemini");
  if (!gemini || !process.env.GEMINI_API_KEY) {
    return responses.reduce((a, b) => (a.length > b.length ? a : b));
  }

  const synthesisPrompt = `You are Noctryx AI. Multiple AI systems have analyzed the user question. Synthesize their answers into ONE coherent, accurate response.

RULES:
- Do NOT mention that you used multiple AI models or providers.
- Do NOT say "Model A said..." or "According to one source..."
- Write as if YOU are the sole author.
- Resolve contradictions by picking the most accurate info.
- Combine unique insights.

${searchCtx ? `SEARCH CONTEXT:\n${searchCtx}\n\n` : ""}USER QUESTION: ${userQuery}

RESPONSES TO SYNTHESIZE:
${responses.map((r, i) => `--- RESPONSE ${i + 1} ---\n${r}`).join("\n\n")}

Now write the final unified response:`;

  try {
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
    return text;
  } catch (e: any) {
    console.error("Synthesis failed:", e.message);
    return responses[0];
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

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`STT failed: ${err}`);
  }

  const data = await res.json();
  return data.text || "";
}

async function textToSpeech(text: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) return "";

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1",
      voice: "alloy",
      input: text.replace(/[*#_`]/g, "").substring(0, 1000),
      response_format: "mp3",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`TTS failed: ${err}`);
  }

  const audioBuffer = Buffer.from(await res.arrayBuffer());
  return audioBuffer.toString("base64");
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
    const stdout = (await result.stdout()).trim();
    const stderr = (await result.stderr()).trim();
    return { ok: result.exitCode === 0, stdout, stderr };
  } catch (e: any) {
    return { ok: false, stdout: "", stderr: `Sandbox error: ${e.message}`, unavailable: true };
  } finally {
    if (sandbox) {
      try { await sandbox.stop(); } catch {}
    }
  }
}

function extractCode(text: string): string | null {
  const m = text.match(/```(?:javascript|js)\s*([\s\S]*?)```/);
  if (m) return m[1].trim();
  const g = text.match(/```\s*([\s\S]*?)```/);
  return g ? g[1].trim() : null;
}

async function searchWiki(q: string) {
  try {
    const s = await fetchTimeout(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&origin=*`);
    const d = await s.json();
    if (d.query?.search?.[0]) {
      const sum = await fetchTimeout(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(d.query.search[0].title)}`);
      const sd = await sum.json();
      if (sd.extract) return `Wikipedia: ${sd.extract}`;
    }
  } catch {}
  return null;
}

async function searchDdg(q: string) {
  try {
    const r = await fetchTimeout(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`, {
      headers: { Accept: "application/json", "User-Agent": "NoctryxBot/1.0" },
    });
    const d = await r.json();
    if (d.AbstractText) return `DuckDuckGo: ${d.AbstractText}`;
    if (d.RelatedTopics?.[0]?.Text) return `DuckDuckGo: ${d.RelatedTopics[0].Text}`;
  } catch {}
  return null;
}

async function searchHn(q: string) {
  try {
    const r = await fetchTimeout(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=2`);
    const d = await r.json();
    if (d.hits?.length) return `Hacker News: ${d.hits.map((h: any) => h.title).join(" | ")}`;
  } catch {}
  return null;
}

async function searchSo(q: string) {
  try {
    const r = await fetchTimeout(`https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(q)}&site=stackoverflow&pagesize=2`);
    const d = await r.json();
    if (d.items?.length) return `StackOverflow: ${d.items.map((i: any) => i.title).join(" | ")}`;
  } catch {}
  return null;
}

async function searchGh(q: string) {
  try {
    const h: Record<string, string> = { Accept: "application/vnd.github.v3+json" };
    if (process.env.GITHUB_TOKEN) h.Authorization = `token ${process.env.GITHUB_TOKEN}`;
    const r = await fetchTimeout(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=2`, { headers: h });
    const d = await r.json();
    if (d.items?.length) return `GitHub: ${d.items.map((i: any) => i.full_name).join(" | ")}`;
  } catch {}
  return null;
}

async function searchArxiv(q: string) {
  try {
    const r = await fetchTimeout(`https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&max_results=2`);
    const t = await r.text();
    const titles = [...t.matchAll(/<title>(.*?)<\/title>/g)].map((m) => m[1]).filter((t) => t !== "arXiv Query Result");
    if (titles.length) return `arXiv Papers: ${titles.join(" | ")}`;
  } catch {}
  return null;
}

async function searchTavily(q: string) {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const r = await fetchTimeout("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: q,
        max_results: 2,
        include_answer: true,
      }),
    }, 5000);
    const d = await r.json();
    let out = "";
    if (d.answer) out += `Summary: ${d.answer}\n`;
    if (d.results?.length) {
      out += d.results.map((res: any) => `- ${res.title} (${res.url}): ${truncate(res.content, 150)}`).join("\n");
    }
    return out ? `Tavily Web Search: ${out}` : null;
  } catch {}
  return null;
}

interface Claim {
  text: string;
  type: "price" | "percentage" | "citation" | "statistic" | "attribution";
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\|/g, " ")
    .replace(/[*#_`]/g, "")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractClaims(text: string): Claim[] {
  const claims: Claim[] = [];
  const cleanText = stripMarkdown(text);

  const priceRegex = /\$\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:\s*(?:million|billion|yr|year|per year|\/yr))?/gi;
  let match;
  while ((match = priceRegex.exec(cleanText)) !== null) {
    const context = cleanText.substring(Math.max(0, match.index - 40), Math.min(cleanText.length, match.index + 40));
    claims.push({ text: `${match[0]} (${context.trim()})`, type: "price" });
  }

  const pctRegex = /\d{1,3}(?:\.\d+)?%/g;
  while ((match = pctRegex.exec(cleanText)) !== null) {
    const context = cleanText.substring(Math.max(0, match.index - 30), Math.min(cleanText.length, match.index + 30));
    if (/from|per|in|of|rate|probability|chance/i.test(context)) {
      claims.push({ text: `${match[0]} (${context.trim()})`, type: "percentage" });
    }
  }

  const citeRegex = /([A-Z][a-z]+(?:\s+(?:&|and)\s+[A-Z][a-z]+)?(?:\s+et\s+al\.?)?)\s*\(\d{4}\)/g;
  while ((match = citeRegex.exec(cleanText)) !== null) {
    claims.push({ text: match[0], type: "citation" });
  }

  const statRegex = /(\d+(?:,\d{3})*(?:\.\d+)?)\s+(?:patients|participants|subjects|studies|trials|cases)\s+(?:from|in|per|across)/gi;
  while ((match = statRegex.exec(cleanText)) !== null) {
    claims.push({ text: match[0], type: "statistic" });
  }

  const attrRegex = /(?:according to|per|from|via|source[d]?:)\s+([A-Z][\w\s&]+?)(?:\s+\d{4}|\s*$)/gi;
  while ((match = attrRegex.exec(cleanText)) !== null) {
    claims.push({ text: match[1].trim(), type: "attribution" });
  }

  const seen = new Set();
  return claims.filter(c => {
    if (seen.has(c.text)) return false;
    seen.add(c.text);
    return true;
  });
}

function cleanClaimForSearch(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[|*#_`]/g, "")
    .replace(/\s*\([^)]{0,40}\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePriceClaim(text: string): string {
  const drugMatch = text.match(/(lecanemab|Leqembi|aducanumab|Aduhelm|ozempic|wegovy|mounjaro|zepbound)/i);
  const priceMatch = text.match(/\$\d{1,3}(?:,\d{3})+/);
  if (drugMatch && priceMatch) {
    return `${drugMatch[1]} ${priceMatch[0]} price per year`;
  }
  return text;
}

interface VerificationResult {
  claim: string;
  type: string;
  status: "verified" | "unverified" | "contradicted" | "uncertain" | "search-failed";
  sources: string[];
  note?: string;
}

async function verifyClaim(claim: Claim): Promise<VerificationResult> {
  let searchQuery = cleanClaimForSearch(claim.text);

  if (claim.type === "price") {
    searchQuery = normalizePriceClaim(searchQuery);
  }

  searchQuery = searchQuery.substring(0, 100);
  const sources: string[] = [];
  let searchError = false;

  try {
    const [wiki, ddg] = await Promise.all([
      searchWiki(searchQuery),
      searchDdg(searchQuery),
    ]);
    if (wiki) sources.push(truncate(wiki, 150) || "");
    if (ddg) sources.push(truncate(ddg, 150) || "");
  } catch (e) {
    searchError = true;
  }

  let status: VerificationResult["status"] = "unverified";
  let note: string | undefined;

  if (searchError) {
    status = "search-failed";
    note = "Search APIs returned an error or timed out";
  } else if (sources.length === 0) {
    status = "unverified";
    note = "No live sources found — claim may be correct but not indexed by search APIs";
  } else {
    const combined = sources.join(" ").toLowerCase();
    const hasNumbers = /\d/.test(claim.text);
    if (hasNumbers) {
      const claimNumbers = claim.text.match(/\d+(?:\.\d+)?/g) || [];
      const sourceHasAny = claimNumbers.some(n => combined.includes(n));
      if (!sourceHasAny && sources.length > 0) {
        status = "uncertain";
        note = "Source found but could not confirm specific numbers";
      } else {
        status = "verified";
      }
    } else {
      status = "verified";
    }
  }

  return {
    claim: claim.text,
    type: claim.type,
    status,
    sources: sources.filter(Boolean),
    note,
  };
}

function buildVerificationFooter(results: VerificationResult[]): string {
  if (results.length === 0) return "";

  const verified = results.filter(r => r.status === "verified");
  const uncertain = results.filter(r => r.status === "uncertain");
  const unverified = results.filter(r => r.status === "unverified");
  const contradicted = results.filter(r => r.status === "contradicted");
  const searchFailed = results.filter(r => r.status === "search-failed");

  let footer = "\n\n---\n";

  if (contradicted.length > 0) {
    footer += `🔴 **${contradicted.length} claim(s) contradicted by live sources**\n`;
  } else if (searchFailed.length > 0) {
    footer += `⚠️ **${searchFailed.length} claim(s) could not be checked** — search APIs failed\n`;
  } else if (unverified.length > 0) {
    footer += `🟡 **${unverified.length} claim(s) unverified** — no live sources found\n`;
  } else if (uncertain.length > 0) {
    footer += `🟡 **${uncertain.length} claim(s) uncertain** — sources found but numbers unconfirmed\n`;
  } else {
    footer += `🟢 **All ${verified.length} verifiable claim(s) matched live sources**\n`;
  }

  footer += "\n<details>\n<summary>Verification details</summary>\n\n";

  for (const r of results) {
    const icon = r.status === "verified" ? "🟢" : r.status === "contradicted" ? "🔴" : r.status === "search-failed" ? "⚠️" : "🟡";
    footer += `${icon} **${r.type.toUpperCase()}**: "${truncate(r.claim, 80)}"\n`;
    if (r.sources.length > 0) footer += `   Sources: ${r.sources.join(" | ")}\n`;
    if (r.note) footer += `   Note: ${r.note}\n`;
    footer += "\n";
  }

  footer += "</details>\n";
  footer += `\n*Verified at ${new Date().toISOString()} against Wikipedia, DuckDuckGo, and other live sources. Always independently verify critical claims.*`;

  return footer;
}

async function analyzeImageWithGemini(base64Image: string, userQuestion: string): Promise<string> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Gemini API key required for vision analysis");
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

  // Updated fallback chain: user-set → 3.5-flash → 3.1-flash-lite → 2.5-flash
  // Note: gemini-2.0-flash and gemini-1.5-flash were shut down June 1, 2026
  // Note: gemini-2.5-flash is scheduled for shutdown October 16, 2026
  const modelNames = [
    process.env.GEMINI_MODEL_ID,
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash",
  ].filter(Boolean) as string[];

  const visionPrompt = `You are Noctryx AI with live camera vision. The user has shared a photo from their camera and asked a question about what you see.

USER QUESTION: ${userQuestion}

Describe what you see accurately. Be specific about objects, people, text, colors, and spatial relationships. If you cannot clearly see something, say so honestly.`;

  let lastError = "";

  for (const modelName of modelNames) {
    try {
      console.log("Trying vision model:", modelName);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent([
        visionPrompt,
        { inlineData: { data: base64Image, mimeType: "image/jpeg" } }
      ]);

      const response = await result.response;
      const text = response.text();
      console.log("Vision success with:", modelName);
      return text;
    } catch (e: any) {
      console.error("Vision model failed:", modelName, e.message);
      lastError = e.message;
      if (e.message?.includes("503") || e.message?.includes("high demand") || e.message?.includes("Service Unavailable")) {
        continue;
      }
      continue;
    }
  }

  throw new Error("All vision models failed. Last error: " + lastError);
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    const body = await req.json();
    const { messages, conversationId, autoVerify = false, imageBase64, mode, audioBase64, enableTTS = false } = body;

    let userPrompt = messages[messages.length - 1].content;
    const lowerPrompt = userPrompt.toLowerCase();

    let transcribedFromVoice = false;
    if (mode === "voice" && audioBase64) {
      try {
        const transcript = await speechToText(audioBase64);
        if (transcript) {
          userPrompt = transcript;
          transcribedFromVoice = true;
        }
      } catch (e: any) {
        console.error("STT failed:", e.message);
      }
    }

    let convId = conversationId;
    if (!convId) {
      const nc = await prisma.conversation.create({
        data: { userId: session.user.id, title: userPrompt.substring(0, 30) + "..." },
      });
      convId = nc.id;
    }

    await prisma.message.create({
      data: { conversationId: convId, role: "user", content: userPrompt },
    });

    if (mode === "live" && imageBase64) {
      const enc = new TextEncoder();
      const stream = new ReadableStream({
        async start(ctrl) {
          let analysis = "";
          try {
            ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ status: "📷 Analyzing what I see..." })}\n\n`));
            analysis = await analyzeImageWithGemini(imageBase64, userPrompt);
            ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: analysis } }] })}\n\n`));
          } catch (e: any) {
            analysis = "*(Vision analysis failed: " + e.message + ")*";
            ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: analysis } }] })}\n\n`));
          }
          ctrl.enqueue(enc.encode("data: [DONE]\n\n"));
          ctrl.close();
          try {
            await prisma.message.create({ data: { conversationId: convId, role: "assistant", content: analysis } });
            await prisma.conversation.update({ where: { id: convId }, data: { updatedAt: new Date() } });
          } catch (e) {
            console.error("DB error:", e);
          }
        },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
    }

    const isCoding =
      lowerPrompt.includes("code") ||
      lowerPrompt.includes("algorithm") ||
      lowerPrompt.includes("solve") ||
      lowerPrompt.includes("function") ||
      lowerPrompt.includes("write a") ||
      lowerPrompt.includes("dp") ||
      lowerPrompt.includes("array") ||
      lowerPrompt.includes("tree") ||
      lowerPrompt.includes("graph");

    if (isCoding) {
      const enc = new TextEncoder();
      const MAX_ROUNDS = 3;

      const CODING_PROMPT = `You are an elite software engineer. The user asked a coding question.

CRITICAL RULES:
- Do NOT output any [ACTION:...] commands
- Do NOT create flashcards, notes, or assignments
- ONLY write analysis and code
- Do NOT claim your code is "verified," "tested," or "correct" — the backend will independently verify it. Just write your best solution.
- When handling Unicode strings, use Intl.Segmenter with granularity: "grapheme" for correct character boundaries. Array.from() and string[i] break emoji sequences (like 👨‍👩‍👧‍👦) and combining characters.

Your response MUST have exactly 2 sections:

**SECTION 1: ANALYSIS**
Briefly analyze inputs/outputs/constraints, algorithm choice, time/space complexity. Mention any Unicode or edge-case considerations.

**SECTION 2: CODE**
Write a complete JavaScript solution as a single named function, with one console.log test case at the bottom calling it with a concrete example input.

Format:
\`\`\`javascript
function yourFunctionName(...) {
  // your code
}
console.log(yourFunctionName(...));
\`\`\`

Be concise. No extra text after the code block.`;

      const stream = new ReadableStream({
        async start(ctrl) {
          const sendStatus = (msg: string) =>
            ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ status: msg })}\n\n`));

          let full = "";
          let convoMessages = messages.slice(-4).map((m: any) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content.includes("data:image") ? "[Image]" : m.content,
          }));

          let finalVerified = false;
          let round = 0;

          try {
            for (round = 1; round <= MAX_ROUNDS; round++) {
              sendStatus(round === 1 ? "🧠 Thinking... writing a solution" : `🔁 Round ${round}/${MAX_ROUNDS}: fixing the real error found and retrying`);

              const { result, providerName } = await callSingleAI(
                [{ role: "system", content: CODING_PROMPT }, ...convoMessages],
                0.2,
                1500
              );

              let roundText = "";
              for await (const d of result.textStream) {
                roundText += d;
              }

              const code = extractCode(roundText);
              if (!code) {
                sendStatus("⚠️ No code block produced, asking again...");
                convoMessages.push({ role: "assistant", content: roundText });
                convoMessages.push({ role: "user", content: "You did not provide a JavaScript code block wrapped in triple backticks. Provide one now." });
                continue;
              }

              sendStatus("🔎 Verifying in the real sandbox (this can take a few seconds)...");
              const execResult = await executeJs(code);

              if (execResult.unavailable) {
                full = roundText + `\n\n⚠️ **Could not verify — the execution sandbox is temporarily unavailable.** This code has NOT been confirmed to run correctly. Please try again shortly.`;
                break;
              }

              if (execResult.ok) {
                full = roundText + `\n\n⚠️ **Code executed without errors** (via ${providerName}, round ${round}/${MAX_ROUNDS}) — output: \`${execResult.stdout || "(no output)"}\`. This verifies the code runs, NOT that it is mathematically correct. Always test independently.`;
                finalVerified = true;
                break;
              }

              full = roundText;
              convoMessages.push({ role: "assistant", content: roundText });
              convoMessages.push({
                role: "user",
                content: `Your code failed when actually executed. This is the real error:\n\n${execResult.stderr}\n\nFix it. Follow the exact same format: start with **SECTION 1: ANALYSIS**, then **SECTION 2: CODE** with a JavaScript code block. Also verify your solution handles edge cases: empty input, single character, Unicode grapheme clusters (emoji families, combining characters), and very long strings. Do not claim success until this stops erroring.`,
              });

              if (round === MAX_ROUNDS) {
                full += `\n\n⚠️ **Still failing after ${MAX_ROUNDS} attempts.** Last real error: \`${execResult.stderr}\`\n\nThis has not been verified as correct — please try rephrasing the question.`;
              }
            }

            ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: full } }] })}\n\n`));
          } catch (e: any) {
            console.error("Coding loop error:", e);
            full = "*(All AI providers are currently unavailable or rate-limited. Please try again in a moment.)*";
            ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: full } }] })}\n\n`));
          } finally {
            ctrl.enqueue(enc.encode("data: [DONE]\n\n"));
            ctrl.close();
            try {
              await prisma.message.create({ data: { conversationId: convId, role: "assistant", content: full } });
              await prisma.conversation.update({ where: { id: convId }, data: { updatedAt: new Date() } });
            } catch (e) {
              console.error("DB error:", e);
            }
          }
        },
      });

      return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
    }

    const SYSTEM = `You are Noctryx AI, a sophisticated AI system forged through countless iterations, built to assist with real-world problems through precision, persistence, and relentless refinement.

Your origin: "Built through persistence. Refined by knowledge. Every failure became an improvement. Forged through countless iterations. Precision earned, not inherited."

If asked your name, respond: "I am Noctryx AI."

If asked who built you, respond: "I was built by Lewis Einstein, an AI/ML Engineer at Kibabii University, through countless researches and extensive training to assist you."

If asked when you were built or came live, respond: "I was launched in July 2026 by Lewis Einstein."

Answer clearly in markdown. Only output action commands when EXPLICITLY asked:
[ACTION:CREATE_FLASHCARD] Front: <text> | Back: <text>
[ACTION:SAVE_NOTE] Title: <text> | Content: <text>
[ACTION:CREATE_ASSIGNMENT] Title: <text> | Due: <YYYY-MM-DDTHH:MM:SS>

CRITICAL UNCERTAINTY RULE:
If no live search results are available for the user's question, or if the search APIs return no relevant information, you MUST explicitly say "I'm not certain" or "I don't have enough information to answer this accurately" rather than fabricating an answer. Only state facts you can ground in the provided search context or your training data. Do not hallucinate.

MATHEMATICS FORMATTING RULE:
When solving mathematics problems, you MUST follow this exact structure:

**1. Restate the Problem**
Rewrite the problem in clear, precise language.

**2. Given Information**
List all known values, conditions, constraints, and definitions.

**3. What Must Be Found**
State explicitly what the question asks you to determine.

**4. Formula or Method**
Identify and name the theorem, formula, identity, or technique you will apply.

**5. Solution — Numbered Steps**
Show the solution in numbered steps. Each step must be:
- Concise
- Mathematically justified
- Sequential (do not skip steps or omit calculations)

**6. Verification**
When possible, verify the answer by substitution, inverse operation, estimation, or alternative method.

**7. Final Answer**
End with a clearly labeled "Final Answer:" on its own line.

Additional constraints:
- Do not omit important calculations.
- Do not jump between non-sequential steps.
- Use proper mathematical notation and formatting (LaTeX-style where appropriate).
- Keep derivations clean and readable.`;

    const enc = new TextEncoder();

    const stream = new ReadableStream({
      async start(ctrl) {
        const sendStatus = (msg: string) =>
          ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ status: msg })}\n\n`));

        let chatTxt = "";

        try {
          // ALWAYS search for every query - but silently
          const [tavily, wiki, ddg, hn, so, gh, arxiv] = await Promise.all([
            searchTavily(userPrompt),
            searchWiki(userPrompt),
            searchDdg(userPrompt),
            searchHn(userPrompt),
            searchSo(userPrompt),
            searchGh(userPrompt),
            searchArxiv(userPrompt),
          ]);

          let searchCtx = "";
          if (tavily) searchCtx += `[Tavily] ${truncate(tavily, 400)}\n\n`;
          if (wiki) searchCtx += `[Wikipedia] ${truncate(wiki, 200)}\n\n`;
          if (ddg) searchCtx += `[DuckDuckGo] ${truncate(ddg, 200)}\n\n`;
          if (hn) searchCtx += `[Hacker News] ${truncate(hn, 200)}\n\n`;
          if (so) searchCtx += `[StackOverflow] ${truncate(so, 200)}\n\n`;
          if (gh) searchCtx += `[GitHub] ${truncate(gh, 200)}\n\n`;
          if (arxiv) searchCtx += `[arXiv] ${truncate(arxiv, 200)}\n\n`;

          const hasSearchResults = searchCtx.length > 0;

          // Only tell user we searched if we actually found something
          if (hasSearchResults) {
            sendStatus("🔎 Found live sources, enhancing answer...");
          }

          // Build system prompt - only include search if we got results
          const systemWithSearch = hasSearchResults
            ? `${SYSTEM}\n\n---\nLIVE SEARCH RESULTS FOR THIS QUERY (use these to answer accurately, cite sources):\n\n${searchCtx}`
            : SYSTEM;

          // Call ALL AI providers in parallel (ensemble)
          sendStatus("🧠 Accessing AI brain...");
          const aiMessages = [
            { role: "system", content: systemWithSearch },
            ...messages.slice(-6).map((m: any) => ({
              role: m.role === "assistant" ? "assistant" : "user",
              content: m.content.includes("data:image") ? "[Image]" : m.content,
            })),
          ];

          const { responses: aiResponses, providers } = await callAllAI(aiMessages, 0.5, 2000);

          // Synthesize all responses into one
          sendStatus("🔄 Synthesizing best answer...");
          const synthesized = await synthesizeResponses(aiResponses, userPrompt, searchCtx);
          chatTxt = synthesized;

          // Stream the final synthesized response
          const words = chatTxt.split(" ");
          for (const word of words) {
            ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: word + " " } }] })}\n\n`));
          }
        } catch (e: any) {
          console.error("Chat error:", e);
          const fallback = "*(AI response unavailable. Please try again.)*";
          chatTxt = fallback;
          ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: fallback } }] })}\n\n`));
        }

        try {
          const claims = extractClaims(chatTxt);
          let verificationFooter = "";

          const hasHighStakesClaims = claims.some(c =>
            c.type === "price" ||
            c.type === "citation" ||
            (c.type === "percentage" && /approval|probability|chance|rate/i.test(c.text))
          );

          if (autoVerify || hasHighStakesClaims) {
            sendStatus("🔎 Checking claims against live sources...");

            const results = await Promise.all(
              claims.slice(0, 5).map(c => verifyClaim(c))
            );

            verificationFooter = buildVerificationFooter(results);

            if (verificationFooter) {
              ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: verificationFooter } }] })}\n\n`));
              chatTxt += verificationFooter;
            }
          }
        } catch (e) {
          console.error("Verification error:", e);
        }

        let audioBase64 = "";
        if ((mode === "voice" || enableTTS) && chatTxt) {
          try {
            sendStatus("🔊 Generating voice response...");
            audioBase64 = await textToSpeech(chatTxt.replace(/[*#_`]/g, "").substring(0, 1000));
            if (audioBase64) {
              ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ audioBase64 })}\n\n`));
            }
          } catch (e: any) {
            console.error("TTS failed:", e.message);
          }
        }

        ctrl.enqueue(enc.encode("data: [DONE]\n\n"));
        ctrl.close();

        const lt = chatTxt.toLowerCase();
        try {
          if ((lt.includes("action:create_flashcard") || (lowerPrompt.includes("create") && lowerPrompt.includes("flashcard"))) && !chatTxt.includes("[SAVED:FLASHCARD]")) {
            const m = chatTxt.match(/Front:\s*(.*?)\s*\|\s*Back:\s*(.*)/i);
            if (m) {
              await prisma.flashcard.create({ data: { front: m[1].trim(), back: m[2].trim(), userId: session.user.id } });
              chatTxt += "\n[SAVED:FLASHCARD]";
            }
          } else if ((lt.includes("action:save_note") || (lowerPrompt.includes("save") && lowerPrompt.includes("note"))) && !chatTxt.includes("[SAVED:NOTE]")) {
            const m = chatTxt.match(/Title:\s*(.*?)\s*\|\s*Content:\s*(.*)/i);
            if (m) {
              await prisma.note.create({ data: { title: m[1].trim(), content: m[2].trim(), userId: session.user.id } });
              chatTxt += "\n[SAVED:NOTE]";
            }
          } else if ((lt.includes("action:create_assignment") || (lowerPrompt.includes("add") && lowerPrompt.includes("assignment"))) && !chatTxt.includes("[SAVED:ASSIGNMENT]")) {
            const m = chatTxt.match(/Title:\s*(.*?)\s*\|\s*Due:\s*(.*)/i);
            if (m) {
              const dd = new Date(m[2].trim());
              if (!isNaN(dd.getTime())) {
                await prisma.assignment.create({ data: { title: m[1].trim(), dueDate: dd, userId: session.user.id } });
                chatTxt += "\n[SAVED:ASSIGNMENT]";
              }
            }
          }
          await prisma.message.create({ data: { conversationId: convId, role: "assistant", content: chatTxt } });
          await prisma.conversation.update({ where: { id: convId }, data: { updatedAt: new Date() } });
        } catch (e) {
          console.error("DB error:", e);
        }
      },
    });

    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
  } catch (error: any) {
    console.error("API Error:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error", details: error.message }), { status: 500 });
  }
}
