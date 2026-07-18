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

    // --- AGENT SYSTEM PROMPT ---
    // Strictly forbade JSON so it uses our simple text format
    const systemPrompt = `You are Computer Science Hub AI, an elite agent for CS students. You were created by Lewis Einstein, an AI and ML Engineer, for Kibabii University.
    
    You have special COMMANDS you can use. If you want to use a command, your ENTIRE response must be ONLY the command text. DO NOT use JSON. DO NOT use markdown.
    
    COMMAND 1: SAVE FLASHCARD
    Format exactly like this: [ACTION:CREATE_FLASHCARD] Front: <front text> | Back: <back text>
    
    COMMAND 2: SAVE NOTE
    Format exactly like this: [ACTION:SAVE_NOTE] Title: <title text> | Content: <content text>
    
    COMMAND 3: SEARCH WEB
    Format exactly like this: [ACTION:SEARCH_WEB] <search query>
    
    If the user does NOT ask to save a note, save a flashcard, or search the web, just answer their question normally with perfect markdown.`;

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

    const aiRes = await fetch("https://text.pollinations.ai/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: aiMessages, model: "openai", private: true })
    });
    
    let aiText = "I couldn't connect to the AI brain right now. Please try again.";
    if (aiRes.ok) {
      aiText = await aiRes.text();
    }

    // --- AGENT ACTION INTERCEPTOR (Smarter Regex) ---
    const lowerAiText = aiText.toLowerCase();
    
    if (lowerAiText.includes("action:create_flashcard")) {
      // Look for Front: and Back: anywhere in the text
      const match = aiText.match(/Front:\s*(.*?)\s*\|\s*Back:\s*(.*)/i);
      if (match) {
        await prisma.flashcard.create({
          data: { front: match[1].trim(), back: match[2].trim(), userId: session.user.id }
        });
        aiText = "✅ **Agent Action:** I have successfully created and saved that flashcard to your Dashboard!";
      }
    } 
    else if (lowerAiText.includes("action:save_note")) {
      const match = aiText.match(/Title:\s*(.*?)\s*\|\s*Content:\s*(.*)/i);
      if (match) {
        await prisma.note.create({
          data: { title: match[1].trim(), content: match[2].trim(), userId: session.user.id }
        });
        aiText = "✅ **Agent Action:** I have successfully saved that note to your Dashboard!";
      }
    } 
    else if (lowerAiText.includes("action:search_web")) {
      // Extract the query after the action tag
      let query = aiText.replace(/.*action:search_web\]/i, "").trim();
      // Remove any quotes or extra text
      query = query.replace(/["']/g, "").trim();
      
      // 1. Search Wikipedia (Free, no API key)
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
      aiText = searchResultText;
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