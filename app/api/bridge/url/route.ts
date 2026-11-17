import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { workerAuthorized } from "@/lib/worker-auth";
import {
  BRIDGE_API_KEY_KEY,
  BRIDGE_URL_KEY,
  bridgeConfig,
  bridgeEnvKey,
  bridgeEnvUrl,
  invalidateBridgeUrlCache,
} from "@/lib/bridge";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const schema = z.object({
  url: z.string().trim().url().max(200),
  key: z.string().trim().min(8).max(200).optional(),
});

/**
 * Called by scripts/start-all.ps1 whenever Cloudflare hands out a new quick
 * tunnel URL. Storing the URL (and key) in the database makes the switch
 * instant, so a replaced tunnel no longer needs a Vercel redeploy.
 */
export async function POST(req: Request) {
  if (!workerAuthorized(req)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Send {\"url\": \"https://example.trycloudflare.com\"} (and optionally the bridge API key)." }, { status: 400 });

    const url = parsed.data.url.replace(/\/+$/, "");
    const key = (parsed.data.key || "").trim();
    const rows: Array<{ key: string; value: string }> = [{ key: BRIDGE_URL_KEY, value: url }];
    if (key.length >= 8) rows.push({ key: BRIDGE_API_KEY_KEY, value: key });

    for (const row of rows) {
      await prisma.setting.upsert({ where: { key: row.key }, update: { value: row.value }, create: row });
    }
    invalidateBridgeUrlCache();

    // Confirm the app can actually reach the bridge through the new URL.
    const config = await bridgeConfig();
    let reachable = "no";
    try {
      const response = await fetch(`${url}/sessions/status`, {
        headers: { "x-api-key": config.key },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      reachable = response.ok ? "yes" : `http-${response.status}`;
    } catch { reachable = "no"; }

    return NextResponse.json({ ok: true, url, reachable, updatedKey: key.length >= 8 });
  } catch (error) { return apiError(error); }
}

/** Diagnostic helper: which URL is live, where it came from, does it answer? */
export async function GET() {
  const config = await bridgeConfig();
  let reachable = "no";
  if (config.configured) {
    try {
      const response = await fetch(`${config.base}/sessions/status`, {
        headers: { "x-api-key": config.key },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      reachable = response.ok ? "yes" : `http-${response.status}`;
    } catch { reachable = "no"; }
  }
  const envUrl = bridgeEnvUrl();
  return NextResponse.json({
    url: config.base || null,
    configured: config.configured,
    reachable,
    urlSource: config.base && config.base === envUrl ? "env" : "database",
    keySource: config.key && config.key === bridgeEnvKey() ? "env" : "database",
  });
}
