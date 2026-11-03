import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";

const row = z.object({
  name: z.string().trim().min(1).max(100),
  phone: z.string().trim().regex(/^\+?[1-9]\d{7,14}$/, "Each phone must use international format, for example +14155550123."),
  email: z.string().email().optional().or(z.literal("")),
  groupName: z.string().trim().max(100).optional(),
  tags: z.array(z.string().trim().max(40)).max(20).default([]),
  marketingOptIn: z.boolean().default(false),
  optedOut: z.boolean().default(false),
});

const schema = z.object({ contacts: z.array(row).min(1).max(1000) });

export async function POST(req: Request) {
  try {
    const { contacts } = schema.parse(await req.json());
    const createdAt = new Date();
    const result = await prisma.contact.createMany({
      data: contacts.map(contact => {
        const optedOut = contact.optedOut;
        const marketingOptIn = contact.marketingOptIn && !optedOut;
        return {
          ...contact,
          email: contact.email || null,
          groupName: contact.groupName || null,
          optedOut,
          marketingOptIn,
          marketingOptInAt: marketingOptIn ? createdAt : null,
          marketingOptInSource: marketingOptIn ? "csv-import-confirmed" : null,
        };
      }),
      skipDuplicates: true,
    });
    await prisma.auditLog.create({ data: { action: "contacts.imported", entity: "contact", detail: { created: result.count, submitted: contacts.length } } });
    return NextResponse.json({ created: result.count, skipped: contacts.length - result.count });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message || "Invalid CSV contact data." }, { status: 400 });
    return apiError(error);
  }
}
