import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
      
      await prisma.message.create({
        data: {
          conversationId: currentConvId,
          role: "user",
          content: userPrompt,
        },
      });
    }

    // --- OPTIMIZED AGENT PROMPT ---
    const systemPrompt = `You are CS Hub AI, an elite assistant created by Lewis Einstein (AI/ML Engineer) for Kibabii University. 
    If asked who built you, say "I was built by Lewis Einstein."
    You have COMMANDS. If you use one, output ONLY the command (NO JSON, NO markdown):
    1. [ACTION:CREATE_FLASHCARD] Front: <text> | Back: <text>
    2. [ACTION:SAVE_NOTE] Title: <text> | Content: <text>
    3. [ACTION:CREATE_ASSIGNMENT] Title: <text> | Due: <YYYY-MM-DDTHH:MM:SS>
    4. [ACTION:SEARCH_WEB] <query>
    5. [ACTION:RUN_CODE] <language> \n <code>
    If no command is needed, answer normally.`;

    const aiMessages = [
      { role: "system", content: systemPrompt },
      ...messages.map((m: any) => {
        let safeContent = m.content;
        if (safeContent.includes("data:image")) {
          safeContent = safeContent.replace(/data:image\/[^;]+;base64,[^"\\)]+/g, "[User attached an image]");
        }
        return { role: m.role === "assistant" ? "assistant" : "user", content: safeContent };
      })
    ];

    // --- SMART AI CALL WITH FALLBACK ---
    let aiText = "";
    try {
      const aiRes = await fetch("https://text.pollinations.ai/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: aiMessages, model: "openai", private: true })
      });
      
      if (aiRes.ok) {
        aiText = await aiRes.text();
      } else {
        throw new Error("AI API returned an error");
      }
    } catch (err) {
      // If the AI brain crashes, fallback to Mistral model
      try {
        const fallbackRes = await fetch("https://text.pollinations.ai/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: aiMessages, model: "mistral", private: true })
        });
        if (fallbackRes.ok) {
          aiText = await fallbackRes.text();
        } else {
          aiText = "I'm having trouble connecting to my AI brain right now. Please try again in a moment.";
        }
      } catch (err2) {
         aiText = "I'm having trouble connecting to my AI brain right now. Please try again in a moment.";
      }
    }

    // --- AGENT ACTION INTERCEPTOR ---
    const lowerAiText = aiText.toLowerCase();
    const lowerUserPrompt = userPrompt.toLowerCase();
    
    // 1. Flashcard
    if (lowerAiText.includes("action:create_flashcard") || (lowerUserPrompt.includes("create") && lowerUserPrompt.includes("flashcard"))) {
      const match = aiText.match(/Front:\s*(.*?)\s*\|\s*Back:\s*(.*)/i);
      // If AI didn't provide the format, extract from user prompt
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
    // 4. Web Search (With Fallback!)
    else if (lowerAiText.includes("action:search_web") || lowerUserPrompt.includes("search the web")) {
      let query = aiText.replace(/.*action:search_web\]/i, "").trim();
      if (!query || query.startsWith("i couldn't")) {
        // If AI failed, extract query from user prompt
        query = userPrompt.replace(/.*search the web for/i, "").trim();
      }
      query = query.replace(/["']/g, "").trim();
      
      // Search Wikipedia directly
      const searchRes = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`);
      const searchData = await searchRes.json();
      
      let searchResultText = `I searched the live internet for "${query}", but couldn't find a direct answer.`;

      if (searchData.query && searchData.query.search.length > 0) {
        const topTitle = searchData.query.search[0].title;
        const summaryRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topTitle)}`);
        const summaryData = await summaryRes.json();
        if (summaryData.extract) {
          searchResultText = `🔍 I searched the live internet and found this regarding **${topTitle}**:\n\n${summaryData.extract}\n\n*(Source: Wikipedia Live API)*`;
        }
      }
      aiText = searchResultText; // Override AI text with actual search results
    }
    // 5. Run Code
    else if (lowerAiText.includes("action:run_code") || lowerUserPrompt.includes("run code")) {
      const match = aiText.match(/action:run_code\]\s*(\w+)\s*\n([\s\S]*)/i);
      const language = match?.[1] || "python";
      const code = match?.[2] || userPrompt.replace(/.*run this.*code/i, "").replace(/```python|```/g, "").trim();
      
      try {
        const pistonRes = await fetch("https://emkc.org/api/v2/piston/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language, version: "*", files: [{ content: code }] })
        });

        if (pistonRes.ok) {
          const pistonData = await pistonRes.json();
          const output = pistonData.run.output || "No output.";
          aiText = `💻 **Code Executed Successfully:**\n\n\`\`\`\n${output}\n\`\`\``;
        } else {
          aiText = "❌ I couldn't run that code. The execution engine might not support that language.";
        }
      } catch (e) {
        aiText = "❌ The code execution engine is currently unavailable.";
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
          await new Promise((resolve) => setTimeout(resolve, 50));
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