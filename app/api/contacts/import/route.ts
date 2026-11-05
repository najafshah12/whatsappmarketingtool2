import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { attachContactsToAudience, importContactRecords } from "@/lib/contact-import";

const row = z.object({
  name: z.string().trim().max(100).optional().default(""),
  phone: z.preprocess(
    value => typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value,
    z.string().trim().min(1).max(32)
  ),
  email: z.string().email().optional().or(z.literal("")),
  groupName: z.string().trim().max(100).optional(),
  tags: z.array(z.string().trim().max(40)).max(20).default([]),
  marketingOptIn: z.boolean().default(false),
  optedOut: z.boolean().default(false),
});

const schema = z.object({
  contacts: z.array(row).min(1).max(50000),
  groupName: z.string().trim().max(100).optional(),
  marketingOptIn: z.boolean().optional(),
});

export async function POST(req: Request) {
  try {
    const { contacts, groupName, marketingOptIn = false } = schema.parse(await req.json());
    const result = await importContactRecords(contacts.map(contact => ({
      ...contact,
      groupName: contact.groupName || groupName,
      marketingOptIn: marketingOptIn || contact.marketingOptIn,
    })));
    const audience = groupName ? await attachContactsToAudience(groupName, result.contactIds) : null;
    return NextResponse.json({
      created: result.created,
      skipped: result.skipped,
      invalid: result.invalid,
      invalidSamples: result.invalidSamples,
      duplicatesInFile: result.duplicatesInFile,
      audience: audience ? { id: audience.id, name: audience.name } : null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Invalid CSV contact data." }, { status: 400 });
    }
    return apiError(error);
  }
}

