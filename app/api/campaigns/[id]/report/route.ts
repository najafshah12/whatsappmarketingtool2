import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function ascii(value: unknown, max = 120) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/[\\()]/g, "\\$&")
    .replace(/[\r\n]+/g, " ")
    .slice(0, max);
}

function column(value: unknown, width: number) {
  return ascii(value, width).padEnd(width, " ");
}

function makePdf(lines: string[]) {
  const pages: string[][] = [];
  const pageRows = 55;
  pages.push(lines.slice(0, pageRows));
  for (let offset = pageRows; offset < lines.length; offset += pageRows - 2) {
    pages.push(["Recipient detail (continued)", "NAME                 | PHONE              | STATUS     | SENT AT             | DETAILS", ...lines.slice(offset, offset + pageRows - 2)]);
  }

  const pageIds = pages.map((_, index) => 4 + index * 2);
  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  pages.forEach((page, index) => {
    const pageId = pageIds[index];
    const streamId = pageId + 1;
    const commands = [
      "BT /F1 8 Tf 40 810 Td (ReachPulse Campaign Report) Tj ET",
      `BT /F1 8 Tf 500 810 Td (Page ${index + 1}/${pages.length}) Tj ET`,
      ...page.map((line, lineIndex) => `BT /F1 7 Tf 40 ${790 - lineIndex * 13} Td (${line}) Tj ET`),
    ].join("\n");
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`;
    objects[streamId] = `<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`;
  });

  let document = "%PDF-1.4\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = document.length;
    document += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = document.length;
  document += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) document += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(document);
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      messages: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: { contact: { select: { name: true, phone: true } } },
      },
    },
  });
  if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

  const counts = campaign.messages.reduce<Record<string, number>>((result, message) => {
    result[message.status] = (result[message.status] ?? 0) + 1;
    return result;
  }, {});
  const delivered = (counts.delivered ?? 0) + (counts.read ?? 0);
  const accepted = delivered + (counts.sent ?? 0);
  const total = campaign.messages.length;
  const rate = total ? Math.round((delivered / total) * 100) : 0;
  const details = campaign.messages.map(message => [
    column(message.contact.name, 20),
    column(message.contact.phone, 18),
    column(message.status, 10),
    column(message.sentAt?.toISOString() ?? "—", 19),
    ascii(message.error || "", 40),
  ].join(" | "));

  const summary = [
    `Campaign: ${ascii(campaign.name, 100)}`,
    `Campaign ID: ${ascii(campaign.id, 80)}`,
    `Generated: ${new Date().toISOString()}`,
    `Status: ${ascii(campaign.status, 24)} | Scheduled: ${campaign.scheduledAt?.toISOString() ?? "Not scheduled"}`,
    `Recipients: ${total} | Delivered/read: ${delivered} | Accepted by WhatsApp: ${accepted} | Success rate: ${rate}%`,
    `Failed: ${counts.failed ?? 0} | Pending: ${(counts.queued ?? 0) + (counts.sending ?? 0)} | Skipped: ${counts.skipped ?? 0}`,
    "",
    "Recipient detail",
    "NAME                 | PHONE              | STATUS     | SENT AT             | DETAILS",
    ...details,
  ];

  await prisma.auditLog.create({ data: { action: "campaign.report_downloaded", entity: "campaign", entityId: campaign.id, detail: { recipients: total } } });

  const filename = ascii(campaign.name, 80).trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "campaign-report";
  return new NextResponse(makePdf(summary), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}-report.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
