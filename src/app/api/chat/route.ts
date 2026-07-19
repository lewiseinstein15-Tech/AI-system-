// SAVE THIS FILE AT: src/app/api/chat/route.ts
//
// This replaces your existing src/app/api/chat/route.ts file exactly —
// same path, same filename, so nothing else in your app that calls
// /api/chat will 404. Do not rename the file or its folder.

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Helper to truncate text so we don't crash the AI brain
function truncate(str: string | null, max: number) {
  if (!str) return null;
  return str.length > max ? str.substring(0, max) + "..." : str;
}

// Helper to fetch with a timeout so slow requests don't hold up the AI.
// This was already used for the search helpers below, but NOT for
// callGroq() or runPiston() — the two calls most likely to hang during
// the multi-round debugging loop. That gap is fixed further down.
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
  if (data.hits?.length > 0) {
    const text = data.hits.map((h: any) => `Title: ${h.title}`).join(' | ');
    return `Hacker News: ${text}`;
  }
  return null;
}

async function searchSo(query: string) {
  const res = await fetchWithTimeout(`https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(query)}&site=stackoverflow&pagesize=2`);
  const data = await res.json();
  if (data.items?.length > 0) {
    const text = data.items.map((i: any) => `Q: ${i.title}`).join(' | ');
    return `StackOverflow: ${text}`;
  }
  return null;
}

