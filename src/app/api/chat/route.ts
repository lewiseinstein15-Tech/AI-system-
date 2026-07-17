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

    // --- LIVE INTERNET FETCH (Wikipedia - No API Key Needed) ---
    // 1. Search Wikipedia for the topic
    const searchRes = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(userPrompt)}&format=json&origin=*`);
    const searchData = await searchRes.json();
    
    let fetchedText = "I searched the live internet but couldn't find a direct answer for that. Could you try rephrasing? (Example: 'Explain Binary Trees')";

    if (searchData.query && searchData.query.search.length > 0) {
      const topTitle = searchData.query.search[0].title;
      
      // 2. Get the summary of the top article
      const summaryRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topTitle)}`);
      const summaryData = await summaryRes.json();
      
      if (summaryData.extract) {
        fetchedText = `Here is what I found on the live internet regarding **${topTitle}**:\n\n${summaryData.extract}\n\n*(Source: Wikipedia Live API)*`;
      }
    }

    // 3. Stream the live data to the UI (typing effect)
    const encoder = new TextEncoder();
    const customStream = new ReadableStream({
      async start(controller) {
        const words = fetchedText.split(' ');
        for (const word of words) {
          const token = JSON.stringify({ choices: [{ delta: { content: word + ' ' } }] });
          controller.enqueue(encoder.encode(`data: ${token}\n\n`));
          await new Promise((resolve) => setTimeout(resolve, 50)); // 50ms delay for typing effect
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();

        // Save the live answer to the database
        await prisma.message.create({
          data: {
            conversationId: currentConvId,
            role: "assistant",
            content: fetchedText,
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