import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendCampaignBatch } from "@/lib/campaign-sender";
import { workerAuthorized } from "@/lib/worker-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH_SIZE = 10;
// Leave headroom for the response inside the 60s serverless limit.
const TIME_BUDGET_MS = 50_000;

export async function GET(req: Request) {
  if (!workerAuthorized(req)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const now = new Date();
  const due = await prisma.campaign.findMany({
    where: {
      status: { in: ["scheduled", "running"] },
      // Running campaigns have no schedule; scheduled ones start when due.
      OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
    },
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
        const result = await sendCampaignBatch(campaign.id, BATCH_SIZE, { deadline });
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
