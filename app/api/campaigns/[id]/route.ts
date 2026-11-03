import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";

const schema = z.object({ status: z.enum(["draft", "scheduled", "paused"]), scheduledAt: z.string().datetime().optional() });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = schema.parse(await req.json());
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id }, include: { template: true, accountAssignments: { include: { account: true } } } });
    if (input.status === "scheduled") {
      const schedule = input.scheduledAt ? new Date(input.scheduledAt) : campaign.scheduledAt;
      if (!schedule || schedule <= new Date()) return NextResponse.json({ error: "Choose a future send time." }, { status: 400 });
      if (!campaign.template || campaign.template.status !== "approved") return NextResponse.json({ error: "A Meta-approved template is required to schedule sending." }, { status: 409 });
      const senderReady = campaign.accountAssignments.some(({ account }) => account.status === "connected" && account.accessTokenEncrypted && account.phoneNumberId && account.id === campaign.template?.accountId);
      if (!senderReady) return NextResponse.json({ error: "Assign the connected sender that owns the approved template." }, { status: 409 });
      return NextResponse.json(await prisma.campaign.update({ where: { id }, data: { status: "scheduled", scheduledAt: schedule } }));
    }
    if (input.status === "draft" && campaign.sentAt) return NextResponse.json({ error: "A campaign that has started cannot be reset to draft." }, { status: 409 });
    const updated = await prisma.campaign.update({ where: { id }, data: { status: input.status, ...(input.scheduledAt ? { scheduledAt: new Date(input.scheduledAt) } : {}) } });
    await prisma.auditLog.create({ data: { action: `campaign.${input.status}`, entity: "campaign", entityId: id } });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message || "Invalid campaign update." }, { status: 400 });
    return apiError(error);
  }
}
