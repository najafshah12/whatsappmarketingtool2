import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  encryptAccessToken,
  exchangeForLongLivedToken,
  inspectToken,
  verifyWhatsAppPhoneNumber,
  WhatsAppApiError,
} from "@/lib/whatsapp";

const schema = z.object({
  accessToken: z.string().trim().min(20, "WhatsApp Access Token is required."),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { accessToken } = schema.parse(await req.json());

    const account = await prisma.whatsAppAccount.findUniqueOrThrow({ where: { id } });
    if (!account.phoneNumberId) {
      return NextResponse.json(
        { error: "This sender does not have a registered WhatsApp Phone Number ID." },
        { status: 400 }
      );
    }

    // Automatically exchange for 60-day long-lived token
    let activeToken = accessToken;
    let expiresAt: Date | null = null;
    let tokenType = "standard";

    try {
      const longLived = await exchangeForLongLivedToken(accessToken);
      if (longLived.isLongLived) {
        activeToken = longLived.accessToken;
        expiresAt = longLived.expiresIn
          ? new Date(Date.now() + longLived.expiresIn * 1000)
          : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
        tokenType = "long_lived_60d";
      } else {
        const inspected = await inspectToken(accessToken);
        if (inspected.isPermanent) {
          expiresAt = null;
          tokenType = "permanent_system_user";
        } else if (inspected.expiresAt) {
          expiresAt = inspected.expiresAt;
          tokenType = "custom_expiry";
        } else {
          expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
          tokenType = "long_lived_60d";
        }
      }
    } catch {
      expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    }

    // Verify token with Meta
    try {
      await verifyWhatsAppPhoneNumber(activeToken, account.phoneNumberId);
    } catch (error) {
      if (error instanceof WhatsAppApiError) {
        return NextResponse.json(
          { error: `Meta token test failed: ${error.message} (HTTP ${error.status}).` },
          { status: 400 }
        );
      }
      throw error;
    }

    const updated = await prisma.whatsAppAccount.update({
      where: { id },
      data: {
        accessTokenEncrypted: encryptAccessToken(activeToken),
        tokenExpiresAt: expiresAt,
        status: "connected",
        connectedAt: new Date(),
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
        action: "whatsapp.account.token_refreshed",
        entity: "whatsapp_account",
        entityId: id,
        detail: { tokenType, expiresAt: expiresAt?.toISOString() },
      },
    });

    return NextResponse.json({
      account: updated,
      tokenType,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      message: "Access token updated successfully.",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Invalid token." }, { status: 400 });
    }
    const status = error instanceof WhatsAppApiError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update token." },
      { status }
    );
  }
}
