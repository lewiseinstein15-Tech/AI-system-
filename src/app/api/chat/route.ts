import { groq } from '@ai-sdk/groq';
import { streamText } from 'ai';
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

    // Updated model name to the active Groq model
    const result = await streamText({
      model: groq('llama-3.1-8b-instant'),
      system: "You are Computer Science Hub AI, an elite assistant for CS students. Provide accurate, well-formatted markdown responses with syntax highlighting. Focus on programming, math, algorithms, and computer science principles.",
      messages: messages,
      onFinish: async (completion) => {
        await prisma.message.create({
          data: {
            conversationId: currentConvId,
            role: "assistant",
            content: completion.text,
          },
        });
        await prisma.conversation.update({
          where: { id: currentConvId },
          data: { updatedAt: new Date() },
        });
      }
    });

    return result.toDataStreamResponse();
  } catch (error) {
    console.error("Chat API Error:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 });
  }
}