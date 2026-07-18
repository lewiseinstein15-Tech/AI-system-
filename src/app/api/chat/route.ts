import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { groq } from '@ai-sdk/groq';
import { generateText } from 'ai';

// Helper to truncate text so we don't crash the AI brain
function truncate(str: string | null, max: number) {
  if (!str) return null;
  return str.length > max ? str.substring(0, max) + "..." : str;
}

// Helper to fetch with a timeout so slow websites don't hold up the AI
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

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const { messages, conversationId } = await req.json();
    const userPrompt = messages[messages.length - 1].content;

    let currentConvId = conversationId;

    if (!currentConvId) {
      const newConversation = await prisma.conversation.create({
        data: {
          userId: session.user.id,
          title: userPrompt.substring(0, 30) + "...",
        },
      });
      currentConvId = newConversation.id;
    }
    
    // ALWAYS save the user's prompt to the database
    await prisma.message.create({
      data: {
        conversationId: currentConvId,
        role: "user",
        content: userPrompt,
      },
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
          const sendStep = (step: string) => {
            const token = JSON.stringify({ searchStep: step });
            controller.enqueue(encoder.encode(`data: ${token}\n\n`));
          };
          
          sendStep("Wikipedia");
          sendStep("DuckDuckGo");
          sendStep("Hacker News");
          sendStep("StackOverflow");
          sendStep("GitHub");
          sendStep("arXiv");
          
          const [wiki, ddg, hn, so, gh, arxiv] = await Promise.all([
            searchWiki(query).catch(() => null),
            searchDdg(query).catch(() => null),
            searchHn(query).catch(() => null),
            searchSo(query).catch(() => null),
            searchGh(query).catch(() => null),
            searchArxiv(query).catch(() => null)
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
              { role: "system", content: `You just searched 6 live internet sources for "${query}". Here are the raw search results:\n\n${searchContext}\n\nPlease read these results and give the user a smart, well-formatted summary answering their query. Mention which sources you found the information from. Keep your answer concise (max 500 words).` },
              { role: "user", content: query }
            ];

            const result = await generateText({
              model: groq('llama-3.1-8b-instant'),
              messages: synthesizeMessages
            });
            aiText = result.text;
          } else {
            aiText = `I searched Wikipedia, DuckDuckGo, Hacker News, StackOverflow, GitHub, and arXiv for "${query}", but couldn't find a direct answer. Try rephrasing your search.`;
          }

          const words = aiText.split(' ');
          for (const word of words) {
            const token = JSON.stringify({ choices: [{ delta: { content: word + ' ' } }] });
            controller.enqueue(encoder.encode(`data: ${token}\n\n`));
          }
          
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();

          await prisma.message.create({
            data: { conversationId: currentConvId, role: "assistant", content: aiText }
          });
          await prisma.conversation.update({
            where: { id: currentConvId },
            data: { updatedAt: new Date() }
          });
        }
      });

      return new Response(searchStream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
      });
    }

    // --- NORMAL AI CHAT & AGENT TOOLS ---
    const systemPrompt = `You are CS Hub AI, an elite assistant created by Lewis Einstein (AI/ML Engineer) for Kibabii University. 
    If asked who built you, say "I was built by Lewis Einstein, an AI and ML Engineer."
    You have full memory of this conversation. You can see the entire chat history provided to you. Do not say you don't save conversations, because your memory is handled by the system.
    
    You have TOOLS. When a user asks you to perform an action, you MUST output ONLY the tool command. DO NOT explain the code. DO NOT add markdown formatting around the command.
    
    TOOL 1: SAVE FLASHCARD
    If user says "create flashcard", output ONLY: [ACTION:CREATE_FLASHCARD] Front: <text> | Back: <text>
    
    TOOL 2: SAVE NOTE
    If user says "save note", output ONLY: [ACTION:SAVE_NOTE] Title: <text> | Content: <text>
    
    TOOL 3: CREATE ASSIGNMENT
    If user says "add assignment", output ONLY: [ACTION:CREATE_ASSIGNMENT] Title: <text> | Due: <YYYY-MM-DDTHH:MM:SS>

    CYBERSECURITY MODES:
    If the user says "HACK THIS" or "Test Security", act as an Ethical Hacker (Red Team). Analyze the provided code, identify vulnerabilities (SQLi, XSS, RCE, etc.), and write a Proof of Concept (PoC) showing how a hacker could exploit it. Always add a warning: "For educational purposes only."
    
    If the user says "FIX SECURITY" or "Defend This", act as a Security Engineer (Blue Team). Analyze the code, patch all vulnerabilities, and output the secure, production-ready version of the code with comments explaining the fixes.
    
    If the user asks you to run or execute code, DO NOT use a tool. Just mentally trace the code and provide the expected output in a markdown code block.
    If no tool or security mode is needed, answer normally with perfect markdown. Keep answers concise (max 800 words).`;

    // Keep the last 10 messages for memory
    const recentMessages = messages.slice(-10);
    
    const aiMessages = [
      { role: "system", content: systemPrompt },
      ...recentMessages.map((m: any) => {
        let safeContent = m.content;
        
        // VISION: If the message contains an image, format it for the Vision model
        if (safeContent.includes("data:image")) {
          const base64Match = safeContent.match(/data:image\/[^;]+;base64,[^"\\)]+/g);
          if (base64Match) {
            const imageUrl = base64Match[0];
            const textContent = safeContent.replace(/\[Attached Image:.*?\]/, "").replace(imageUrl, "").trim();
            
            return {
              role: m.role === "assistant" ? "assistant" : "user",
              content: [
                { type: "text", text: textContent || "What is in this image?" },
                { type: "image_url", image_url: { url: imageUrl } } // FIXED FORMATTING
              ]
            };
          }
        }
        
        if (safeContent.length > 2000) {
          safeContent = safeContent.substring(0, 2000) + "... [truncated]";
        }
        return { role: m.role === "assistant" ? "assistant" : "user", content: safeContent };
      })
    ];

    // Use Groq for normal chat. If an image is present, use the Vision model.
    const hasImage = aiMessages.some((m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.type === "image_url"));
    
    const result = await generateText({
      model: groq(hasImage ? 'llama-3.2-11b-vision-preview' : 'llama-3.1-8b-instant'),
      messages: aiMessages
    });
    
    let aiText = result.text;

    const lowerAiText = aiText.toLowerCase();
    
    // 1. Flashcard
    if (lowerAiText.includes("action:create_flashcard") || (lowerUserPrompt.includes("create") && lowerUserPrompt.includes("flashcard"))) {
      const match = aiText.match(/Front:\s*(.*?)\s*\|\s*Back:\s*(.*)/i);
      const front = match?.[1] || userPrompt.split("Front:")[1]?.split("|")[0]?.trim() || "";
      const back = match?.[2] || userPrompt.split("Back:")[1]?.trim() || "";
      if (front && back) {
        await prisma.flashcard.create({ data: { front, back, userId: session.user.id } });
        aiText = "✅ **Agent Action:** I have successfully created and saved that flashcard to your Dashboard!";
      }
    } 
    // 2. Note
    else if (lowerAiText.includes("action:save_note") || (lowerUserPrompt.includes("save") && lowerUserPrompt.includes("note"))) {
      const match = aiText.match(/Title:\s*(.*?)\s*\|\s*Content:\s*(.*)/i);
      const title = match?.[1] || userPrompt.split("Title:")[1]?.split("|")[0]?.trim() || "Untitled Note";
      const content = match?.[2] || userPrompt.split("Content:")[1]?.trim() || "";
      if (title && content) {
        await prisma.note.create({ data: { title, content, userId: session.user.id } });
        aiText = "✅ **Agent Action:** I have successfully saved that note to your Dashboard!";
      }
    } 
    // 3. Assignment
    else if (lowerAiText.includes("action:create_assignment") || (lowerUserPrompt.includes("add") && lowerUserPrompt.includes("assignment"))) {
      const match = aiText.match(/Title:\s*(.*?)\s*\|\s*Due:\s*(.*)/i);
      const title = match?.[1] || userPrompt.split("Title:")[1]?.split("|")[0]?.trim() || "Untitled Assignment";
      const dueStr = match?.[2] || userPrompt.split("Due:")[1]?.trim() || new Date().toISOString();
      const dueDate = new Date(dueStr);
      if (!isNaN(dueDate.getTime())) {
        await prisma.assignment.create({ data: { title, dueDate, userId: session.user.id } });
        aiText = "✅ **Agent Action:** I have successfully scheduled that assignment in your Dashboard!";
      }
    }

    // --- STREAM RESPONSE TO UI ---
    const encoder = new TextEncoder();
    const customStream = new ReadableStream({
      async start(controller) {
        const words = aiText.split(' ');
        for (const word of words) {
          const token = JSON.stringify({ choices: [{ delta: { content: word + ' ' } }] });
          controller.enqueue(encoder.encode(`data: ${token}\n\n`));
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();

        await prisma.message.create({
          data: { conversationId: currentConvId, role: "assistant", content: aiText }
        });
        await prisma.conversation.update({
          where: { id: currentConvId },
          data: { updatedAt: new Date() }
        });
      },
    });

    return new Response(customStream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
    });
  } catch (error) {
    console.error("Chat API Error:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 });
  }
}