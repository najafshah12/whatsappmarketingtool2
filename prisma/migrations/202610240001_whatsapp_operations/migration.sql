ALTER TABLE "Contact"
  ADD COLUMN "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "marketingOptInAt" TIMESTAMP(3),
  ADD COLUMN "marketingOptInSource" TEXT;

ALTER TABLE "WhatsAppAccount"
  ADD COLUMN "metaBusinessId" TEXT,
  ADD COLUMN "accessTokenEncrypted" TEXT,
  ADD COLUMN "tokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN "connectedAt" TIMESTAMP(3),
  ADD COLUMN "webhookSubscribedAt" TIMESTAMP(3);

ALTER TABLE "Template"
  ADD COLUMN "metaTemplateId" TEXT,
  ADD COLUMN "accountId" TEXT,
  ADD COLUMN "lastSyncedAt" TIMESTAMP(3);

ALTER TABLE "Campaign"
  ADD COLUMN "templateId" TEXT;

ALTER TABLE "Conversation"
  ADD COLUMN "phoneNumberId" TEXT;

CREATE UNIQUE INDEX "Template_metaTemplateId_key" ON "Template"("metaTemplateId");
CREATE INDEX "Template_accountId_idx" ON "Template"("accountId");
CREATE INDEX "Campaign_templateId_idx" ON "Campaign"("templateId");
CREATE UNIQUE INDEX "Message_providerId_key" ON "Message"("providerId");

ALTER TABLE "Template"
  ADD CONSTRAINT "Template_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "WhatsAppAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Campaign"
  ADD CONSTRAINT "Campaign_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;
