import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { accountAccessToken, graphRequest, WhatsAppApiError } from "@/lib/whatsapp";

const schema = z.object({ accountId: z.string().min(1) });
type MetaTemplate = { id?: string; name?: string; status?: string; language?: string; category?: string };
type TemplateList = { data?: MetaTemplate[] };

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { accountId } = schema.parse(await req.json());
    const [template, account] = await Promise.all([
      prisma.template.findUniqueOrThrow({ where: { id } }),
      prisma.whatsAppAccount.findUniqueOrThrow({ where: { id: accountId } }),
    ]);
    if (account.status !== "connected" || !account.businessAccountId || !account.phoneNumberId) {
      return NextResponse.json({ error: "Connect a WhatsApp Business account with Meta before syncing templates." }, { status: 409 });
    }
    const accessToken = accountAccessToken(account);
    const path = `${encodeURIComponent(account.businessAccountId)}/message_templates`;
    let metaTemplate: MetaTemplate | undefined;
    if (template.metaTemplateId || template.status === "pending" || template.status === "approved" || template.status === "rejected") {
      const query = new URLSearchParams({ name: template.name, fields: "id,name,status,language,category" });
      const list = await graphRequest<TemplateList>(accessToken, `${path}?${query}`);
      metaTemplate = list.data?.find(item => item.name === template.name && item.language === template.language);
      if (!metaTemplate) return NextResponse.json({ error: "Meta did not return this template. Check the connected account and retry." }, { status: 404 });
    } else {
      const variableCount = Math.max(0, ...[...template.body.matchAll(/\{\{(\d+)\}\}/g)].map(match => Number(match[1])));
      const response = await graphRequest<MetaTemplate>(accessToken, path, {
        method: "POST",
        body: JSON.stringify({
          name: template.name,
          language: template.language,
          category: template.category.toUpperCase(),
          components: [{ type: "BODY", text: template.body, ...(variableCount ? { example: { body_text: [Array.from({ length: variableCount }, (_, index) => `Example ${index + 1}`)] } } : {}) }],
        }),
      });
      metaTemplate = { ...response, status: response.status || "PENDING", id: response.id || template.metaTemplateId || undefined };
    }
    if (!metaTemplate.id) return NextResponse.json({ error: "Meta did not return a template ID. Check the connected business account permissions." }, { status: 502 });
    const updated = await prisma.template.update({
      where: { id },
      data: {
        metaTemplateId: metaTemplate.id,
        accountId: account.id,
        status: (metaTemplate.status || "PENDING").toLowerCase(),
        lastSyncedAt: new Date(),
      },
      include: { account: { select: { id: true, name: true, phone: true, status: true } } },
    });
    await prisma.auditLog.create({ data: { action: "template.synced", entity: "template", entityId: id, detail: { providerStatus: updated.status } } });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message || "Select a connected account." }, { status: 400 });
    const status = error instanceof WhatsAppApiError ? error.status : 503;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not sync this template with Meta." }, { status });
  }
}
