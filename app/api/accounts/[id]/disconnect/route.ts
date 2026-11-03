import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const account = await prisma.whatsAppAccount.update({
      where: { id },
      data: { status: "disconnected", accessTokenEncrypted: null, tokenExpiresAt: null, connectedAt: null, webhookSubscribedAt: null },
      select: { id: true, name: true, phone: true, status: true },
    });
    await prisma.auditLog.create({ data: { action: "whatsapp.account.disconnected", entity: "whatsapp_account", entityId: account.id } });
    return NextResponse.json(account);
  } catch (error) { return apiError(error); }
}
