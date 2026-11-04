import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { normalizePhone } from "@/lib/phone";

const schema = z.object({
  name: z.string().trim().max(100).optional().default(""),
  phone: z.preprocess(
    value => typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value,
    z.string().trim().min(1).max(32)
  ),
  email: z.string().email().optional().or(z.literal("")),
  groupName: z.string().max(100).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  marketingOptIn: z.boolean().default(false),
});
const deleteSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(500) });

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get("q") ?? "";
    const contacts = await prisma.contact.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
              { email: { contains: q, mode: "insensitive" } },
            ],
          }
        : {},
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return NextResponse.json(contacts);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const body = schema.parse(await req.json());
    const phone = normalizePhone(body.phone);
    if (!phone) {
      return NextResponse.json(
        { error: "Enter a valid international phone number, for example +14155550123." },
        { status: 400 }
      );
    }

    const existing = await prisma.contact.findUnique({ where: { phone }, select: { id: true } });
    if (existing) {
      return NextResponse.json({ error: `${phone} is already saved as a contact.` }, { status: 409 });
    }

    const optIn = body.marketingOptIn;
    const contact = await prisma.contact.create({
      data: {
        ...body,
        name: body.name || "User 1",
        phone,
        email: body.email || null,
        marketingOptIn: optIn,
        marketingOptInAt: optIn ? new Date() : null,
        marketingOptInSource: optIn ? "admin-confirmed-entry" : null,
      },
    });
    await prisma.auditLog.create({
      data: { action: "contact.created", entity: "contact", entityId: contact.id, detail: { marketingOptIn: optIn } },
    });
    return NextResponse.json(contact, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid contact" }, { status: 400 });
    }
    return apiError(error);
  }
}

export async function DELETE(req: Request) {
  try {
    const { ids: requestedIds } = deleteSchema.parse(await req.json());
    const ids = [...new Set(requestedIds)];
    const result = await prisma.$transaction(async tx => {
      const existing = await tx.contact.count({ where: { id: { in: ids } } });
      const deleted = await tx.contact.deleteMany({
        where: { id: { in: ids }, messages: { none: {} } },
      });
      const skippedWithHistory = Math.max(0, existing - deleted.count);
      if (deleted.count) {
        await tx.auditLog.create({
          data: {
            action: "contacts.deleted",
            entity: "contact",
            detail: { deleted: deleted.count, skippedWithHistory },
          },
        });
      }
      return { deleted: deleted.count, skippedWithHistory };
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Choose contacts to delete." }, { status: 400 });
    }
    return apiError(error);
  }
}

