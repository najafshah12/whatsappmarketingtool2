import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { phoneForWhatsAppApi, sendCloudMessage, WhatsAppApiError } from "@/lib/whatsapp";

const schema = z.object({ body: z.string().trim().min(1).max(4096) });
type SendResponse = { messages?: { id?: string }[] };

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { body } = schema.parse(await req.json());
    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id },
      include: { contact: true, messages: { where: { direction: "inbound" }, orderBy: { createdAt: "desc" }, take: 1 } },
    });
    const latestInbound = conversation.messages[0];
    if (!latestInbound || Date.now() - latestInbound.createdAt.getTime() >= 24 * 60 * 60 * 1000) {
      return NextResponse.json({ error: "The 24-hour customer-service reply window has closed. Send an approved template instead." }, { status: 409 });
    }
    const accounts = await prisma.whatsAppAccount.findMany({
      where: { ...(conversation.phoneNumberId ? { phoneNumberId: conversation.phoneNumberId } : {}), status: "connected", accessTokenEncrypted: { not: null } },
      take: 2,
    });
    if (!conversation.phoneNumberId && accounts.length > 1) return NextResponse.json({ error: "This conversation has no sender ID. Receive a new webhook message before replying so the correct business number is selected." }, { status: 409 });
    const account = accounts[0];
    if (!account) return NextResponse.json({ error: "No connected sender matches this conversation. Connect the WhatsApp number that received this message." }, { status: 409 });
    if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() <= Date.now()) return NextResponse.json({ error: "This sender's Meta access token expired. Reconnect the sender." }, { status: 409 });

    const response = await sendCloudMessage<SendResponse>(account, {
      to: phoneForWhatsAppApi(conversation.contact.phone),
      type: "text",
      text: { body, preview_url: false },
    });
    const providerId = response.messages?.[0]?.id;
    if (!providerId) throw new Error("Meta accepted the reply without returning a message ID.");
    const sentAt = new Date();
    const message = await prisma.conversationMessage.create({ data: { conversationId: id, direction: "outbound", body, providerId, status: "sent", sentAt } });
    await prisma.conversation.update({ where: { id }, data: { lastMessageAt: sentAt } });
    await prisma.auditLog.create({ data: { action: "inbox.reply_sent", entity: "conversation", entityId: id, detail: { providerId } } });
    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message || "Enter a reply." }, { status: 400 });
    if (error instanceof WhatsAppApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    return apiError(error);
  }
}
