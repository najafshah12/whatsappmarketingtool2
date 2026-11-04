import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  accountAccessToken,
  inspectToken,
  verifyWhatsAppPhoneNumber,
  WhatsAppApiError,
} from "@/lib/whatsapp";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * Live health check for a connected sender. Calls Meta with the stored token so
 * the operator can see whether the number still works and when the token ends.
 */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const account = await prisma.whatsAppAccount.findUnique({ where: { id } });
    if (!account) return NextResponse.json({ error: "Account not found." }, { status: 404 });
    if (account.status !== "connected" && account.status !== "expired") {
      return NextResponse.json({ error: "Connect this sender with Meta before checking it." }, { status: 409 });
    }
    if (!account.phoneNumberId) {
      return NextResponse.json({ error: "This sender has no WhatsApp Phone Number ID. Reconnect it to continue." }, { status: 409 });
    }

    const token = accountAccessToken(account);
    const inspected = await inspectToken(token).catch(() => null);

    let info: { id: string; display_phone_number?: string; verified_name?: string; quality_rating?: string };
    try {
      info = await verifyWhatsAppPhoneNumber(token, account.phoneNumberId);
    } catch (error) {
      if (error instanceof WhatsAppApiError && error.graphCode === 190) {
        await prisma.whatsAppAccount.update({
          where: { id },
          data: {
            status: "expired",
            tokenExpiresAt: inspected?.expiresAt ?? account.tokenExpiresAt ?? new Date(),
          },
        });
        return NextResponse.json(
          {
            ok: false,
            error: `${error.message} The access token is invalid or expired — paste a fresh token with Update Token.`,
            code: error.graphCode,
            expired: true,
          },
          { status: 400 }
        );
      }
      throw error;
    }

    const expiresAt = inspected?.expiresAt ?? account.tokenExpiresAt ?? null;
    const isPermanent = inspected?.isPermanent ?? !account.tokenExpiresAt;
    await prisma.whatsAppAccount.update({
      where: { id },
      data: {
        name: info.verified_name || account.name,
        phone: info.display_phone_number || account.phone,
        tokenExpiresAt: expiresAt,
        status: "connected",
      },
    });

    return NextResponse.json({
      ok: true,
      phone: info.display_phone_number,
      verifiedName: info.verified_name,
      qualityRating: info.quality_rating,
      isPermanent,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      daysRemaining: expiresAt ? Math.ceil((expiresAt.getTime() - Date.now()) / 86400000) : null,
      scopes: inspected?.scopes ?? null,
    });
  } catch (error) {
    if (error instanceof WhatsAppApiError) {
      const hint =
        error.graphCode === 190
          ? "The access token is invalid or expired — update the token for this sender."
          : error.status === 403
            ? "The token no longer has permission for this WhatsApp number."
            : "";
      return NextResponse.json(
        { ok: false, error: `${error.message}${hint ? ` ${hint}` : ""}`, code: error.graphCode ?? null },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not check this sender." },
      { status: 500 }
    );
  }
}
