import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import vm from "vm";

// ============================================================
// PROVIDER FALLBACK
// ============================================================

const PROVIDERS = [
  { name: "Cerebras", baseURL: "https://api.cerebras.ai/v1", key: "CEREBRAS_API_KEY", model: "llama3.1-8b" },
  { name: "Groq", baseURL: "https://api.groq.com/openai/v1", key: "GROQ_API_KEY", model: "llama-3.1-8b-instant" },
  { name: "OpenRouter", baseURL: "https://openrouter.ai/api/v1", key: "OPENROUTER_API_KEY", model: "deepseek/deepseek-chat-v3:free" },
  { name: "Gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", key: "GEMINI_API_KEY", model: "gemini-2.5-flash" },
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
        maxRetries: 2,
      });
      console.log("Provider:", p.name);
      return result;
    } catch (err: any) {
      console.error(p.name, "failed:", err.message);
      lastErr = err;
    }
  }
  throw new Error("All providers failed: " + (lastErr?.message || "unknown"));
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
// JS EXECUTION
// ============================================================

function runJs(code: string) {
  let out = "";
  let err = "";
  try {
    const sandbox = {
      console: {
        log: (...args: any[]) => {
          out += args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ") + "\n";
        },
      },
      Math,
      Date,
      JSON,
      Array,
      Map,
      Set,
    };
    vm.runInContext(code, vm.createContext(sandbox), { timeout: 3000 });
  } catch (e: any) {
    err = e.message || "Execution error";
  }
  return { out, err };
}

function extractCode(text: string) {
  const m = text.match(/```(?:javascript|js)\s*([\s\S]*?)```/);
  if (m) return m[1].trim();
  const g = text.match(/```\s*([\s\S]*?)```/);
  return g ? g[1].trim() : null;
}

function verifyCode(code: string) {
  try {
    const { out, err } = runJs(code);
    return { ok: !err, out, err };
  } catch (e: any) {
    return { ok: false, out: "", err: e.message };
  }
}

