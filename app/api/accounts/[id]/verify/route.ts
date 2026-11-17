import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  accountAccessToken,
  inspectToken,
  verifyWhatsAppPhoneNumber,
  WhatsAppApiError,
} from "@/lib/whatsapp";
import { bridgeAccountStatus, bridgePhone, bridgeSession, BridgeApiError } from "@/lib/bridge";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * Live health check for a connected sender.
 * Meta senders ask Graph API about the stored token; QR (Baileys) senders ask
 * the bridge whether that session is still connected.
 */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const account = await prisma.whatsAppAccount.findUnique({ where: { id } });
    if (!account) return NextResponse.json({ error: "Account not found." }, { status: 404 });

    if (account.provider === "bridge") {
      if (!account.bridgeSessionId) {
        return NextResponse.json({ error: "This QR sender has no session name. Remove it and add it again." }, { status: 409 });
      }
      const session = await bridgeSession(account.bridgeSessionId);
      const status = bridgeAccountStatus(session?.status || "not_started");
      const phone = bridgePhone(session?.phone);
      const phoneTaken = phone && phone !== account.phone
        ? await prisma.whatsAppAccount.findFirst({ where: { phone, NOT: { id } }, select: { id: true } })
        : null;

      const updated = await prisma.whatsAppAccount.update({
        where: { id },
        data: {
          status,
          ...(phone && !phoneTaken ? { phone } : {}),
          ...(status === "connected" ? { connectedAt: account.connectedAt || new Date() } : { connectedAt: null }),
        },
        select: { id: true, name: true, phone: true, status: true },
      });

      if (status === "connected") {
        return NextResponse.json({
          ok: true,
          provider: "bridge",
          phone: updated.phone,
          verifiedName: updated.name,
          qualityRating: null,
          isPermanent: true,
          expiresAt: null,
          daysRemaining: null,
          message: `QR sender "${updated.name}" is connected as ${updated.phone}.`,
        });
      }

      const messages: Record<string, string> = {
        qr_ready: "This sender is waiting for a QR scan. Open Show QR and scan it from WhatsApp → Linked Devices.",
        connecting: "The bridge is still connecting. Try again in a few seconds.",
        not_started: "This session is not open on the bridge yet. Open Show QR to start it.",
        disconnected: "The bridge lost this session. Open Show QR and scan again.",
      };
      return NextResponse.json(
        {
          ok: false,
          provider: "bridge",
          error: messages[session?.status || "not_started"] || "This QR sender is not connected.",
          bridgeStatus: session?.status || "not_started",
        },
        { status: 409 }
      );
    }

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
      provider: "meta",
      phone: info.display_phone_number,
      verifiedName: info.verified_name,
      qualityRating: info.quality_rating,
      isPermanent,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      daysRemaining: expiresAt ? Math.ceil((expiresAt.getTime() - Date.now()) / 86400000) : null,
      scopes: inspected?.scopes ?? null,
    });
  } catch (error) {
    if (error instanceof BridgeApiError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
    }
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