async function searchGh(query: string) {
  const res = await fetchWithTimeout(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=2`);
  const data = await res.json();
  if (data.items?.length > 0) {
    const text = data.items.map((i: any) => `Repo: ${i.full_name}`).join(' | ');
    return `GitHub: ${text}`;
  }
  return null;
}

async function searchArxiv(query: string) {
  const res = await fetchWithTimeout(`https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=2`);
  const xmlText = await res.text();
  const titles = [...xmlText.matchAll(/<title>(.*?)<\/title>/g)].map(m => m[1]).filter(t => t !== "arXiv Query Result");
  if (titles.length > 0) return `arXiv Papers: ${titles.join(' | ')}`;
  return null;
}

// --- SELF-DEBUGGING PIPELINE ---
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const PISTON_API_URL = "https://emkc.org/api/v2/piston/execute";
const MAX_DEBUG_ROUNDS = 5;

const SYSTEM_PROMPT = `You are the CS Hub AI, an expert coding assistant for Kibabii University CS students.

MANDATORY DEBUGGING WORKFLOW:
1. Write your first attempt at the solution.
2. You MUST call the execute_code tool to actually run it.
3. Read the REAL output/error. Do not guess.
4. If there is an error, FIX the code and call execute_code again. Repeat until correct.

MANDATORY VERIFICATION:
5. After passing execute_code, you MUST call stress_test_code for algorithmic problems. Write a simple brute-force solution and a random input generator.
6. If stress_test_code reports mismatches, fix your algorithm and test again until 0 mismatches.
7. Only after both tools pass should you give your final answer to the user. State what you verified.

ABSOLUTE RULE ON VERIFICATION CLAIMS:
- You must NEVER write prose claiming code was executed, tested, or verified unless you actually made a real execute_code or stress_test_code TOOL CALL in this conversation and are looking at its real returned result right now.
- Writing out a Python code block that CALLS stress_test_code as if it were a function in your own code is NOT the same as actually invoking the stress_test_code TOOL. That code will never run — you must invoke the tool directly.
- If you have not actually received a tool result confirming success, say plainly: "I have not yet verified this."`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "execute_code",
      description: "Executes code in a real sandboxed interpreter and returns stdout, stderr, and exit code.",
      parameters: {
        type: "object",
        properties: {
          language: { type: "string", description: "Language to run, e.g. 'python', 'javascript'" },
          code: { type: "string", description: "The complete code to execute" },
          stdin: { type: "string", description: "Optional stdin input" }
        },
        required: ["language", "code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stress_test_code",
      description: "Auto-generates N random test inputs and cross-checks an optimized solution against a brute-force reference.",
      parameters: {
        type: "object",
        properties: {
          function_name: { type: "string", description: "The exact function name both solutions must define." },
          solution_code: { type: "string", description: "Complete Python code defining the optimized solution." },
          brute_force_code: { type: "string", description: "Complete Python code defining a simple, obviously-correct reference function." },
          generator_code: { type: "string", description: "Complete Python code defining a function generate_input() returning a tuple of arguments." },
          num_trials: { type: "integer", description: "How many random trials to run. Default 200." }
        },
        required: ["function_name", "solution_code", "brute_force_code", "generator_code"],
      },
    },
  }
];

const PISTON_LANGUAGE_MAP: Record<string, { language: string; version: string }> = {
  python: { language: "python", version: "3.10.0" },
  javascript: { language: "javascript", version: "18.15.0" },
};

// FIX: runPiston now uses fetchWithTimeout instead of a plain fetch(),
// so a hung sandbox request can't stall the whole API route forever.
async function runPiston(language: string, version: string, code: string, stdin: string = "") {
  const res = await fetchWithTimeout(
    PISTON_API_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, version, files: [{ content: code }], stdin }),
    },
    15000 // 15s — sandbox execution can legitimately take longer than a simple API call
  );
  if (!res.ok) throw new Error(`Sandbox failed with status ${res.status}`);
  const data = await res.json();
  return data.run || {};
}

async function executeCode(language: string, code: string, stdin: string = ""): Promise<string> {
  const mapped = PISTON_LANGUAGE_MAP[language.toLowerCase()];
  if (!mapped) return JSON.stringify({ error: `Unsupported language ${language}` });
  try {
    const run = await runPiston(mapped.language, mapped.version, code, stdin);
    return JSON.stringify({ stdout: run.stdout ?? "", stderr: run.stderr ?? "", exit_code: run.code ?? null });
  } catch (err: any) {
    return JSON.stringify({ error: `Sandbox request failed: ${err.message}` });
  }
}

async function stressTestCode(args: any): Promise<string> {
  const trials = Math.min(Math.max(args.num_trials || 200, 1), 1000);
  // FIX: removed the leading space before ${args.solution_code} and
  // ${args.generator_code}. That single space was causing a real
  // IndentationError in Python every time this ran (verified directly
  // by executing the generated harness), meaning stress_test_code was
  // silently broken before this fix.
  const harness = `
import json
${args.solution_code}
_solution_fn = ${args.function_name}
_brute_ns = {}
exec(${JSON.stringify(args.brute_force_code)}, _brute_ns)
_brute_fn = _brute_ns[${JSON.stringify(args.function_name)}]
${args.generator_code}
mismatches = []
errors = []
for i in range(${trials}):
    try:
        inputs = generate_input()
        if not isinstance(inputs, tuple): inputs = (inputs,)
    except Exception as e:
        errors.append({"trial": i, "error": "gen err: " + str(e)}); continue
    try: sol = _solution_fn(*inputs)
    except Exception as e: errors.append({"trial": i, "inputs": repr(inputs), "error": "sol err: " + str(e)}); continue
    try: bru = _brute_fn(*inputs)
    except Exception as e: errors.append({"trial": i, "inputs": repr(inputs), "error": "brt err: " + str(e)}); continue
    if sol != bru: mismatches.append({"trial": i, "inputs": repr(inputs), "sol": repr(sol), "brt": repr(bru)})
    if len(mismatches) >= 5: break
print(json.dumps({"trials": ${trials}, "mismatches": len(mismatches), "mismatches_list": mismatches[:5], "errors": errors[:5], "all_passed": len(mismatches)==0 and len(errors)==0}))
`;
  try {
    const run = await runPiston("python", "3.10.0", harness, "");
    return run.stdout?.trim() || JSON.stringify({ error: "No output", stderr: run.stderr });
  } catch (err: any) {
    return JSON.stringify({ error: `Stress test failed: ${err.message}` });
  }
}

// FIX: added a timeout (was completely missing before — the single
// biggest suspect for "unable to fetch response" given the multi-round
// loop this function sits inside). Also switched to a model that's
// actually hosted on Groq (openai/gpt-oss-120b — confirmed via Groq's
// live model list, since "glm-5.2" returned a 404 model_not_found
// error, and GLM-5.2 turns out not to be available on Groq at all).
// Added a clear error if GROQ_API_KEY isn't set instead of silently
// sending "Bearer undefined".
async function callGroq(messages: any[]) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not set in environment variables");
  }

  const res = await fetchWithTimeout(
    GROQ_API_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        // Switched from "glm-5.2" (confirmed via Groq's live model list to
        // NOT exist on Groq — that's what caused the 404 model_not_found
        // error) to openai/gpt-oss-120b, which IS hosted on Groq and
        // supports tool calling + reasoning, matching what this
        // execute_code / stress_test_code pipeline needs.
        // Override via GROQ_GLM_MODEL env var if you switch models later.
        model: process.env.GROQ_GLM_MODEL || "openai/gpt-oss-120b",
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        temperature: 0.15,
        max_tokens: 4000,
      }),
    },
    20000 // 20s — reasoning models can be slower than "instant" models
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Groq API error (${res.status}): ${text}`);
  }
  return res.json();
}

