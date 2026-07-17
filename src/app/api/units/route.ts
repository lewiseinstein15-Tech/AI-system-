import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const UnitSchema = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string().optional(),
  subjectId: z.string().min(1, "Subject ID is required"),
});

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const units = await prisma.unit.findMany({
      include: { subject: true },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(units);
  } catch (error) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || (session.user?.role !== "ADMIN" && session.user?.role !== "LECTURER")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const validatedFields = UnitSchema.safeParse(body);

    if (!validatedFields.success) {
      return NextResponse.json({ error: "Invalid fields", details: validatedFields.error.flatten() }, { status: 400 });
    }

    const { title, content, subjectId } = validatedFields.data;

    const unit = await prisma.unit.create({
      data: { title, content: content || "", subjectId },
    });

    return NextResponse.json(unit, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}