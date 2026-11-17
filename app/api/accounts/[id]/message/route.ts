import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { phoneForWhatsAppApi, sendCloudMessage, WhatsAppApiError } from "@/lib/whatsapp";
import { bridgeSend, BridgeApiError } from "@/lib/bridge";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const schema = z.object({
  to: z.string().trim().min(6, "Enter the destination number with its country code.").max(32),
  message: z.string().trim().min(1, "Type the message you want to send.").max(4096),
});

type SendResponse = { messages?: { id?: string }[] };

/**
 * Sends one hand-written message from a specific sender.
 *
 * QR (Baileys) senders take free text at any time. Meta senders only accept free
 * text inside the 24-hour customer-service window — outside it Meta requires an
 * approved template, which is exactly what the error says.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = schema.parse(await req.json());
    const account = await prisma.whatsAppAccount.findUnique({ where: { id } });
    if (!account) return NextResponse.json({ error: "Account not found." }, { status: 404 });

    const to = phoneForWhatsAppApi(input.to);
    if (to.length < 8) return NextResponse.json({ error: "Enter the full international number, for example +923001234567." }, { status: 400 });

    if (account.provider === "bridge") {
      if (account.status !== "connected" || !account.bridgeSessionId) {
        return NextResponse.json({ error: "This number is not linked yet. Open Session QR and scan it from WhatsApp → Linked Devices." }, { status: 409 });
      }
      await bridgeSend({ sessionId: account.bridgeSessionId, number: `+${to}`, message: input.message });
      await prisma.auditLog.create({
        data: {
          action: "whatsapp.account.message_sent",
          entity: "whatsapp_account",
          entityId: account.id,
          detail: { to, provider: "bridge", sessionId: account.bridgeSessionId, length: input.message.length },
        },
      });
      return NextResponse.json({
        ok: true,
        provider: "bridge",
        message: `Sent from ${account.name} to +${to}.`,
      });
    }

    if (account.status !== "connected" || !account.phoneNumberId) {
      return NextResponse.json({ error: "This Meta sender is not connected. Reconnect it before sending." }, { status: 409 });
    }
    if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: "This sender's Meta access token expired. Update the token first." }, { status: 409 });
    }

    const result = await sendCloudMessage<SendResponse>(account, {
      to,
      type: "text",
      text: { body: input.message, preview_url: false },
    });
    const providerId = result.messages?.[0]?.id;
    await prisma.auditLog.create({
      data: {
        action: "whatsapp.account.message_sent",
        entity: "whatsapp_account",
        entityId: account.id,
        detail: { to, provider: "meta", providerId: providerId ?? null, length: input.message.length },
      },
    });
    return NextResponse.json({
      ok: true,
      provider: "meta",
      providerId: providerId ?? null,
      message: `Meta accepted the message for +${to}. Free text only works inside the 24-hour reply window; otherwise send an approved template.`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message || "Check the number and message." }, { status: 400 });
    if (error instanceof BridgeApiError) return NextResponse.json({ error: error.message, code: error.status }, { status: 400 });
    if (error instanceof WhatsAppApiError) {
      const windowClosed = error.graphCode === 131047;
      return NextResponse.json(
        {
          error: windowClosed
            ? "The 24-hour reply window is closed for this number. Meta only allows an approved template here — use Send Test or an approved campaign template instead."
            : error.message,
          code: error.graphCode ?? null,
        },
        { status: 400 }
      );
    }
    return apiError(error);
  }
}