function safeParse(s: string) {
  try { return JSON.parse(s); } catch { return { raw: s }; }
}

// Backend-level guardrail to catch hallucinated verification claims
const VERIFICATION_CLAIM_PATTERNS = [
  /verified/i,
  /passes? all( the)? tests?/i,
  /tested against/i,
  /ran (this|the) (code|solution)/i,
  /confirmed (to be )?correct/i,
  /0 mismatches/i,
];

function checkForUnverifiedClaims(finalAnswer: string, executionLog: any[]): { flagged: boolean; note?: string } {
  const claimsVerification = VERIFICATION_CLAIM_PATTERNS.some((re) => re.test(finalAnswer));
  if (!claimsVerification) return { flagged: false };

  const ranStressTest = executionLog.some((entry) => entry.type === "stress_test_code" && entry.result && entry.result.all_passed === true);
  const ranExecuteCode = executionLog.some((entry) => entry.type === "execute_code");

  if (!ranStressTest && !ranExecuteCode) {
    return {
      flagged: true,
      note: "⚠️ **System Warning:** This response claims the code was tested/verified, but no execute_code or stress_test_code tool was actually called in this session. Treat any 'verified' claim above with caution — it may be fabricated."
    };
  }

  if (/stress test|brute force|random (cases|trials)/i.test(finalAnswer) && !ranStressTest) {
    return {
      flagged: true,
      note: "⚠️ **System Warning:** This response references stress testing against a brute force / random trials, but stress_test_code was never actually called (or didn't return all_passed: true) in this session. Treat that specific claim with caution."
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
              const synthRes = await callGroq(synthesizeMessages);
              // FIX: guard against an empty/undefined choices array
              // instead of crashing on synthRes.choices[0].message.content.
              aiText = synthRes.choices?.[0]?.message?.content
                || `I found some results for "${query}" but couldn't summarize them. Please try again.`;
            } catch (e: any) {
              aiText = `I found results for "${query}" but the summarizer failed: ${e.message}`;
            }
          } else {
            aiText = `I searched for "${query}", but couldn't find a direct answer.`;
          }

          const words = aiText.split(' ');
          for (const word of words) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: word + ' ' } }] })}\n\n`));
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
    let aiText = "";

    if (isCodingQuestion) {
      const groqMessages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages.slice(-4).map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content.includes("data:image") ? "[Image]" : m.content }))
      ];

      let debugRounds = 0;
      const executionLog: any[] = []; // Track real tool executions

      while (debugRounds < MAX_DEBUG_ROUNDS) {
        const response = await callGroq(groqMessages);
        const message = response.choices?.[0]?.message;

        // FIX: guard against Groq returning an empty choices array,
        // which previously crashed on message.tool_calls.
        if (!message) {
          aiText = "The AI service returned an unexpected empty response. Please try again.";
          break;
        }

        if (message.tool_calls && message.tool_calls.length > 0) {
          groqMessages.push(message);
          for (const toolCall of message.tool_calls) {
            const args = JSON.parse(toolCall.function.arguments);
            let result = "";
            if (toolCall.function.name === "execute_code") {
              result = await executeCode(args.language, args.code, args.stdin || "");
              executionLog.push({ type: "execute_code", language: args.language, code: args.code, result: safeParse(result) });
            } else if (toolCall.function.name === "stress_test_code") {
              result = await stressTestCode(args);
              executionLog.push({ type: "stress_test_code", function_name: args.function_name, num_trials: args.num_trials || 200, result: safeParse(result) });
            } else {
              result = JSON.stringify({ error: "Unknown tool" });
            }
            groqMessages.push({ role: "tool", tool_call_id: toolCall.id, content: result });
          }
          debugRounds++;
        } else {
          aiText = message.content || "";
          break;
        }
      }
      
      if (!aiText) aiText = "I tried to solve this but couldn't verify it properly. Here is my best attempt.";

      // Run the hallucination check
      const verificationCheck = checkForUnverifiedClaims(aiText, executionLog);
      if (verificationCheck.flagged) {
        aiText = `${aiText}\n\n${verificationCheck.note}`;
      }

    } else {
      // --- NORMAL AI CHAT ---
      const systemPrompt = `You are CS Hub AI, created by Lewis Einstein. If asked who built you, say "I was built by Lewis Einstein." You have TOOLS. Output ONLY the command: 1. [ACTION:CREATE_FLASHCARD] Front: <text> | Back: <text> 2. [ACTION:SAVE_NOTE] Title: <text> | Content: <text> 3. [ACTION:CREATE_ASSIGNMENT] Title: <text> | Due: <YYYY-MM-DDTHH:MM:SS>`;
      const recentMessages = messages.slice(-10);
      const aiMessages = [
        { role: "system", content: systemPrompt },
        ...recentMessages.map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content.includes("data:image") ? "[Image]" : m.content }))
      ];
      const response = await callGroq(aiMessages);
      // FIX: guard against empty choices here too.
      aiText = response.choices?.[0]?.message?.content || "I couldn't generate a response. Please try again.";
    }

    const lowerAiText = aiText.toLowerCase();
    if (lowerAiText.includes("action:create_flashcard") || (lowerUserPrompt.includes("create") && lowerUserPrompt.includes("flashcard"))) {
      const match = aiText.match(/Front:\s*(.*?)\s*\|\s*Back:\s*(.*)/i);
      if (match) {
        await prisma.flashcard.create({ data: { front: match[1].trim(), back: match[2].trim(), userId: session.user.id } });
        aiText = "✅ **Agent Action:** I have successfully created and saved that flashcard to your Dashboard!";
      }
    } else if (lowerAiText.includes("action:save_note") || (lowerUserPrompt.includes("save") && lowerUserPrompt.includes("note"))) {
      const match = aiText.match(/Title:\s*(.*?)\s*\|\s*Content:\s*(.*)/i);
      if (match) {
        await prisma.note.create({ data: { title: match[1].trim(), content: match[2].trim(), userId: session.user.id } });
        aiText = "✅ **Agent Action:** I have successfully saved that note to your Dashboard!";
      }
    } else if (lowerAiText.includes("action:create_assignment") || (lowerUserPrompt.includes("add") && lowerUserPrompt.includes("assignment"))) {
      const match = aiText.match(/Title:\s*(.*?)\s*\|\s*Due:\s*(.*)/i);
      if (match) {
        const dueDate = new Date(match[2].trim());
        if (!isNaN(dueDate.getTime())) {
          await prisma.assignment.create({ data: { title: match[1].trim(), dueDate, userId: session.user.id } });
          aiText = "✅ **Agent Action:** I have successfully scheduled that assignment in your Dashboard!";
        }
      }
    }

    // --- STREAM RESPONSE TO UI ---
    const encoder = new TextEncoder();
    const customStream = new ReadableStream({
      async start(controller) {
        const words = aiText.split(' ');
        for (const word of words) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: word + ' ' } }] })}\n\n`));
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
        await prisma.message.create({ data: { conversationId: currentConvId, role: "assistant", content: aiText } });
        await prisma.conversation.update({ where: { id: currentConvId }, data: { updatedAt: new Date() } });
      },
    });

    return new Response(customStream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
  } catch (error: any) {
    console.error("Chat API Error:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error", details: error.message }), { status: 500 });
  }
}
