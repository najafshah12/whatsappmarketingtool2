import { NextResponse } from "next/server";
import { z } from "zod";
import { sendCampaignBatch } from "@/lib/campaign-sender";
import { WhatsAppApiError } from "@/lib/whatsapp";
import { prisma } from "@/lib/prisma";

const schema = z.object({ batchSize: z.number().int().min(1).max(10).default(5) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const campaign = await prisma.campaign.findUnique({ where: { id }, select: { scheduledAt: true, status: true } });
    if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
    if (campaign.status === "scheduled" && campaign.scheduledAt && campaign.scheduledAt > new Date()) return NextResponse.json({ error: "This campaign is scheduled for a future time." }, { status: 409 });
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid batch size." }, { status: 400 });
    return NextResponse.json(await sendCampaignBatch(id, parsed.data.batchSize));
  } catch (error) {
    const status = error instanceof WhatsAppApiError ? error.status : error instanceof Error && error.message === "Campaign not found." ? 404 : 409;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not send this campaign." }, { status });
  }
}
