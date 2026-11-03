import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { sendCampaignBatch } from "@/lib/campaign-sender";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

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
  const due = await prisma.campaign.findMany({ where: { status: { in: ["scheduled", "running"] }, scheduledAt: { lte: now } }, orderBy: { scheduledAt: "asc" }, take: 5, select: { id: true } });
  const results = [];
  for (const campaign of due) {
    try { results.push({ campaignId: campaign.id, ...(await sendCampaignBatch(campaign.id, 5)) }); }
    catch (error) { results.push({ campaignId: campaign.id, error: error instanceof Error ? error.message : "Could not process campaign." }); }
  }
  return NextResponse.json({ processed: results.length, results, at: now.toISOString() });
}
