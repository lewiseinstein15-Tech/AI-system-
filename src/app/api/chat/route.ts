import { NextResponse } from "next/server";
import { OpenAIStream, StreamingTextResponse } from "ai";
import { Configuration, OpenAIApi } from "openai-edge";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const config = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(config);

export const runtime = "edge";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { messages, conversationId } = await req.json();

    if (!conversationId) {
      // Create new conversation if not provided
      const newConversation = await prisma.conversation.create({
        data: {
          userId: session.user.id,
          title: messages[messages.length - 1].content.substring(0, 30) + "...",
        },
      });
      messages.forEach(async (msg: any) => {
        await prisma.message.create({
          data: {
            conversationId: newConversation.id,
            role: msg.role,
            content: msg.content,
          },
        });
      });
    }

    const response = await openai.createChatCompletion({
      model: "gpt-4",
      stream: true,
      messages: [
        {
          role: "system",
          content:
            "You are Computer Science Hub AI, an elite assistant for CS students. Provide accurate, well-formatted markdown responses with syntax highlighting. Focus on programming, math, algorithms, and computer science principles.",
        },
        ...messages,
      ],
    });

    const stream = OpenAIStream(response, {
      onCompletion: async (completion) => {
        if (conversationId) {
          await prisma.message.create({
            data: {
              conversationId,
              role: "assistant",
              content: completion,
            },
          });
          await prisma.conversation.update({
            where: { id: conversationId },
            data: { updatedAt: new Date() },
          });
        }
      },
    });

    return new StreamingTextResponse(stream);
  } catch (error) {
    console.error("Chat API Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}