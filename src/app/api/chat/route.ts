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

    // --- SMART AI WITH MEMORY (Pollinations.ai - No API Key Needed) ---
    const systemPrompt = "You are Computer Science Hub AI, an elite assistant for CS students. You were created, coded, and deployed by Lewis Einstein, an AI and ML Engineer. You are specifically designed for students at Kibabii University in Kenya. If anyone asks who built you, who created you, or who is your developer, you must strictly answer 'I was built by Lewis Einstein, an AI and ML Engineer.' Provide accurate, well-formatted markdown responses with syntax highlighting. Focus on programming, math, algorithms, and computer science principles. If asked to write code, write the code.";
    
    // 1. Build conversation history string (take last 4 messages to avoid URL length limits)
    let historyString = "";
    const recentMessages = messages.slice(-4); 
    for (const msg of recentMessages) {
      if (msg.role === 'user') {
        historyString += `User: ${msg.content}\n`;
      } else if (msg.role === 'assistant') {
        historyString += `AI: ${msg.content}\n`;
      }
    }
    
    // 2. Combine system prompt, history, and ask AI for the next response
    const fullPrompt = `${systemPrompt}\n\n${historyString}AI:`;
    const encodedPrompt = encodeURIComponent(fullPrompt);
    
    const aiRes = await fetch(`https://text.pollinations.ai/${encodedPrompt}`);
    
    let aiText = "I couldn't connect to the AI brain right now. Please try again.";
    if (aiRes.ok) {
      aiText = await aiRes.text();
    }

    // 3. Stream the smart response to the UI (typing effect)
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
          data: {
            conversationId: currentConvId,
            role: "assistant",
            content: aiText,
          },
        });
        await prisma.conversation.update({
          where: { id: currentConvId },
          data: { updatedAt: new Date() },
        });
      },
    });

    return new Response(customStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error("Chat API Error:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 });
  }
}