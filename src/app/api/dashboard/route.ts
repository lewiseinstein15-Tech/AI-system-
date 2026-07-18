import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Fetch all 4 tables in parallel on the backend (1 single network request for the frontend)
    const [notes, chats, assignments, flashcards] = await Promise.all([
      prisma.note.findMany({ where: { userId: session.user.id }, orderBy: { updatedAt: "desc" } }),
      prisma.conversation.findMany({ where: { userId: session.user.id } }),
      prisma.assignment.findMany({ where: { userId: session.user.id }, orderBy: { dueDate: "asc" } }),
      prisma.flashcard.findMany({ where: { userId: session.user.id } })
    ]);

    const activity = [
      ...notes.map((n: any) => ({ type: "Note", title: n.title, date: n.updatedAt })),
      ...assignments.map((a: any) => ({ type: "Assignment", title: a.title, date: a.dueDate }))
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 3);

    return NextResponse.json({
      stats: {
        notes: notes.length,
        chats: chats.length,
        assignments: assignments.length,
        flashcards: flashcards.length
      },
      recentActivity: activity
    });
  } catch (error) {
    console.error("Dashboard API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}