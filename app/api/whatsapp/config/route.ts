import { NextResponse } from "next/server";
import { getMetaAppConfig, isUsableMetaAppId, isUsableMetaAppSecret } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getMetaAppConfig();
  const appIdValid = isUsableMetaAppId(config.appId);
  const configIdValid = config.configId.length > 0;
  const appSecretValid = isUsableMetaAppSecret(config.appSecret);
  const missing = [
    !appIdValid && "META_APP_ID",
    !configIdValid && "META_CONFIG_ID",
    !appSecretValid && "META_APP_SECRET",
  ].filter(Boolean);
  return NextResponse.json({
    enabled: missing.length === 0,
    cronConfigured: (process.env.CRON_SECRET?.trim().length || 0) >= 32,
    appId: appIdValid ? config.appId : "",
    configId: configIdValid ? config.configId : "",
    graphVersion: config.graphVersion,
    missing,
  });
}
