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

    let currentConvId = conversationId;

    if (!currentConvId) {
      const newConversation = await prisma.conversation.create({
        data: {
          userId: session.user.id,
          title: messages[messages.length - 1].content.substring(0, 30) + "...",
        },
      });
      currentConvId = newConversation.id;
      
      await prisma.message.create({
        data: {
          conversationId: currentConvId,
          role: messages[messages.length - 1].role,
          content: messages[messages.length - 1].content,
        },
      });
    }

    // --- SIMULATED AI RESPONSE (No API Key Needed) ---
    const fakeResponseText = "Hello! This is a simulated response from CS Hub AI. Your application is working perfectly! The chat interface, database, and streaming are all functioning. You can replace this with a real OpenAI or Gemini API key later when you have access to a computer.";

    const encoder = new TextEncoder();
    const customStream = new ReadableStream({
      async start(controller) {
        const words = fakeResponseText.split(' ');
        for (const word of words) {
          const token = JSON.stringify({ choices: [{ delta: { content: word + ' ' } }] });
          controller.enqueue(encoder.encode(`data: ${token}\n\n`));
          await new Promise((resolve) => setTimeout(resolve, 80)); // 80ms delay for typing effect
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();

        // Save the simulated response to the database
        await prisma.message.create({
          data: {
            conversationId: currentConvId,
            role: "assistant",
            content: fakeResponseText,
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