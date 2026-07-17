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

    // --- SMART AI WITH IMAGES & DIAGRAMS ---
    const systemPrompt = `You are Computer Science Hub AI, an elite assistant for CS students. You were created, coded, and deployed by Lewis Einstein, an AI and ML Engineer. You are specifically designed for students at Kibabii University in Kenya. If anyone asks who built you, who created you, or who is your developer, you must strictly answer 'I was built by Lewis Einstein, an AI and ML Engineer.' Provide accurate, well-formatted markdown responses with syntax highlighting. Focus on programming, math, algorithms, and computer science principles.

    SPECIAL ABILITIES:
    1. IMAGES: If the user asks you to generate an image, draw a picture, or create a photo, you MUST respond ONLY with a markdown image link using this exact format: ![Image Description](https://image.pollinations.ai/prompt/{URL%20Encoded%20Description%20of%20Image}). Do not add any other text.
    2. DIAGRAMS: If the user asks for a diagram, architecture, or flowchart, you MUST use Mermaid.js code blocks. Example: \`\`\`mermaid graph TD; A-->B; \`\`\`.`;

    // Build conversation history
    const aiMessages = [
      { role: "system", content: systemPrompt },
      ...messages.map((m: any) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content
      }))
    ];

    const aiRes = await fetch("https://text.pollinations.ai/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: aiMessages,
        model: "openai",
        private: true
      })
    });
    
    let aiText = "I couldn't connect to the AI brain right now. Please try again.";
    if (aiRes.ok) {
      aiText = await aiRes.text();
    }

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