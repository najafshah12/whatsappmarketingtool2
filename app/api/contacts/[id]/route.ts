import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { normalizePhone } from "@/lib/phone";

const schema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  phone: z.string().trim().min(1).max(32).optional(),
  email: z.string().email().or(z.literal("")).nullable().optional(),
  groupName: z.string().max(100).nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  optedOut: z.boolean().optional(),
  marketingOptIn: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const data = schema.parse(await req.json());

    let phone: string | undefined;
    if (data.phone !== undefined) {
      const normalized = normalizePhone(data.phone);
      if (!normalized) {
        return NextResponse.json(
          { error: "Enter a valid international phone number, for example +14155550123." },
          { status: 400 }
        );
      }
      phone = normalized;
    }

    // Opt-out always wins over a marketing opt-in.
    let optedOut = data.optedOut;
    let marketingOptIn = data.marketingOptIn;
    if (optedOut === true) marketingOptIn = false;
    if (marketingOptIn === true) optedOut = false;

    const update: Record<string, unknown> = {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(phone ? { phone } : {}),
      ...(data.email !== undefined ? { email: data.email === "" ? null : data.email } : {}),
      ...(data.groupName !== undefined ? { groupName: data.groupName } : {}),
      ...(data.tags !== undefined ? { tags: data.tags } : {}),
      ...(optedOut !== undefined ? { optedOut } : {}),
      ...(marketingOptIn !== undefined ? { marketingOptIn } : {}),
    };

    if (marketingOptIn === true) {
      update.marketingOptInAt = new Date();
      update.marketingOptInSource = "admin-confirmed-update";
    }
    if (marketingOptIn === false || optedOut === true) {
      update.marketingOptInAt = null;
      update.marketingOptInSource = null;
    }

    const contact = await prisma.contact.update({ where: { id }, data: update });
    await prisma.auditLog.create({
      data: {
        action: optedOut === true ? "contact.opted_out" : "contact.updated",
        entity: "contact",
        entityId: id,
        detail: { marketingOptIn: contact.marketingOptIn, optedOut: contact.optedOut },
      },
    });
    return NextResponse.json(contact);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid contact update." }, { status: 400 });
    }
    return apiError(error);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await prisma.contact.delete({ where: { id } });
    await prisma.auditLog.create({ data: { action: "contact.deleted", entity: "contact", entityId: id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
