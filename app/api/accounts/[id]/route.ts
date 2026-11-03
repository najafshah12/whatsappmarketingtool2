import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { status } = await req.json();
    if (!['disconnected', 'attention'].includes(status)) return NextResponse.json({ error: "Connected status can only be set by completing Meta signup." }, { status: 400 });
    return NextResponse.json(await prisma.whatsAppAccount.update({ where: { id }, data: { status }, select: { id: true, name: true, phone: true, status: true } }));
  }
  catch (error) { return apiError(error); }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const assigned = await prisma.campaignAccount.count({ where: { accountId: id } });
    if (assigned > 0) {
      return NextResponse.json(
        { error: `This sender is assigned to ${assigned} campaign${assigned === 1 ? "" : "s"}. Remove it from those campaigns before deleting.` },
        { status: 409 }
      );
    }
    await prisma.whatsAppAccount.delete({ where: { id } });
    await prisma.auditLog.create({ data: { action: "whatsapp.account.deleted", entity: "whatsapp_account", entityId: id } });
    return NextResponse.json({ ok: true });
  }
  catch (error) { return apiError(error); }
}
