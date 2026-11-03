import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const { id } = await params; return NextResponse.json(await prisma.conversation.findUniqueOrThrow({ where: { id }, include: { contact: true, messages: { orderBy: { createdAt: "asc" } } } })); }
  catch (error) { return apiError(error); }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const { id } = await params; const { status } = await req.json(); if (!['open', 'closed'].includes(status)) return NextResponse.json({ error: "Invalid conversation status." }, { status: 400 }); return NextResponse.json(await prisma.conversation.update({ where: { id }, data: { status, unreadCount: 0 }, include: { contact: true } })); }
  catch (error) { return apiError(error); }
}
