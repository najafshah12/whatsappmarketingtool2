import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";

const schema = z.object({ name: z.string().trim().min(1).max(80), description: z.string().trim().max(240).optional(), contactIds: z.array(z.string()).default([]) });

export async function GET() {
  try {
    const groups = await prisma.audienceGroup.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { members: true } }, members: { select: { contactId: true } } } });
    const [contacts, optedOut, eligible] = await Promise.all([
      prisma.contact.count(),
      prisma.contact.count({ where: { optedOut: true } }),
      prisma.contact.count({ where: { optedOut: false, marketingOptIn: true } }),
    ]);
    return NextResponse.json({ groups, contacts, optedOut, eligible });
  } catch (error) { return apiError(error); }
}

export async function POST(req: Request) {
  try {
    const data = schema.parse(await req.json());
    const group = await prisma.audienceGroup.create({ data: { name: data.name, description: data.description || null, members: { create: data.contactIds.map(contactId => ({ contact: { connect: { id: contactId } } })) } }, include: { _count: { select: { members: true } } } });
    return NextResponse.json(group, { status: 201 });
  } catch (error) { if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message }, { status: 400 }); return apiError(error); }
}
