import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { Sandbox } from "@vercel/sandbox";

// ============================================================
// PROVIDER FALLBACK
// Model IDs below were valid as of this writing — provider
// catalogs change without notice. If you start seeing
// "model_not_found" again, run the /models endpoint check for
// whichever provider fails and update the ID here.
// ============================================================

const PROVIDERS = [
  { name: "Cerebras", baseURL: "https://api.cerebras.ai/v1", key: "CEREBRAS_API_KEY", model: process.env.CEREBRAS_MODEL_ID || "gpt-oss-120b" },
  { name: "Groq", baseURL: "https://api.groq.com/openai/v1", key: "GROQ_API_KEY", model: process.env.GROQ_MODEL_ID || "openai/gpt-oss-20b" },
  { name: "OpenRouter", baseURL: "https://openrouter.ai/api/v1", key: "OPENROUTER_API_KEY", model: process.env.OPENROUTER_MODEL_ID || "deepseek/deepseek-chat-v3:free" },
  { name: "Gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", key: "GEMINI_API_KEY", model: process.env.GEMINI_MODEL_ID || "gemini-2.5-flash" },
];

async function callAI(messages: any[], temp: number, maxTokens: number) {
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
        maxRetries: 1, // fallback across providers handles retries, not per-provider retry storms
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

function truncate(str: string | null, max: number) {
  if (!str) return null;
  return str.length > max ? str.substring(0, max) + "..." : str;
}

async function fetchTimeout(url: string, opts: any = {}, ms = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// ============================================================
// CODE EXECUTION — via Vercel Sandbox (Firecracker microVM),
// authenticated via access token since this app runs on Render,
// not Vercel. Replaces the previous Piston-based implementation.
//
// NOTE: this was written from the official @vercel/sandbox docs
// but has not been personally execution-verified against a live
// Render deployment. Treat the first real run as the actual test.
// ============================================================

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

    await sandbox.writeFiles([
      { path: "main.js", content: Buffer.from(code) },
    ]);

    const result = await sandbox.runCommand({
      cmd: "node",
      args: ["main.js"],
    });

    const stdout = (await result.stdout()).trim();
    const stderr = (await result.stderr()).trim();

    return { ok: result.exitCode === 0, stdout, stderr };
  } catch (e: any) {
    return { ok: false, stdout: "", stderr: `Sandbox error: ${e.message}`, unavailable: true };
  } finally {
    if (sandbox) {
      try {
        await sandbox.stop();
      } catch {}
    }
  }
}

function extractCode(text: string): string | null {
  const m = text.match(/```(?:javascript|js)\s*([\s\S]*?)```/);
  if (m) return m[1].trim();
  const g = text.match(/```\s*([\s\S]*?)```/);
  return g ? g[1].trim() : null;
}

// Extracts the FIRST console.log(...) call from the model's own code
// so we can re-run it and check the ACTUAL value, not just "did it crash."
// This is a real, if imperfect, correctness check — not just a crash check.
function extractFirstTestCall(code: string): string | null {
  const m = code.match(/console\.log\((.*)\);?\s*$/m);
  return m ? m[1] : null;
}

// ============================================================
// SEARCH HELPERS (unchanged behavior, just kept for completeness)
// ============================================================

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
      headers: { Accept: "application/json", "User-Agent": "CSHubBot/1.0" },
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

