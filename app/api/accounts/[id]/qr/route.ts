import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bridgeAccountStatus, bridgePhone, bridgeQr, bridgeStartSession, BridgeApiError } from "@/lib/bridge";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * Returns the live QR code for a bridge (Baileys) sender.
 *
 * The bridge API key never reaches the browser: this route calls the bridge
 * server-side and only forwards the data URL plus the current status.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const account = await prisma.whatsAppAccount.findUnique({ where: { id } });
    if (!account) return NextResponse.json({ error: "Account not found." }, { status: 404 });
    if (account.provider !== "bridge" || !account.bridgeSessionId) {
      return NextResponse.json({ error: "This sender is not a QR (Baileys) sender." }, { status: 400 });
    }

    let state = await bridgeQr(account.bridgeSessionId);
    // A brand new session, or one that dropped / was logged out on the phone,
    // needs the bridge to (re)open a socket before it can emit a QR.
    if (state.status === "not_started" || state.status === "disconnected") {
      await bridgeStartSession(account.bridgeSessionId);
      // The bridge needs a moment to open the socket and emit the first QR.
      await new Promise(resolve => setTimeout(resolve, 2500));
      state = await bridgeQr(account.bridgeSessionId);
    }

    const status = bridgeAccountStatus(state.status);
    const phone = bridgePhone(state.phone ?? null);
    if (status === "connected" || phone) {
      const phoneTaken = phone && phone !== account.phone
        ? await prisma.whatsAppAccount.findFirst({ where: { phone, NOT: { id } }, select: { id: true } })
        : null;
      if (status !== account.status || (phone && !phoneTaken && phone !== account.phone)) {
        await prisma.whatsAppAccount.update({
          where: { id },
          data: {
            status,
            ...(phone && !phoneTaken ? { phone } : {}),
            ...(status === "connected" ? { connectedAt: account.connectedAt || new Date() } : {}),
          },
        });
      }
    }

    return NextResponse.json({
      sessionId: account.bridgeSessionId,
      bridgeStatus: state.status,
      status,
      phone,
      qr: state.qr ?? null,
    });
  } catch (error) {
    if (error instanceof BridgeApiError) {
      return NextResponse.json({ error: error.message, code: error.status }, { status: error.status === 503 ? 503 : 502 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load the QR code." }, { status: 500 });
  }
}
