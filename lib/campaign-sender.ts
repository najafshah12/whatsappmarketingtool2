import { prisma } from "@/lib/prisma";
import { accountAccessToken, phoneForWhatsAppApi, sendCloudMessage, WhatsAppApiError } from "@/lib/whatsapp";

type CloudSendResponse = { messages?: { id?: string }[] };

function templateParameters(body: string, contact: { name: string; phone: string; email: string | null }) {
  const indexes = [...body.matchAll(/\{\{(\d+)\}\}/g)].map(match => Number(match[1]));
  const count = Math.max(0, ...indexes);
  if (count === 0) return undefined;
  if (count > 3) throw new Error("Campaign templates can use up to three contact fields: {{1}} name, {{2}} phone, {{3}} email.");
  const values = [contact.name, contact.phone, contact.email || ""];
  return [{ type: "body", parameters: values.slice(0, count).map(text => ({ type: "text", text })) }];
}

export async function sendCampaignBatch(campaignId: string, batchSize = 10) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      template: true,
      accountAssignments: { include: { account: true }, orderBy: { assignedAt: "asc" } },
    },
  });
  if (!campaign) throw new Error("Campaign not found.");
  if (campaign.status === "paused") throw new Error("Resume this campaign before sending.");
  if (!campaign.template || campaign.template.status !== "approved") throw new Error("Choose a Meta-approved template before sending a campaign.");

  const account = campaign.accountAssignments.map(item => item.account).find(item =>
    item.status === "connected" && item.phoneNumberId && item.accessTokenEncrypted && item.id === campaign.template?.accountId,
  );
  if (!account) throw new Error("Assign the connected sender that owns this approved template.");
  if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() <= Date.now()) throw new Error("The WhatsApp access token has expired. Reconnect this sender with Meta.");
  accountAccessToken(account);

  await prisma.message.updateMany({
    where: { campaignId, status: "queued", OR: [{ contact: { is: { optedOut: true } } }, { contact: { is: { marketingOptIn: false } } }] },
    data: { status: "skipped", error: "Contact does not have current marketing consent." },
  });
  const queued = await prisma.message.findMany({
    where: { campaignId, status: "queued", contact: { is: { optedOut: false, marketingOptIn: true } } },
    include: { contact: { select: { id: true, name: true, phone: true, email: true } } },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(batchSize, 10)),
  });
  if (queued.length === 0) {
    const grouped = await prisma.message.groupBy({ by: ["status"], where: { campaignId }, _count: { _all: true } });
    const counts = Object.fromEntries(grouped.map(row => [row.status, row._count._all]));
    if ((counts.queued || 0) === 0 && (counts.sending || 0) > 0) {
      return { sent: 0, failed: 0, remaining: counts.sending || 0, status: "running" };
    }
    if ((counts.queued || 0) === 0) {
      await prisma.campaign.update({ where: { id: campaignId }, data: { status: "completed", sentAt: campaign.sentAt || new Date(), delivered: counts.delivered || 0, read: counts.read || 0, failed: counts.failed || 0 } });
      return { sent: 0, failed: 0, remaining: 0, status: "completed" };
    }
    throw new Error("No consented, queued recipients remain in this campaign.");
  }

  let sent = 0;
  let failed = 0;
  for (const message of queued) {
    const claim = await prisma.message.updateMany({ where: { id: message.id, status: "queued" }, data: { status: "sending", error: null } });
    if (claim.count !== 1) continue;
    try {
      const components = templateParameters(campaign.template.body, message.contact);
      const result = await sendCloudMessage<CloudSendResponse>(account, {
        to: phoneForWhatsAppApi(message.contact.phone),
        type: "template",
        template: {
          name: campaign.template.name,
          language: { code: campaign.template.language },
          ...(components ? { components } : {}),
        },
      });
      const providerId = result.messages?.[0]?.id;
      if (!providerId) throw new Error("Meta accepted the request without returning a message ID.");
      await prisma.$transaction([
        prisma.message.update({ where: { id: message.id }, data: { status: "sent", providerId, sentAt: new Date(), error: null } }),
        prisma.messageEvent.create({ data: { messageId: message.id, status: "sent", payload: { providerId } } }),
      ]);
      sent += 1;
    } catch (error) {
      const reason = error instanceof WhatsAppApiError ? error.message : error instanceof Error ? error.message : "Meta send failed.";
      await prisma.message.update({ where: { id: message.id }, data: { status: "failed", error: reason.slice(0, 500) } });
      failed += 1;
    }
  }

  const grouped = await prisma.message.groupBy({ by: ["status"], where: { campaignId }, _count: { _all: true } });
  const counts = Object.fromEntries(grouped.map(row => [row.status, row._count._all]));
  const remaining = (counts.queued || 0) + (counts.sending || 0);
  const nextStatus = remaining > 0 ? "running" : "completed";
  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status: nextStatus,
      sentAt: campaign.sentAt || new Date(),
      delivered: counts.delivered || 0,
      read: counts.read || 0,
      failed: counts.failed || 0,
    },
  });
  await prisma.auditLog.create({ data: { action: "campaign.batch_sent", entity: "campaign", entityId: campaignId, detail: { sent, failed, remaining } } });
  return { sent, failed, remaining, status: nextStatus };
}
