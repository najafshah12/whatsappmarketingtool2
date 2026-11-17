import { prisma } from "@/lib/prisma";
import { accountAccessToken, phoneForWhatsAppApi, sendCloudMessage, WhatsAppApiError } from "@/lib/whatsapp";
import { BridgeApiError, bridgeMinDelayMs, bridgeSend, renderBridgeMessage } from "@/lib/bridge";

type CloudSendResponse = { messages?: { id?: string }[] };
type SenderAccount = {
  id: string;
  name: string;
  provider: string;
  bridgeSessionId: string | null;
  phoneNumberId: string | null;
  accessTokenEncrypted: string | null;
  status: string;
  tokenExpiresAt: Date | null;
};

function templateParameters(body: string, contact: { name: string; phone: string; email: string | null }) {
  const indexes = [...body.matchAll(/\{\{(\d+)\}\}/g)].map(match => Number(match[1]));
  const count = Math.max(0, ...indexes);
  if (count === 0) return undefined;
  if (count > 3) throw new Error("Campaign templates can use up to three contact fields: {{1}} name, {{2}} phone, {{3}} email.");
  const values = [contact.name, contact.phone, contact.email || ""];
  return [{ type: "body", parameters: values.slice(0, count).map(text => ({ type: "text", text })) }];
}

/** Baileys/QR senders use a session instead of a Meta token. */
export function isBridgeAccount(account: Pick<SenderAccount, "provider">) {
  return account.provider === "bridge";
}

function isSendable(account: SenderAccount) {
  if (account.status !== "connected") return false;
  if (isBridgeAccount(account)) return Boolean(account.bridgeSessionId);
  return Boolean(account.phoneNumberId && (account.accessTokenEncrypted || process.env.WA_ACCESS_TOKEN));
}

export type SendBatchOptions = {
  /** Stop starting new sends after this timestamp so a serverless call can answer in time. */
  deadline?: number;
};

