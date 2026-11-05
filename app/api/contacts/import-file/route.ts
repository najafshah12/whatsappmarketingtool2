import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { attachContactsToAudience, importContactRecords } from "@/lib/contact-import";
import { mapRowsToContacts, parseSpreadsheet } from "@/lib/spreadsheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ROWS = 50000;

export async function POST(req: Request) {
  try {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!form || !(file instanceof File)) {
      return NextResponse.json({ error: "Choose an .xlsx, .xlsm, .csv, .txt or .tsv file to import." }, { status: 400 });
    }
    if (file.size === 0) return NextResponse.json({ error: "The selected file is empty." }, { status: 400 });
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "This file is larger than 4 MB. Split it into smaller files and import again." }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let table;
    try {
      table = parseSpreadsheet(buffer, file.name);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read this file." }, { status: 400 });
    }

    if (table.rows.length === 0) return NextResponse.json({ error: "No contact rows were found in this file." }, { status: 400 });
    if (table.rows.length > MAX_ROWS) {
      return NextResponse.json({ error: `This file has ${table.rows.length.toLocaleString()} rows. Import at most ${MAX_ROWS.toLocaleString()} rows per file.` }, { status: 400 });
    }

    const markOptIn = String(form.get("marketingOptIn") || "") === "true";
    const audienceName = String(form.get("groupName") || "").trim();
    const { contacts, invalid: unreadable } = mapRowsToContacts(table, {
      groupName: audienceName,
      marketingOptIn: markOptIn,
    });

    if (contacts.length === 0) {
      const first = unreadable.slice(0, 5).map(item => `row ${item.row} (${item.value || "empty"})`).join(", ");
      return NextResponse.json(
        {
          error: `No usable phone numbers were found${first ? ` — check ${first}` : ""}. Each row needs an international number such as +923001234567.`,
        },
        { status: 400 }
      );
    }

    const result = await importContactRecords(
      contacts.map(contact => ({
        ...contact,
        marketingOptIn: markOptIn || Boolean(contact.marketingOptIn),
      })),
      contacts.map(contact => contact.row)
    );

    const audience = audienceName ? await attachContactsToAudience(audienceName, result.contactIds) : null;

    return NextResponse.json({
      rows: table.rows.length,
      created: result.created,
      skipped: result.skipped,
      duplicatesInFile: result.duplicatesInFile,
      invalid: result.invalid + unreadable.length,
      invalidSamples: [...unreadable, ...result.invalidSamples].slice(0, 8),
      audience: audience ? { id: audience.id, name: audience.name } : null,
      message: `Imported ${result.created} contact${result.created === 1 ? "" : "s"} from ${table.rows.length} row${table.rows.length === 1 ? "" : "s"}.`,
    });
  } catch (error) {
    return apiError(error);
  }
}

