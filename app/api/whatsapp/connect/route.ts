import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { encryptAccessToken, exchangeForLongLivedToken, getMetaAppConfig, graphRequest, inspectToken, WhatsAppApiError } from "@/lib/whatsapp";

const schema = z.object({
  code: z.string().trim().min(10).max(4096),
  wabaId: z.string().trim().regex(/^\d{5,30}$/),
  phoneNumberId: z.string().trim().regex(/^\d{5,30}$/),
  businessId: z.string().trim().regex(/^\d{5,30}$/).optional(),
  displayPhoneNumber: z.string().trim().max(40).optional(),
  verifiedName: z.string().trim().max(120).optional(),
});

type ExchangeResponse = { access_token?: string; token_type?: string; expires_in?: number };
type PhoneDetails = { id: string; display_phone_number?: string; verified_name?: string };
type PhoneList = { data?: PhoneDetails[] };

export async function POST(req: Request) {
  try {
    const input = schema.parse(await req.json());
    const { appId, appSecret } = getMetaAppConfig();
    if (!appId || !appSecret) return NextResponse.json({ error: "Meta App ID and App Secret are not configured on the server." }, { status: 503 });

    const tokenUrl = new URL(`https://graph.facebook.com/${getMetaAppConfig().graphVersion}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", appId);
    tokenUrl.searchParams.set("client_secret", appSecret);
    tokenUrl.searchParams.set("code", input.code);
    const exchangeResponse = await fetch(tokenUrl, { cache: "no-store" });
    const exchange = await exchangeResponse.json() as ExchangeResponse & { error?: { message?: string } };
    if (!exchangeResponse.ok || !exchange.access_token) {
      return NextResponse.json({ error: exchange.error?.message || "Meta could not exchange the signup code. Restart the signup flow and try again." }, { status: 400 });
    }

    let activeToken = exchange.access_token;
    let expiresAt: Date | null = exchange.expires_in ? new Date(Date.now() + exchange.expires_in * 1000) : null;

    // Automatically exchange for a 60-day long-lived token
    try {
      const longLived = await exchangeForLongLivedToken(activeToken);
      if (longLived.isLongLived) {
        activeToken = longLived.accessToken;
        expiresAt = longLived.expiresIn ? new Date(Date.now() + longLived.expiresIn * 1000) : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
      } else {
        const inspected = await inspectToken(activeToken);
        if (inspected.isPermanent) {
          expiresAt = null;
        } else if (inspected.expiresAt) {
          expiresAt = inspected.expiresAt;
        }
      }
    } catch (e) {
      console.warn("Could not upgrade token to 60-day token:", e);
    }

    const phone = await graphRequest<PhoneDetails>(activeToken, `${input.phoneNumberId}?fields=id,display_phone_number,verified_name`);
    const phoneList = await graphRequest<PhoneList>(activeToken, `${input.wabaId}/phone_numbers?fields=id,display_phone_number,verified_name&limit=100`);
    const verified = phoneList.data?.find(item => item.id === input.phoneNumberId);
    if (!verified) return NextResponse.json({ error: "Meta did not confirm that this phone number belongs to the selected WhatsApp Business Account." }, { status: 403 });

    let webhookSubscribed = false;
    try {
      await graphRequest(activeToken, `${input.wabaId}/subscribed_apps`, { method: "POST", body: JSON.stringify({}) });
      webhookSubscribed = true;
    } catch (error) {
      console.warn("WhatsApp account connected; Meta webhook subscription needs attention:", error instanceof Error ? error.message : "unknown error");
    }

    const displayPhoneNumber = verified.display_phone_number || phone.display_phone_number || input.displayPhoneNumber;
    if (!displayPhoneNumber) return NextResponse.json({ error: "Meta did not return the registered phone number." }, { status: 422 });
    const account = await prisma.whatsAppAccount.upsert({
      where: { phone: displayPhoneNumber },
      create: {
        name: verified.verified_name || phone.verified_name || input.verifiedName || displayPhoneNumber,
        phone: displayPhoneNumber,
        phoneNumberId: input.phoneNumberId,
        businessAccountId: input.wabaId,
        metaBusinessId: input.businessId || null,
        accessTokenEncrypted: encryptAccessToken(activeToken),
        tokenExpiresAt: expiresAt,
        connectedAt: new Date(),
        webhookSubscribedAt: webhookSubscribed ? new Date() : null,
        status: "connected",
      },
      update: {
        name: verified.verified_name || phone.verified_name || input.verifiedName || displayPhoneNumber,
        phoneNumberId: input.phoneNumberId,
        businessAccountId: input.wabaId,
        metaBusinessId: input.businessId || null,
        accessTokenEncrypted: encryptAccessToken(activeToken),
        tokenExpiresAt: expiresAt,
        connectedAt: new Date(),
        webhookSubscribedAt: webhookSubscribed ? new Date() : null,
        status: "connected",
      },
      select: { id: true, name: true, phone: true, status: true, phoneNumberId: true, businessAccountId: true, tokenExpiresAt: true, webhookSubscribedAt: true },
    });
    await prisma.auditLog.create({ data: { action: "whatsapp.account.connected", entity: "whatsapp_account", entityId: account.id } });
    return NextResponse.json({ account, webhookSubscribed });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message || "Invalid Meta signup response." }, { status: 400 });
    const status = error instanceof WhatsAppApiError ? error.status : 503;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not connect the WhatsApp account." }, { status });
  }
}

