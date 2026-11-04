import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getMetaAppConfig, isUsableMetaAppId, isUsableMetaAppSecret } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * Lightweight deployment health probe.
 * Returns no secrets and is safe to expose publicly.
 */
export async function GET() {
  const startedAt = Date.now();
  const checks: Record<string, string> = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "connected";
  } catch {
    checks.database = "unavailable";
  }

  const meta = getMetaAppConfig();
  checks.meta = isUsableMetaAppId(meta.appId) && isUsableMetaAppSecret(meta.appSecret) ? "configured" : "invalid";
  checks.scheduledSender = (process.env.CRON_SECRET?.trim().length || 0) >= 32 ? "configured" : "missing";
  checks.tokenEncryption = (process.env.WA_TOKEN_ENCRYPTION_KEY || process.env.AUTH_SESSION_SECRET || "").length >= 32 ? "configured" : "missing";

  const healthy = checks.database === "connected";
  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks,
      responseTimeMs: Date.now() - startedAt,
      time: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 }
  );
}
