import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { bridgeConfig } from "@/lib/bridge";

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(5).max(32),
  provider: z.enum(["meta", "bridge"]).default("meta"),
  bridgeSessionId: z.string().trim().regex(/^[a-zA-Z0-9_-]{2,40}$/, "Session name can use letters, numbers, - and _ only.").optional(),
  phoneNumberId: z.string().trim().optional(),
  businessAccountId: z.string().trim().optional(),
});

export async function GET() {
  try {
    return NextResponse.json(await prisma.whatsAppAccount.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true, name: true, phone: true, status: true, provider: true, bridgeSessionId: true,
        phoneNumberId: true, businessAccountId: true, metaBusinessId: true, tokenExpiresAt: true,
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
    if (data.provider === "bridge") {
      if (!data.bridgeSessionId) {
        return NextResponse.json({ error: "A QR sender needs a session name, for example account1." }, { status: 400 });
      }
      if (!bridgeConfig().configured) {
        return NextResponse.json({ error: "Set WA_BRIDGE_URL and WA_BRIDGE_API_KEY on the server before adding QR senders." }, { status: 503 });
      }
    }
    const account = await prisma.whatsAppAccount.create({
      data: {
        name: data.name,
        phone: data.phone,
        provider: data.provider,
        bridgeSessionId: data.provider === "bridge" ? data.bridgeSessionId ?? null : null,
        phoneNumberId: data.provider === "meta" ? data.phoneNumberId || null : null,
        businessAccountId: data.provider === "meta" ? data.businessAccountId || null : null,
        status: "disconnected",
      },
      select: { id: true, name: true, phone: true, status: true, provider: true, bridgeSessionId: true, phoneNumberId: true, businessAccountId: true },
    });
    await prisma.auditLog.create({ data: { action: "whatsapp.account.created", entity: "whatsapp_account", entityId: account.id, detail: { provider: account.provider } } });
    return NextResponse.json(account, { status: 201 });
  }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = String((error.meta as { target?: unknown } | undefined)?.target ?? "");
      if (target.includes("bridgeSessionId")) {
        return NextResponse.json({ error: "That bridge session name is already used by another sender. Use the suggested name (account1, account2, …)." }, { status: 409 });
      }
      if (target.includes("phone")) {
        return NextResponse.json({ error: "This WhatsApp number is already added. Open that sender and scan its QR instead of adding it twice." }, { status: 409 });
      }
    }
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message }, { status: 400 });
    return apiError(error);
  }
}
