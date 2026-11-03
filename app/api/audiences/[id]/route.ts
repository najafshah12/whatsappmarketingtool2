import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const schema = z.object({ name: z.string().trim().min(1).max(80).optional(), description: z.string().trim().max(240).nullable().optional(), contactIds: z.array(z.string()).optional() });
    const data = schema.parse(await req.json());
    const group = await prisma.$transaction(async tx => {
      if (data.contactIds) { await tx.audienceMembership.deleteMany({ where: { groupId: id } }); if (data.contactIds.length) await tx.audienceMembership.createMany({ data: data.contactIds.map(contactId => ({ groupId: id, contactId })), skipDuplicates: true }); }
      return tx.audienceGroup.update({ where: { id }, data: { name: data.name, description: data.description }, include: { _count: { select: { members: true } } } });
    });
    return NextResponse.json(group);
  } catch (error) { if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message }, { status: 400 }); return apiError(error); }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const { id } = await params; await prisma.audienceGroup.delete({ where: { id } }); return NextResponse.json({ ok: true }); }
  catch (error) { return apiError(error); }
}
