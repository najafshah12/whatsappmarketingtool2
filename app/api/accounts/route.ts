import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";

const schema = z.object({ name: z.string().trim().min(1).max(80), phone: z.string().trim().min(5).max(32), phoneNumberId: z.string().trim().optional(), businessAccountId: z.string().trim().optional() });

export async function GET() {
  try {
    return NextResponse.json(await prisma.whatsAppAccount.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true, name: true, phone: true, status: true, phoneNumberId: true,
        businessAccountId: true, metaBusinessId: true, tokenExpiresAt: true,
        connectedAt: true, webhookSubscribedAt: true,
        _count: { select: { campaignAssignments: true } },
      },
    }));
  }
  catch (error) { return apiError(error); }
}

export async function POST(req: Request) {
  try {
    const data = schema.parse(await req.json());
    const account = await prisma.whatsAppAccount.create({
      data: { ...data, phoneNumberId: data.phoneNumberId || null, businessAccountId: data.businessAccountId || null, status: "disconnected" },
      select: { id: true, name: true, phone: true, status: true, phoneNumberId: true, businessAccountId: true },
    });
    await prisma.auditLog.create({ data: { action: "whatsapp.account.created", entity: "whatsapp_account", entityId: account.id } });
    return NextResponse.json(account, { status: 201 });
  }
  catch (error) { if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message }, { status: 400 }); return apiError(error); }
}
