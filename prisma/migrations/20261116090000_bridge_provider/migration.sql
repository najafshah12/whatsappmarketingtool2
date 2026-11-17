-- Add the Baileys/QR (bridge) sender option next to the Meta Cloud API senders.

ALTER TABLE "WhatsAppAccount" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'meta';
ALTER TABLE "WhatsAppAccount" ADD COLUMN "bridgeSessionId" TEXT;

CREATE UNIQUE INDEX "WhatsAppAccount_bridgeSessionId_key" ON "WhatsAppAccount"("bridgeSessionId");
