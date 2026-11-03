import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { sendCampaignBatch } from "@/lib/campaign-sender";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH_SIZE = 10;
// Leave headroom for the response inside the 60s serverless limit.
const TIME_BUDGET_MS = 50_000;

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET || "";
  const supplied = req.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return secret.length >= 32 && a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const now = new Date();
  const due = await prisma.campaign.findMany({
    where: { status: { in: ["scheduled", "running"] }, scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" },
    take: 10,
    select: { id: true },
  });

  const deadline = Date.now() + TIME_BUDGET_MS;
  const results: Array<{
    campaignId: string;
    sent?: number;
    failed?: number;
    remaining?: number;
    status?: string;
    batches?: number;
    error?: string;
  }> = [];

  for (const campaign of due) {
    if (Date.now() >= deadline) break;
    let sent = 0;
    let failed = 0;
    let remaining = 0;
    let status = "running";
    let batches = 0;

    try {
      // The daily Hobby cron only runs once, so drain as many small batches
      // as the time budget allows instead of stopping after one batch.
      while (Date.now() < deadline) {
        const result = await sendCampaignBatch(campaign.id, BATCH_SIZE);
        batches += 1;
        sent += result.sent;
        failed += result.failed;
        remaining = result.remaining;
        status = result.status;
        if (result.status === "completed" || result.remaining === 0) break;
        if (result.sent === 0 && result.failed === 0) break;
      }
      results.push({ campaignId: campaign.id, sent, failed, remaining, status, batches });
    } catch (error) {
      results.push({
        campaignId: campaign.id,
        error: error instanceof Error ? error.message : "Could not process campaign.",
      });
    }
  }

  return NextResponse.json({ processed: results.length, results, at: now.toISOString(), timedOut: Date.now() >= deadline });
}
