import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { phoneForWhatsAppApi, sendCloudMessage, WhatsAppApiError } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

const schema = z.object({
  to: z.string().trim().min(6, "Enter the destination number with country code.").max(32),
  templateName: z.string().trim().max(512).optional(),
  language: z.string().trim().max(16).optional(),
});

type SendResponse = { messages?: { id?: string }[] };

/** Meta error codes that most often stop a first test message. */
function metaHint(code: number | undefined) {
  if (code === 190) return "The stored access token is invalid or expired — update the token for this sender.";
  if (code === 131030) return "This number is not on the Meta test recipient list. Add it under App Dashboard → WhatsApp → API Setup, or use a verified production number.";
  if (code === 132000) return "The template name/language pair does not exist on this WhatsApp Business Account.";
  if (code === 132001) return "That template exists, but not in this language. Check the language code (for example en_US).";
  if (code === 131026) return "Meta accepted the request but could not deliver it — usually the number is not on WhatsApp or has blocked the business. Try another number.";
  if (code === 131047) return "The 24-hour customer-service window is closed. A business-initiated message must use an approved template.";
  if (code === 133010) return "The phone number is not registered on the Cloud API yet. Finish phone registration in Meta WhatsApp Manager.";
  if (code === 100) return "Meta rejected the request parameters. Check the recipient number format and template variables.";
  return "";
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = schema.parse(await req.json());
    const account = await prisma.whatsAppAccount.findUnique({ where: { id } });
    if (!account) return NextResponse.json({ error: "Account not found." }, { status: 404 });
    if (account.status !== "connected" || !account.phoneNumberId) {
      return NextResponse.json({ error: "Connect this sender with Meta before sending a test message." }, { status: 409 });
    }

    // Pick the template: explicit choice → approved template of this sender →
    // Meta's built-in hello_world (present on every new WABA).
    const approved = await prisma.template.findFirst({
      where: { accountId: account.id, status: "approved" },
      orderBy: { lastSyncedAt: "desc" },
    });
    const templateName = input.templateName || approved?.name || "hello_world";
    const language = input.language || approved?.language || "en_US";
    const body = approved?.body || "";
    const variableCount = Math.max(0, ...[...body.matchAll(/\{\{(\d+)\}\}/g)].map(match => Number(match[1])));
    const components = variableCount
      ? [{ type: "body", parameters: Array.from({ length: variableCount }, () => ({ type: "text", text: "Test" })) }]
      : undefined;

    const to = phoneForWhatsAppApi(input.to);
    if (to.length < 8) return NextResponse.json({ error: "Enter the full international number, for example +923001234567." }, { status: 400 });

    const result = await sendCloudMessage<SendResponse>(account, {
      to,
      type: "template",
      template: { name: templateName, language: { code: language }, ...(components ? { components } : {}) },
    });

    const providerId = result.messages?.[0]?.id;
    if (!providerId) return NextResponse.json({ error: "Meta accepted the request without returning a message ID." }, { status: 502 });

    await prisma.auditLog.create({
      data: {
        action: "whatsapp.account.test_message",
        entity: "whatsapp_account",
        entityId: account.id,
        detail: { to, templateName, language, providerId },
      },
    });

    return NextResponse.json({
      ok: true,
      providerId,
      templateName,
      language,
      message: `Test template "${templateName}" (${language}) accepted by Meta for +${to}. The phone should receive it within a minute; delivery status arrives through the webhook.`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Invalid test message." }, { status: 400 });
    }
    if (error instanceof WhatsAppApiError) {
      const hint = metaHint(error.graphCode);
      return NextResponse.json(
        { error: `${error.message}${hint ? ` ${hint}` : ""}`, code: error.graphCode ?? null },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not send the test message." },
      { status: 500 }
    );
  }
}
