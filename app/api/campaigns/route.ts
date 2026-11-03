import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  message: z.string().trim().max(4096).default(""),
  contactIds: z.array(z.string()).max(1000).default([]),
  accountIds: z.array(z.string()).max(100).default([]),
  audienceGroupId: z.string().optional(),
  templateId: z.string().optional(),
  scheduledAt: z.string().datetime().optional(),
});

export async function GET() {
  try {
    return NextResponse.json(await prisma.campaign.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        _count: { select: { messages: true } },
        accountAssignments: { include: { account: { select: { id: true, name: true, phone: true, status: true, phoneNumberId: true } } } },
        audienceGroup: { select: { id: true, name: true } },
        template: { select: { id: true, name: true, body: true, status: true, language: true, accountId: true } },
      },
    }));
  } catch (error) { return apiError(error); }
}

export async function POST(req: Request) {
  try {
    const input = schema.parse(await req.json());
    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
    if (scheduledAt && scheduledAt <= new Date()) return NextResponse.json({ error: "Choose a future send time." }, { status: 400 });

    const [group, template, accounts] = await Promise.all([
      input.audienceGroupId ? prisma.audienceGroup.findUnique({ where: { id: input.audienceGroupId }, include: { members: { select: { contactId: true } } } }) : null,
      input.templateId ? prisma.template.findUnique({ where: { id: input.templateId } }) : null,
      input.accountIds.length ? prisma.whatsAppAccount.findMany({ where: { id: { in: input.accountIds } }, select: { id: true, status: true, phoneNumberId: true, accessTokenEncrypted: true } }) : [],
    ]);
    if (input.audienceGroupId && !group) return NextResponse.json({ error: "Audience list not found." }, { status: 404 });
    if (input.templateId && !template) return NextResponse.json({ error: "Template not found." }, { status: 404 });
    if (input.accountIds.length !== accounts.length) return NextResponse.json({ error: "One or more sender accounts were not found." }, { status: 400 });
    if (scheduledAt) {
      if (!template || template.status !== "approved") return NextResponse.json({ error: "Scheduled campaigns need a Meta-approved template." }, { status: 409 });
      if (!accounts.some(account => account.status === "connected" && account.phoneNumberId && account.id === template.accountId && account.accessTokenEncrypted)) return NextResponse.json({ error: "Assign the connected sender that owns this approved template." }, { status: 409 });
    }

    const selectedIds = group ? group.members.map(member => member.contactId) : input.contactIds;
    const where = {
      id: { in: [...new Set(selectedIds)] },
      optedOut: false,
      marketingOptIn: true,
    };
    const eligible = selectedIds.length ? await prisma.contact.findMany({ where, select: { id: true } }) : [];
    if (scheduledAt && eligible.length === 0) return NextResponse.json({ error: "This audience has no contacts with recorded marketing consent." }, { status: 409 });
    const message = input.message || template?.body || "";
    if (!message && !template) return NextResponse.json({ error: "Add a message or choose a template." }, { status: 400 });

    const campaign = await prisma.campaign.create({
      data: {
        name: input.name,
        message,
        status: scheduledAt ? "scheduled" : "draft",
        scheduledAt,
        total: eligible.length,
        ...(template ? { template: { connect: { id: template.id } } } : {}),
        ...(group ? { audienceGroup: { connect: { id: group.id } } } : {}),
        ...(accounts.length ? { accountAssignments: { create: accounts.map(account => ({ account: { connect: { id: account.id } } })) } } : {}),
        ...(eligible.length ? { messages: { create: eligible.map(contact => ({ contactId: contact.id, status: "queued" })) } } : {}),
      },
      include: { accountAssignments: { include: { account: { select: { id: true, name: true, phone: true, status: true, phoneNumberId: true } } } }, audienceGroup: true, template: true, _count: { select: { messages: true } } },
    });
    await prisma.auditLog.create({ data: { action: "campaign.created", entity: "campaign", entityId: campaign.id, detail: { recipients: eligible.length, scheduled: Boolean(scheduledAt), templateId: template?.id ?? null } } });
    return NextResponse.json(campaign, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message || "Invalid campaign." }, { status: 400 });
    return apiError(error);
  }
}
