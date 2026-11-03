import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  encryptAccessToken,
  exchangeForLongLivedToken,
  graphRequest,
  inspectToken,
  verifyWhatsAppPhoneNumber,
  WhatsAppApiError,
} from "@/lib/whatsapp";

const schema = z.object({
  name: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(40).optional(),
  phoneNumberId: z.string().trim().regex(/^\d{5,35}$/, "Invalid WhatsApp Phone Number ID format."),
  businessAccountId: z.string().trim().regex(/^\d{5,35}$/, "Invalid WhatsApp Business Account ID (WABA ID) format."),
  accessToken: z.string().trim().min(20, "WhatsApp Access Token is required."),
});

export async function POST(req: Request) {
  try {
    const input = schema.parse(await req.json());

    // 1. Automatically try to exchange short-lived token for 60-day Long-Lived Token
    let activeToken = input.accessToken;
    let expiresAt: Date | null = null;
    let tokenType = "standard";

    try {
      const longLived = await exchangeForLongLivedToken(input.accessToken);
      if (longLived.isLongLived) {
        activeToken = longLived.accessToken;
        expiresAt = longLived.expiresIn
          ? new Date(Date.now() + longLived.expiresIn * 1000)
          : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
        tokenType = "long_lived_60d";
      } else {
        const inspected = await inspectToken(input.accessToken);
        if (inspected.isPermanent) {
          expiresAt = null;
          tokenType = "permanent_system_user";
        } else if (inspected.expiresAt) {
          expiresAt = inspected.expiresAt;
          tokenType = "custom_expiry";
        } else {
          // Default 60-day expectation if long-lived exchange not available
          expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
          tokenType = "long_lived_60d";
        }
      }
    } catch (err) {
      console.warn("Token exchange or inspection notice:", err);
      expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    }

    // 2. Verify token against Meta WhatsApp Phone Number ID
    let phoneInfo: { id: string; display_phone_number?: string; verified_name?: string } | null = null;
    try {
      phoneInfo = await verifyWhatsAppPhoneNumber(activeToken, input.phoneNumberId);
    } catch (error) {
      if (error instanceof WhatsAppApiError) {
        return NextResponse.json(
          {
            error: `Meta validation failed: ${error.message} (HTTP ${error.status}). Ensure the token has 'whatsapp_business_messaging' permissions and belongs to this Phone Number ID.`,
          },
          { status: 400 }
        );
      }
      throw error;
    }

    const displayPhone = phoneInfo?.display_phone_number || input.phone;
    if (!displayPhone) {
      return NextResponse.json(
        { error: "Meta did not return a display phone number. Please enter a valid phone number." },
        { status: 422 }
      );
    }

    const verifiedName = phoneInfo?.verified_name || input.name || displayPhone;

    // 3. Auto-subscribe to Meta Webhook events
    let webhookSubscribed = false;
    try {
      await graphRequest(activeToken, `${input.businessAccountId}/subscribed_apps`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      webhookSubscribed = true;
    } catch (error) {
      console.warn(
        "WhatsApp account connected, but webhook auto-subscription returned notice:",
        error instanceof Error ? error.message : "unknown"
      );
    }

    // 4. Save/update account in database
    const account = await prisma.whatsAppAccount.upsert({
      where: { phone: displayPhone },
      create: {
        name: verifiedName,
        phone: displayPhone,
        phoneNumberId: input.phoneNumberId,
        businessAccountId: input.businessAccountId,
        accessTokenEncrypted: encryptAccessToken(activeToken),
        tokenExpiresAt: expiresAt,
        connectedAt: new Date(),
        webhookSubscribedAt: webhookSubscribed ? new Date() : null,
        status: "connected",
      },
      update: {
        name: verifiedName,
        phoneNumberId: input.phoneNumberId,
        businessAccountId: input.businessAccountId,
        accessTokenEncrypted: encryptAccessToken(activeToken),
        tokenExpiresAt: expiresAt,
        connectedAt: new Date(),
        webhookSubscribedAt: webhookSubscribed ? new Date() : null,
        status: "connected",
      },
      select: {
        id: true,
        name: true,
        phone: true,
        status: true,
        phoneNumberId: true,
        businessAccountId: true,
        tokenExpiresAt: true,
        webhookSubscribedAt: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: "whatsapp.account.token_connected",
        entity: "whatsapp_account",
        entityId: account.id,
        detail: { tokenType, expiresAt: expiresAt?.toISOString() },
      },
    });

    return NextResponse.json({
      account,
      webhookSubscribed,
      tokenType,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      message:
        tokenType === "permanent_system_user"
          ? "Account connected with a permanent System User Token."
          : `Account connected successfully with 60-day token (valid until ${expiresAt?.toLocaleDateString()}).`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Invalid input data." }, { status: 400 });
    }
    const status = error instanceof WhatsAppApiError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not connect WhatsApp account." },
      { status }
    );
  }
}
