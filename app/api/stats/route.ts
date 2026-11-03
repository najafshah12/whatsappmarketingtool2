import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [contacts, messageGroups, campaignGroups, accounts, unread, recent] = await Promise.all([
      prisma.contact.count(),
      prisma.message.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.campaign.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.whatsAppAccount.count(),
      prisma.conversation.aggregate({ _sum: { unreadCount: true } }),
      prisma.campaign.findMany({ orderBy: { createdAt: "desc" }, take: 5 }),
    ]);

    const msgCounts: Record<string, number> = {};
    for (const m of messageGroups) {
      msgCounts[m.status] = m._count._all;
    }

    let totalCampaigns = 0;
    let runningCampaigns = 0;
    for (const c of campaignGroups) {
      totalCampaigns += c._count._all;
      if (c.status === "running") runningCampaigns += c._count._all;
    }

    const delivered = (msgCounts["delivered"] || 0) + (msgCounts["read"] || 0);
    const messages = (msgCounts["sent"] || 0) + delivered;
    const failed = msgCounts["failed"] || 0;

    return NextResponse.json({
      contacts,
      campaigns: totalCampaigns,
      messages,
      failed,
      delivered,
      running: runningCampaigns,
      accounts,
      unread: unread._sum.unreadCount ?? 0,
      recent,
    });
  } catch (e) {
    return apiError(e);
  }
}

