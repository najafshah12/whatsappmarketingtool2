import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { normalizePhone } from "@/lib/phone";

const row = z.object({
  name: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(1).max(32),
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
    const invalidRows: number[] = [];
    const data = new Map<string, {
      name: string;
      phone: string;
      email: string | null;
      groupName: string | null;
      tags: string[];
      optedOut: boolean;
      marketingOptIn: boolean;
      marketingOptInAt: Date | null;
      marketingOptInSource: string | null;
    }>();

    contacts.forEach((contact, index) => {
      const phone = normalizePhone(contact.phone);
      if (!phone) {
        // +2 accounts for the header row in the uploaded CSV.
        invalidRows.push(index + 2);
        return;
      }
      const optedOut = contact.optedOut;
      const marketingOptIn = contact.marketingOptIn && !optedOut;
      data.set(phone, {
        name: contact.name,
        phone,
        email: contact.email || null,
        groupName: contact.groupName || null,
        tags: contact.tags,
        optedOut,
        marketingOptIn,
        marketingOptInAt: marketingOptIn ? createdAt : null,
        marketingOptInSource: marketingOptIn ? "csv-import-confirmed" : null,
      });
    });

    if (invalidRows.length) {
      const preview = invalidRows.slice(0, 8).join(", ");
      return NextResponse.json(
        {
          error: `Invalid international phone number${invalidRows.length === 1 ? "" : "s"} on CSV row${invalidRows.length === 1 ? "" : "s"} ${preview}${invalidRows.length > 8 ? "…" : ""}. Use a format like +14155550123.`,
        },
        { status: 400 }
      );
    }

    const result = await prisma.contact.createMany({
      data: [...data.values()],
      skipDuplicates: true,
    });
    await prisma.auditLog.create({
      data: {
        action: "contacts.imported",
        entity: "contact",
        detail: { created: result.count, submitted: contacts.length, duplicatesInFile: contacts.length - data.size },
      },
    });
    return NextResponse.json({
      created: result.count,
      skipped: contacts.length - result.count,
      duplicatesInFile: contacts.length - data.size,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Invalid CSV contact data." }, { status: 400 });
    }
    return apiError(error);
  }
}
