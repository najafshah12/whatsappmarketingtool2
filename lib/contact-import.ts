import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";

export type ContactRecord = { name: string; phone: string; email?: string; groupName?: string; tags?: string[]; marketingOptIn?: boolean; optedOut?: boolean };
export type ImportResult = { created: number; skipped: number; duplicatesInFile: number; invalid: number; invalidSamples: { row: number; value: string }[]; contactIds: string[] };

export async function importContactRecords(records: ContactRecord[], rowNumbers?: number[]): Promise<ImportResult> {
  const createdAt = new Date();
  const invalidSamples: { row: number; value: string }[] = [];
  let invalid = 0;
  let fallbackNameIndex = 0;
  const data = new Map<string, { name: string; phone: string; email: string | null; groupName: string | null; tags: string[]; optedOut: boolean; marketingOptIn: boolean; marketingOptInAt: Date | null; marketingOptInSource: string | null }>();
  records.forEach((contact, index) => {
    const phone = normalizePhone(contact.phone);
    if (!phone) { invalid++; if (invalidSamples.length < 8) invalidSamples.push({ row: rowNumbers?.[index] ?? index + 2, value: contact.phone }); return; }
    const previous = data.get(phone);
    const optedOut = Boolean(previous?.optedOut || contact.optedOut);
    const marketingOptIn = !optedOut && Boolean(previous?.marketingOptIn || contact.marketingOptIn);
    const suppliedName = (contact.name || "").trim().slice(0, 100);
    const name = suppliedName || previous?.name || `User ${++fallbackNameIndex}`;
    data.set(phone, { name, phone, email: contact.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email) ? contact.email : null, groupName: contact.groupName?.trim().slice(0, 100) || null, tags: (contact.tags ?? []).map(tag => tag.trim().slice(0, 40)).filter(Boolean).slice(0, 20), optedOut, marketingOptIn, marketingOptInAt: marketingOptIn ? createdAt : null, marketingOptInSource: marketingOptIn ? "import-confirmed" : null });
  });
  const values = [...data.values()];
  let created = 0;
  if (values.length) created = (await prisma.contact.createMany({ data: values, skipDuplicates: true })).count;
  const saved = values.length ? await prisma.contact.findMany({ where: { phone: { in: values.map(value => value.phone) } }, select: { id: true } }) : [];
  await prisma.auditLog.create({ data: { action: "contacts.imported", entity: "contact", detail: { created, submitted: records.length, invalid, duplicatesInFile: records.length - values.length - invalid } } });
  return { created, skipped: records.length - invalid - created, duplicatesInFile: Math.max(0, records.length - values.length - invalid), invalid, invalidSamples, contactIds: saved.map(contact => contact.id) };
}

export async function attachContactsToAudience(groupName: string, contactIds: string[]) {
  const name = groupName.trim().slice(0, 80);
  if (!name || !contactIds.length) return null;
  const group = await prisma.audienceGroup.upsert({ where: { name }, create: { name, description: "Created from a contact file import" }, update: {} });
  await prisma.audienceMembership.createMany({ data: contactIds.map(contactId => ({ groupId: group.id, contactId })), skipDuplicates: true });
  return group;
}

