import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const FlashcardSchema = z.object({
  front: z.string().min(1, "Front content is required"),
  back: z.string().min(1, "Back content is required"),
});

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const flashcards = await prisma.flashcard.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(flashcards);
  } catch (error) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const validatedFields = FlashcardSchema.safeParse(body);

    if (!validatedFields.success) {
      return NextResponse.json({ error: "Invalid fields", details: validatedFields.error.flatten() }, { status: 400 });
    }

    const { front, back } = validatedFields.data;

    const flashcard = await prisma.flashcard.create({
      data: {
        front,
        back,
        userId: session.user.id,
      },
    });

    return NextResponse.json(flashcard, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}