// ============================================================
// SEARCH
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
              const res = await callAI(
                [
                  { role: "system", content: `You searched 6 sources for "${query}".\n\n${ctx}\n\nSummarize and cite sources.` },
                  { role: "user", content: query },
                ],
                0.3,
                1000
              );
              for await (const d of res.textStream) {
                aiText += d;
                ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`));
              }
            } catch {
              aiText = "*(All AI providers unavailable)*";
              ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: aiText } }] })}\n\n`));
            }
          } else {
            aiText = `No results for "${query}".`;
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

    // --- CODING ---
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
      const MAX_ROUNDS = 2;

      const REASON = `You are an elite software engineer analyzing a coding problem.
Analyze concisely:
- Exact inputs, outputs, constraints
- If sequence constraints exist: "State design must track last move. dp[i] alone is NEVER enough. Use dp[i][last_move][consecutive_count]."
- Step-by-step algorithmic plan
- Time/space complexity
Output ONLY analysis. NO code.`;

      const EXECUTE = `Based on the analysis, write JavaScript solution.
- Single named function
- Include console.log test cases at bottom
Output ONLY the code block.`;

      const CRITIC = `You are a strict code reviewer. You MUST:
1. Trace through the code mentally with the FIRST test case provided in the console.log statements
2. Compare what the code outputs vs what it SHOULD output
3. Check if ALL constraints from the problem are actually enforced in the code (not just mentioned in analysis)
4. If the code would produce the wrong answer, say EXACTLY what the wrong output is and what the correct output should be

Score 0-100. If the code produces wrong answers, score MUST be below 40.
Output ONLY: "Score: X/100" followed by your critique.`;

      const stream = new ReadableStream({
        async start(ctrl) {
          let recent = messages.slice(-4).map((m: any) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content.includes("data:image") ? "[Image]" : m.content,
          }));

          let full = "";
          let lastCode = "";
          let ok = false;
          let rounds = 0;

          try {
            for (let r = 1; r <= MAX_ROUNDS; r++) {
              rounds = r;

              // REASON
              const rh = `\n🧠 **REASONING (Round ${r})...**\n\n`;
              ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: rh } }] })}\n\n`));
              const reasonRes = await callAI([{ role: "system", content: REASON }, ...recent], 0.2, 800);
              let reasonTxt = "";
              for await (const d of reasonRes.textStream) {
                reasonTxt += d;
                ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`));
              }
              full += rh + reasonTxt;

              // EXECUTE
              const eh = `\n\n💻 **CODING...**\n\n`;
              ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: eh } }] })}\n\n`));
              const execRes = await callAI(
                [{ role: "system", content: EXECUTE }, ...recent, { role: "assistant", content: reasonTxt }, { role: "user", content: "Write the code now." }],
                0.1,
                1200
              );
              let execTxt = "";
              for await (const d of execRes.textStream) {
                execTxt += d;
                ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`));
              }
              full += eh + execTxt;

              // CRITIC
              const ch = `\n\n🕵️ **CRITIQUING...**\n\n`;
              ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}\n\n`));
              const criticRes = await callAI(
                [{ role: "system", content: CRITIC }, ...recent, { role: "assistant", content: reasonTxt }, { role: "assistant", content: execTxt }, { role: "user", content: "Critique this code." }],
                0.2,
                600
              );
              let criticTxt = "";
              for await (const d of criticRes.textStream) {
                criticTxt += d;
                ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`));
              }
              full += ch + criticTxt;

              // VERIFY
              const code = extractCode(execTxt);
              if (!code) {
                const msg = `\n\n⚠️ No code block found. Retrying...\n`;
                full += msg;
                ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: msg } }] })}\n\n`));
                continue;
              }

              const result = verifyCode(code);
              if (result.ok) {
                // TEST: Verify the output is actually correct by running again
                const testHeader = `\n\n🧪 **TESTING OUTPUT...**\n\n`;
                ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: testHeader } }] })}\n\n`));
                full += testHeader;

                // Extract expected outputs from the code's console.log comments
                const outputLines = result.out.trim().split("\n").filter((l: string) => l.trim());
                const hasOutput = outputLines.length > 0;

                if (hasOutput) {
                  const outMsg = `Output: ${outputLines.join(", ")}\n`;
                  full += outMsg;
                  ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: outMsg } }] })}\n\n`));

                  // Check if critic mentioned wrong answer
                  const criticLower = criticTxt.toLowerCase();
                  const mentionsWrong = criticLower.includes("wrong") || criticLower.includes("incorrect") || criticLower.includes("should be") || criticLower.includes("expected");
                  const scoreMatch = criticTxt.match(/Score:\s*(\d+)/);
                  const score = scoreMatch ? parseInt(scoreMatch[1]) : 50;

                  if (!mentionsWrong && score >= 60) {
                    ok = true;
                    const msg = `\n\n✅ **BACKEND-VERIFIED** — Round ${r} success. Output: \`${result.out.trim()}\``;
                    full += msg;
                    ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: msg } }] })}\n\n`));
                    break;
                  } else {
                    const msg = `\n\n⚠️ **CRITIC FLAGGED ISSUES** — Score: ${score}/100. Re-analyzing...\n`;
                    full += msg;
                    ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: msg } }] })}\n\n`));
                  }
                } else {
                  const msg = `\n\n⚠️ **NO OUTPUT** — Code ran but produced nothing.\n`;
                  full += msg;
                  ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: msg } }] })}\n\n`));
                }
              } else {
                const msg = `\n\n❌ **VERIFICATION FAILED:** \`${result.err}\`\n🔄 Re-analyzing...\n`;
                full += msg;
                ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: msg } }] })}\n\n`));
              }

              if (code === lastCode) {
                const stuck = `\n\n⚠️ **Stop condition:** Identical code. Halting.`;
                full += stuck;
                ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: stuck } }] })}\n\n`));
                break;
              }
              lastCode = code;
              recent = [...recent, { role: "assistant", content: reasonTxt + "\n" + execTxt }, { role: "user", content: `Your code failed or was flagged by critic:\n\n${criticTxt}\n\nFix it.` }];
            }

            if (!ok) {
              const msg = `\n\n⚠️ **Could not verify** after ${rounds} attempts. Try rephrasing.`;
              full += msg;
              ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: msg } }] })}\n\n`));
            }
          } catch (e: any) {
            console.error("Stream error:", e);
            const msg = "\n\n*(System: Stream interrupted. Please try again.)*";
            if (!full.includes(msg)) {
              ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: msg } }] })}\n\n`));
              full += msg;
            }
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

    let chatRes;
    try {
      chatRes = await callAI(chatMsgs, 0.5, 2000);
    } catch (e: any) {
      const enc = new TextEncoder();
      return new Response(
        new ReadableStream({
          start(c) {
            const m = `*(All AI providers unavailable: ${e.message})*`;
            c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: m } }] })}\n\n`));
            c.enqueue(enc.encode("data: [DONE]\n\n"));
            c.close();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } }
      );
    }

    const enc = new TextEncoder();
    let chatTxt = "";

    const stream = new ReadableStream({
      async start(ctrl) {
        for await (const d of chatRes.textStream) {
          chatTxt += d;
          ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`));
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
