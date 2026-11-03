import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";

export async function GET() {
  try { return NextResponse.json(await prisma.conversation.findMany({ orderBy: { lastMessageAt: "desc" }, include: { contact: { select: { id: true, name: true, phone: true } }, messages: { orderBy: { createdAt: "desc" }, take: 1 } } })); }
  catch (error) { return apiError(error); }
}
