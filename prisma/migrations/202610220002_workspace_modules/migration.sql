-- Persist the sender, audience, campaign assignment, and inbox modules.
ALTER TABLE "Template" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'marketing';
ALTER TABLE "Campaign" ADD COLUMN "audienceGroupId" TEXT;

CREATE TABLE "WhatsAppAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "phoneNumberId" TEXT,
    "businessAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsAppAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CampaignAccount" (
    "campaignId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CampaignAccount_pkey" PRIMARY KEY ("campaignId", "accountId")
);

CREATE TABLE "AudienceGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AudienceGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AudienceMembership" (
    "groupId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AudienceMembership_pkey" PRIMARY KEY ("groupId", "contactId")
);

CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "providerId" TEXT,
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppAccount_phone_key" ON "WhatsAppAccount"("phone");
CREATE INDEX "CampaignAccount_accountId_idx" ON "CampaignAccount"("accountId");
CREATE UNIQUE INDEX "AudienceGroup_name_key" ON "AudienceGroup"("name");
CREATE INDEX "AudienceMembership_contactId_idx" ON "AudienceMembership"("contactId");
CREATE UNIQUE INDEX "Conversation_contactId_key" ON "Conversation"("contactId");
CREATE INDEX "Conversation_status_lastMessageAt_idx" ON "Conversation"("status", "lastMessageAt");
CREATE UNIQUE INDEX "ConversationMessage_providerId_key" ON "ConversationMessage"("providerId");
CREATE INDEX "ConversationMessage_conversationId_createdAt_idx" ON "ConversationMessage"("conversationId", "createdAt");

ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_audienceGroupId_fkey" FOREIGN KEY ("audienceGroupId") REFERENCES "AudienceGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CampaignAccount" ADD CONSTRAINT "CampaignAccount_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignAccount" ADD CONSTRAINT "CampaignAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WhatsAppAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AudienceMembership" ADD CONSTRAINT "AudienceMembership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AudienceGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AudienceMembership" ADD CONSTRAINT "AudienceMembership_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve existing contact groups in the normalized audience tables.
INSERT INTO "AudienceGroup" ("id", "name", "updatedAt")
SELECT 'aud_' || md5("groupName"), "groupName", CURRENT_TIMESTAMP
FROM "Contact"
WHERE "groupName" IS NOT NULL AND btrim("groupName") <> ''
GROUP BY "groupName"
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "AudienceMembership" ("groupId", "contactId")
SELECT g."id", c."id"
FROM "Contact" c
JOIN "AudienceGroup" g ON g."name" = c."groupName"
WHERE c."groupName" IS NOT NULL
ON CONFLICT ("groupId", "contactId") DO NOTHING;
