import { NextResponse } from "next/server";
import { getMetaAppConfig } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getMetaAppConfig();
  const missing = [
    !config.appId && "META_APP_ID",
    !config.configId && "META_CONFIG_ID",
    !config.appSecret && "META_APP_SECRET",
  ].filter(Boolean);
  return NextResponse.json({
    enabled: missing.length === 0,
    cronConfigured: (process.env.CRON_SECRET?.trim().length || 0) >= 32,
    appId: config.appId,
    configId: config.configId,
    graphVersion: config.graphVersion,
    missing,
  });
}
