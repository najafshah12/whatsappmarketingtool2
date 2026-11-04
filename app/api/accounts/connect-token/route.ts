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
  phoneNumberId: z.string().trim().optional(),
  businessAccountId: z.string().trim().regex(/^\d{5,35}$/, "Invalid WhatsApp Business Account ID (WABA ID) format."),
  accessToken: z.string().trim().min(20, "WhatsApp Access Token is required."),
});

type WabaPhoneNumber = {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  code_verification_status?: string;
};

function digits(value: string | undefined | null) {
  return (value || "").replace(/\D/g, "");
}

function metaHint(error: WhatsAppApiError) {
  if (error.graphCode === 190) return "The access token is invalid or expired — generate a new token.";
  if (error.graphCode === 100) return "The Phone Number ID or WABA ID is wrong, or the number is not registered on this WABA.";
  if (error.status === 403) return "The token is missing the whatsapp_business_messaging permission, or it does not own this WhatsApp Business Account.";
  return "";
}

async function listWabaNumbers(accessToken: string, wabaId: string) {
  return graphRequest<{ data?: WabaPhoneNumber[] }>(
    accessToken,
    `${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name,code_verification_status&limit=100`
  );
}

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

    // 2. Resolve the phone number ID. A valid ID can be supplied directly;
    // otherwise it is discovered from the WABA so the operator can just type
    // the phone number instead of hunting for a 16-digit ID.
    let phoneNumberId = digits(input.phoneNumberId);
    if (!/^\d{5,35}$/.test(phoneNumberId)) {
      let numbers: WabaPhoneNumber[] = [];
      try {
        const listed = await listWabaNumbers(activeToken, input.businessAccountId);
        numbers = listed.data ?? [];
      } catch (error) {
        if (error instanceof WhatsAppApiError) {
          const hint = metaHint(error);
          return NextResponse.json(
            {
              error: `Could not read the phone numbers of WABA ${input.businessAccountId}: ${error.message} (HTTP ${error.status}).${hint ? ` ${hint}` : ""}`,
            },
            { status: 400 }
          );
        }
        throw error;
      }

      if (numbers.length === 0) {
        return NextResponse.json(
          {
            error:
              "This WhatsApp Business Account has no phone numbers yet. Add and verify the number in Meta WhatsApp Manager → Phone numbers, then try again.",
          },
          { status: 400 }
        );
      }

      const wanted = digits(input.phone);
      const match =
        (wanted
          ? numbers.find((number) => {
              const actual = digits(number.display_phone_number);
              return actual.length > 0 && (actual === wanted || actual.endsWith(wanted) || wanted.endsWith(actual));
            })
          : undefined) ?? (numbers.length === 1 ? numbers[0] : undefined);

      if (!match) {
        const available = numbers
          .map((number) => `${number.display_phone_number || "unknown"} (ID ${number.id})`)
          .join(", ");
        return NextResponse.json(
          {
            error: `That phone number was not found in WABA ${input.businessAccountId}. Numbers on this account: ${available}. Enter one of them, or paste its Phone Number ID.`,
          },
          { status: 400 }
        );
      }
      phoneNumberId = match.id;
    }

    // 3. Verify token against Meta WhatsApp Phone Number ID
    let phoneInfo: { id: string; display_phone_number?: string; verified_name?: string } | null = null;
    try {
      phoneInfo = await verifyWhatsAppPhoneNumber(activeToken, phoneNumberId);
    } catch (error) {
      if (error instanceof WhatsAppApiError) {
        const hint = metaHint(error);
        return NextResponse.json(
          {
            error: `Meta validation failed: ${error.message} (HTTP ${error.status}).${hint ? ` ${hint}` : ""}`,
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

    // 4. Auto-subscribe to Meta Webhook events
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

    // 5. Save/update account in database
    const account = await prisma.whatsAppAccount.upsert({
      where: { phone: displayPhone },
      create: {
        name: verifiedName,
        phone: displayPhone,
        phoneNumberId,
        businessAccountId: input.businessAccountId,
        accessTokenEncrypted: encryptAccessToken(activeToken),
        tokenExpiresAt: expiresAt,
        connectedAt: new Date(),
        webhookSubscribedAt: webhookSubscribed ? new Date() : null,
        status: "connected",
      },
      update: {
        name: verifiedName,
        phone: displayPhone,
        phoneNumberId,
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
          : `Account connected as ${account.phone} with a 60-day token (valid until ${expiresAt?.toLocaleDateString()}).`,
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
