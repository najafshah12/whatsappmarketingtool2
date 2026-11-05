import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { attachContactsToAudience, importContactRecords } from "@/lib/contact-import";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({
  phones: z.string().trim().min(1).max(2_500_000),
  groupName: z.string().trim().max(100).optional(),
  marketingOptIn: z.boolean().default(false),
});
const MAX_NUMBERS = 50000;

export async function POST(req: Request) {
  try {
    const input = schema.parse(await req.json());
    const phones = input.phones.split(/[\r\n,;\t]+/).map(phone => phone.trim()).filter(Boolean);
    if (phones.length > MAX_NUMBERS) {
      return NextResponse.json({ error: `Paste at most ${MAX_NUMBERS.toLocaleString()} phone numbers at a time.` }, { status: 413 });
    }
    if (!phones.length) return NextResponse.json({ error: "Paste phone numbers separated by new lines or commas." }, { status: 400 });

    const result = await importContactRecords(phones.map(phone => ({
      name: "",
      phone,
      groupName: input.groupName,
      marketingOptIn: input.marketingOptIn,
    })));
    const audience = input.groupName ? await attachContactsToAudience(input.groupName, result.contactIds) : null;
    return NextResponse.json({
      submitted: phones.length,
      created: result.created,
      skipped: result.skipped,
      duplicatesInPaste: result.duplicatesInFile,
      invalid: result.invalid,
      invalidSamples: result.invalidSamples,
      audience: audience ? { id: audience.id, name: audience.name } : null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message || "Paste valid phone numbers." }, { status: 400 });
    return apiError(error);
  }
}

