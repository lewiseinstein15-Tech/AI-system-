import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const PdfSchema = z.object({
  title: z.string().min(1, "Title is required"),
  fileUrl: z.string().url("Invalid URL"),
  subjectId: z.string().min(1, "Subject ID is required"),
});

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const pdfs = await prisma.pDF.findMany({
      include: { subject: true },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(pdfs);
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
    const validatedFields = PdfSchema.safeParse(body);

    if (!validatedFields.success) {
      return NextResponse.json({ error: "Invalid fields", details: validatedFields.error.flatten() }, { status: 400 });
    }

    const { title, fileUrl, subjectId } = validatedFields.data;

    const pdf = await prisma.pDF.create({
      data: { title, fileUrl, subjectId },
    });

    return NextResponse.json(pdf, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}