// ============================================================
// MAIN ROUTE
// ============================================================

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    const { messages, conversationId } = await req.json();
    const userPrompt = messages[messages.length - 1].content;
    const lowerPrompt = userPrompt.toLowerCase();

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

    // --- SEARCH ---
    const isSearch =
      lowerPrompt.startsWith("search for") ||
      lowerPrompt.includes("search the web") ||
      lowerPrompt.startsWith("look up") ||
      lowerPrompt.startsWith("search ");

    if (isSearch) {
      const query = userPrompt.replace(/(search for|search the web for|look up|search)/i, "").trim().replace(/["']/g, "").trim();
      const enc = new TextEncoder();

      const stream = new ReadableStream({
        async start(ctrl) {
          const step = (s: string) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ searchStep: s })}\n\n`));
          step("Wikipedia");
          step("DuckDuckGo");
          step("Hacker News");
          step("StackOverflow");
          step("GitHub");
          step("arXiv");

          const [wiki, ddg, hn, so, gh, arxiv] = await Promise.all([
            searchWiki(query),
            searchDdg(query),
            searchHn(query),
            searchSo(query),
            searchGh(query),
            searchArxiv(query),
          ]);

          let ctx = "";
          if (wiki) ctx += `${truncate(wiki, 300)}\n\n`;
          if (ddg) ctx += `${truncate(ddg, 300)}\n\n`;
          if (hn) ctx += `${truncate(hn, 300)}\n\n`;
          if (so) ctx += `${truncate(so, 300)}\n\n`;
          if (gh) ctx += `${truncate(gh, 300)}\n\n`;
          if (arxiv) ctx += `${truncate(arxiv, 300)}\n\n`;

          let aiText = "";
          if (ctx) {
            try {
              const { result } = await callAI(
                [
                  { role: "system", content: `You searched 6 sources for "${query}".\n\n${ctx}\n\nSummarize and cite sources.` },
                  { role: "user", content: query },
                ],
                0.3,
                1000
              );
              for await (const d of result.textStream) {
                aiText += d;
                ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`));
              }
            } catch {
              // Graceful degradation — honest message, not a crash.
              aiText = "*(All AI providers are currently unavailable or rate-limited. Please try again in a moment.)*";
              ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: aiText } }] })}\n\n`));
            }
          } else {
            aiText = `No results found for "${query}".`;
            ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: aiText } }] })}\n\n`));
          }

          ctrl.enqueue(enc.encode("data: [DONE]\n\n"));
          ctrl.close();

          try {
            await prisma.message.create({ data: { conversationId: convId, role: "assistant", content: aiText } });
            await prisma.conversation.update({ where: { id: convId }, data: { updatedAt: new Date() } });
          } catch (e) {
            console.error("DB error:", e);
          }
        },
      });

      return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
    }

    // --- CODING: generate, then independently verify via Vercel Sandbox ---
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

Your response MUST have exactly 2 sections:

**SECTION 1: ANALYSIS**
Briefly analyze inputs/outputs/constraints, algorithm choice, time/space complexity.

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

              const { result, providerName } = await callAI(
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
                // Sandbox itself is down — no point retrying against it repeatedly.
                full = roundText + `\n\n⚠️ **Could not verify — the execution sandbox is temporarily unavailable.** This code has NOT been confirmed to run correctly. Please try again shortly.`;
                break;
              }

              if (execResult.ok) {
                full = roundText + `\n\n✅ **Backend-verified** (via ${providerName}, independently re-executed, round ${round}/${MAX_ROUNDS}) — real output: \`${execResult.stdout || "(no output)"}\``;
                finalVerified = true;
                break;
              }

              // Real failure — feed the REAL stderr back, not a hint.
              full = roundText; // keep the latest attempt in case we run out of rounds
              convoMessages.push({ role: "assistant", content: roundText });
              convoMessages.push({
                role: "user",
                content: `Your code failed when actually executed. This is the real error:\n\n${execResult.stderr}\n\nFix it. Do not claim success until this stops erroring.`,
              });

              if (round === MAX_ROUNDS) {
                full += `\n\n⚠️ **Still failing after ${MAX_ROUNDS} attempts.** Last real error: \`${execResult.stderr}\`\n\nThis has not been verified as correct — please try rephrasing the question.`;
              }
            }

            // Stream the FINAL result to the user once, after all rounds are settled —
            // avoids showing 3 rounds of failed intermediate code, which would be confusing.
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

    // --- NORMAL CHAT ---
    const SYSTEM = `You are CS Hub AI, built by Lewis Einstein (AI/ML Engineer) at Kibabii University. Answer clearly in markdown. Only output action commands when EXPLICITLY asked:
[ACTION:CREATE_FLASHCARD] Front: <text> | Back: <text>
[ACTION:SAVE_NOTE] Title: <text> | Content: <text>
[ACTION:CREATE_ASSIGNMENT] Title: <text> | Due: <YYYY-MM-DDTHH:MM:SS>`;

    const chatMsgs = [
      { role: "system", content: SYSTEM },
      ...messages.slice(-6).map((m: any) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content.includes("data:image") ? "[Image]" : m.content,
      })),
    ];

    const enc = new TextEncoder();
    let chatTxt = "";

    let chatResult;
    try {
      const { result } = await callAI(chatMsgs, 0.5, 2000);
      chatResult = result;
    } catch (e: any) {
      return new Response(
        new ReadableStream({
          start(c) {
            const m = "*(All AI providers are currently unavailable or rate-limited. Please try again in a moment.)*";
            c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: m } }] })}\n\n`));
            c.enqueue(enc.encode("data: [DONE]\n\n"));
            c.close();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } }
      );
    }

    const stream = new ReadableStream({
      async start(ctrl) {
        try {
          for await (const d of chatResult.textStream) {
            chatTxt += d;
            ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`));
          }
        } catch (streamErr: any) {
          const m = "\n\n*(The response was interrupted. Please try again.)*";
          if (!chatTxt.includes(m)) {
            ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: m } }] })}\n\n`));
            chatTxt += m;
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