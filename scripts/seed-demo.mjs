import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const marker = "demo.seed.reachpulse.v1";

const names = [
  "Ava Carter", "Noah Bennett", "Mia Brooks", "Liam Foster", "Zoe Morgan", "Ethan Reed",
  "Ivy Collins", "Lucas Perry", "Nora Hayes", "Mason Price", "Ella Ward", "Leo James",
  "Aria Bell", "Jack Murphy", "Ruby Kelly", "Owen Ross", "Lily Cooper", "Ezra Bailey",
  "Maya Rivera", "Theo Gray", "Layla Cox", "Finn Howard", "Sara Diaz", "Adam Hughes",
];
const groupNames = ["Demo - New Leads", "Demo - Customers", "Demo - VIP Circle"];
const now = new Date();
const daysAgo = (days) => new Date(now.getTime() - days * 86_400_000);

try {
  const existing = await prisma.setting.findUnique({ where: { key: marker }, select: { value: true } });
  if (existing) {
    console.log(`Demo data is already installed (${existing.value}). No records changed.`);
    process.exitCode = 0;
  } else {
    const result = await prisma.$transaction(async (tx) => {
      const contacts = [];
      for (let i = 0; i < names.length; i += 1) {
        const phone = `+12025550${String(100 + i).padStart(2, "0")}`;
        contacts.push(await tx.contact.upsert({
          where: { phone },
          create: {
            name: `DEMO ${names[i]}`,
            phone,
            email: `demo${String(i + 1).padStart(2, "0")}@example.test`,
            groupName: i < 10 ? groupNames[0] : i < 20 ? groupNames[1] : groupNames[2],
            tags: ["demo", i % 2 ? "lead" : "customer"],
            optedOut: i === 22 || i === 23,
            createdAt: daysAgo(24 - i),
          },
          update: {},
        }));
      }

      const groups = [];
      for (const [index, name] of groupNames.entries()) {
        groups.push(await tx.audienceGroup.upsert({
          where: { name },
          create: { name, description: ["Sample opt-in leads", "Sample returning customers", "Sample VIP contacts"][index] },
          update: {},
        }));
      }
      const memberships = contacts.flatMap((contact, index) => {
        const groupIndex = index < 10 ? 0 : index < 20 ? 1 : 2;
        return [{ groupId: groups[groupIndex].id, contactId: contact.id }];
      });
      await tx.audienceMembership.createMany({ data: memberships, skipDuplicates: true });

      const accounts = [];
      for (let i = 0; i < 4; i += 1) {
        const phone = `+1202555019${i}`;
        accounts.push(await tx.whatsAppAccount.upsert({
          where: { phone },
          create: { name: `DEMO Sender ${i + 1}`, phone, status: "disconnected" },
          update: {},
        }));
      }

      const templates = [
        ["demo_welcome", "Hello {{1}}, thanks for joining our community!", "utility"],
        ["demo_product_news", "Hi {{1}}, take a look at what's new this month.", "marketing"],
        ["demo_appointment_reminder", "Hello {{1}}, this is a reminder about your upcoming appointment.", "utility"],
        ["demo_feedback", "Hi {{1}}, how was your recent experience with us?", "marketing"],
      ];
      for (const [name, body, category] of templates) {
        const existingTemplate = await tx.template.findFirst({ where: { name }, select: { id: true } });
        if (!existingTemplate) await tx.template.create({ data: { name, body, category, language: "en_US", status: "draft" } });
      }

      const campaignSpecs = [
        { name: "DEMO - Spring product update", message: "A sample product update for opted-in customers.", status: "completed", audience: 0, days: 5 },
        { name: "DEMO - Welcome series", message: "A sample welcome note for new subscribers.", status: "completed", audience: 0, days: 3 },
        { name: "DEMO - November launch invite", message: "A sample invite to an upcoming product launch.", status: "scheduled", audience: 1, days: 0 },
        { name: "DEMO - VIP thank-you", message: "A sample thank-you note for the VIP group.", status: "draft", audience: 2, days: 1 },
      ];
      const campaigns = [];
      for (let i = 0; i < campaignSpecs.length; i += 1) {
        const spec = campaignSpecs[i];
        const group = groups[spec.audience];
        const members = await tx.audienceMembership.findMany({
          where: { groupId: group.id, contact: { optedOut: false } },
          orderBy: { addedAt: "asc" },
          take: i === 0 ? 8 : i === 1 ? 6 : i === 2 ? 8 : 4,
          select: { contactId: true },
        });
        const createdAt = daysAgo(spec.days);
        const scheduledAt = spec.status === "scheduled" ? new Date(now.getTime() + 3 * 86_400_000) : null;
        const sentAt = spec.status === "completed" ? createdAt : null;
        const campaign = await tx.campaign.create({
          data: {
            name: spec.name,
            message: spec.message,
            status: spec.status,
            total: members.length,
            delivered: spec.status === "completed" ? members.length - 1 : 0,
            read: spec.status === "completed" ? Math.max(1, members.length - 3) : 0,
            failed: spec.status === "completed" ? 1 : 0,
            createdAt,
            sentAt,
            scheduledAt,
            audienceGroupId: group.id,
          },
        });
        campaigns.push(campaign);
        await tx.campaignAccount.createMany({ data: accounts.slice(0, 2).map((account) => ({ campaignId: campaign.id, accountId: account.id })), skipDuplicates: true });
        await tx.message.createMany({
          data: members.map((member, index) => ({
            contactId: member.contactId,
            campaignId: campaign.id,
            status: spec.status === "completed" ? (index === members.length - 1 ? "failed" : index % 2 ? "read" : "delivered") : "queued",
            sentAt: spec.status === "completed" ? createdAt : null,
            createdAt,
            error: spec.status === "completed" && index === members.length - 1 ? "DEMO only: simulated delivery failure" : null,
          })),
        });
      }

      const inboxContacts = [contacts[0], contacts[3], contacts[6], contacts[11], contacts[15], contacts[20]];
      const replies = [
        "Thanks, please send me more details.",
        "What time does the offer end?",
        "Please remove me from future messages.",
        "I would like to book a call.",
        "Can you share the product link?",
        "Thank you for the update!",
      ];
      for (let i = 0; i < inboxContacts.length; i += 1) {
        const createdAt = daysAgo(i);
        const conversation = await tx.conversation.create({
          data: { contactId: inboxContacts[i].id, status: "open", unreadCount: i < 3 ? 1 : 0, lastMessageAt: createdAt, createdAt },
        });
        await tx.conversationMessage.create({
          data: { conversationId: conversation.id, direction: "inbound", body: `DEMO reply: ${replies[i]}`, status: "received", createdAt },
        });
      }

      await tx.setting.create({ data: { key: marker, value: `${contacts.length} contacts, ${campaigns.length} campaigns, ${inboxContacts.length} inbox conversations` } });
      return { contacts: contacts.length, accounts: accounts.length, groups: groups.length, campaigns: campaigns.length, templates: templates.length, conversations: inboxContacts.length };
    });
    console.log(`Inserted ReachPulse demo data: ${JSON.stringify(result)}.`);
  }
} catch (error) {
  console.error("Could not seed demo data:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