export async function sendCampaignBatch(campaignId: string, batchSize = 10, options: SendBatchOptions = {}) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      template: true,
      accountAssignments: { include: { account: true }, orderBy: { assignedAt: "asc" } },
    },
  });
  if (!campaign) throw new Error("Campaign not found.");
  if (campaign.status === "paused") throw new Error("Resume this campaign before sending.");
  if (!campaign.template && !campaign.message.trim()) throw new Error("This campaign has no message or template to send.");

  // Find assigned connected account; prioritize template owner, or fallback to assigned connected account
  const assignedAccounts = (campaign.accountAssignments.map(item => item.account) as SenderAccount[]).filter(isSendable);

  const primaryAccount = assignedAccounts.find(item => item.id === campaign.template?.accountId) || assignedAccounts[0];
  const accounts = campaign.rotationIntervalSeconds > 0 ? assignedAccounts : primaryAccount ? [primaryAccount] : [];

  if (accounts.length === 0) {
    const expiredAccount = (campaign.accountAssignments.map(item => item.account) as SenderAccount[]).find(item => item.status === "expired");
    if (expiredAccount) {
      throw new Error(`The WhatsApp access token for "${expiredAccount.name}" has expired. Open WhatsApp Accounts → Update Token and paste a fresh token.`);
    }
    throw new Error("Assign a connected sender with a valid WhatsApp number to this campaign.");
  }

  // A QR/Baileys sender has no Meta approval step: it sends the rendered text.
  const allBridge = accounts.every(isBridgeAccount);
  if (campaign.template && campaign.template.status !== "approved" && !allBridge) {
    throw new Error("Choose a Meta-approved template before sending a campaign.");
  }
  if (!allBridge && !campaign.template) {
    throw new Error("Meta senders need a Meta-approved template. Choose a template, or send through a QR (Baileys) sender.");
  }

  const expired = accounts.find(account => !isBridgeAccount(account) && account.tokenExpiresAt && account.tokenExpiresAt.getTime() <= Date.now());
  if (expired) {
    throw new Error(`The WhatsApp access token for "${expired.name}" has expired. Please update it in Accounts.`);
  }
  accounts.filter(account => !isBridgeAccount(account)).forEach(account => accountAccessToken(account as Parameters<typeof accountAccessToken>[0]));

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

  const order = await prisma.message.findMany({ where: { campaignId }, orderBy: { createdAt: "asc" }, select: { id: true } });
  const ordinal = new Map(order.map((item, index) => [item.id, index]));
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // Bridge senders must never burst: enforce a floor plus jitter so the pattern
  // looks human. Meta senders keep the interval the operator configured.
  const usesBridge = accounts.some(isBridgeAccount);
  const configuredIntervalMs = campaign.rotationIntervalSeconds * 1000;
  const intervalMs = usesBridge ? Math.max(configuredIntervalMs, bridgeMinDelayMs()) : configuredIntervalMs;
  const jitterMs = usesBridge ? Math.round(intervalMs * 0.3) : 0;

  let sent = 0;
  let failed = 0;
  let lastAttemptAt = 0;

  // Bridge spacing must survive separate HTTP batches: the dashboard sends one
  // message per request when a campaign interval is set, so the previous send
  // time is read from the database instead of an in-memory variable.
  if (usesBridge) {
    const lastSent = await prisma.message.findFirst({
      where: { campaignId, status: { in: ["sent", "delivered", "read"] }, sentAt: { not: null } },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    });
    if (lastSent?.sentAt) lastAttemptAt = lastSent.sentAt.getTime();
  }
  // Reserve time for the network round trip so a started send still answers
  // inside the serverless limit.
  const reserveMs = usesBridge ? 22_000 : 5_000;

  for (const message of queued) {
    const waitMs = lastAttemptAt > 0 && intervalMs > 0
      ? Math.max(0, intervalMs + Math.round(Math.random() * jitterMs) - (Date.now() - lastAttemptAt))
      : 0;
    // Leaving the message queued is safe: the next batch (or cron run) picks it up.
    if (options.deadline && Date.now() + waitMs + reserveMs >= options.deadline) break;
    if (waitMs > 0) await wait(waitMs);

    const claim = await prisma.message.updateMany({ where: { id: message.id, status: "queued" }, data: { status: "sending", error: null } });
    if (claim.count !== 1) continue;
    try {
      const account = accounts[(ordinal.get(message.id) ?? 0) % accounts.length];
      lastAttemptAt = Date.now();

      if (isBridgeAccount(account)) {
        const text = renderBridgeMessage(campaign.template?.body || campaign.message, message.contact);
        const result = await bridgeSend({
          sessionId: account.bridgeSessionId as string,
          number: message.contact.phone,
          message: text,
        });
        await prisma.$transaction([
          prisma.message.update({ where: { id: message.id }, data: { status: "sent", sentAt: new Date(), error: null } }),
          prisma.messageEvent.create({
            data: {
              messageId: message.id,
              status: "sent",
              payload: { provider: "bridge", sessionId: account.bridgeSessionId, to: result.to ?? message.contact.phone },
            },
          }),
        ]);
        sent += 1;
        continue;
      }

      accountAccessToken(account as Parameters<typeof accountAccessToken>[0]);
      const components = templateParameters(campaign.template?.body ?? "", message.contact);
      const result = await sendCloudMessage<CloudSendResponse>(account as Parameters<typeof sendCloudMessage>[0], {
        to: phoneForWhatsAppApi(message.contact.phone),
        type: "template",
        template: {
          name: campaign.template?.name,
          language: { code: campaign.template?.language },
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
      if (error instanceof BridgeApiError && error.status === 401) {
        const reason = "The WhatsApp bridge rejected the API key (401). Update WA_BRIDGE_API_KEY and resume the campaign.";
        await prisma.message.update({ where: { id: message.id }, data: { status: "failed", error: reason } });
        failed += 1;
        throw new Error(reason);
      }

      let reason = error instanceof WhatsAppApiError || error instanceof BridgeApiError
        ? error.message
        : error instanceof Error ? error.message : "Send failed.";
      let eventStatus = "failed";
      if (error instanceof BridgeApiError && error.status === 404) {
        reason = `Number is not registered on WhatsApp. ${reason}`.trim();
        eventStatus = "invalid";
      } else if (error instanceof BridgeApiError && error.status === 400) {
        // A bridge 400 means that sender is not connected: let the next batch
        // retry the message instead of burning the recipient.
        await prisma.message.update({ where: { id: message.id }, data: { status: "queued", error: reason.slice(0, 500) } });
        failed += 1;
        continue;
      }
      await prisma.$transaction([
        prisma.message.update({ where: { id: message.id }, data: { status: "failed", error: reason.slice(0, 500) } }),
        prisma.messageEvent.create({ data: { messageId: message.id, status: eventStatus, payload: { provider: isBridgeAccount(accounts[(ordinal.get(message.id) ?? 0) % accounts.length]) ? "bridge" : "meta", error: reason.slice(0, 500) } } }),
      ]);
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
