import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Temporary recovery endpoint. Guarded by CRON_SECRET so it can only be used
 * by the operator. It reports non-secret environment shapes and, when a
 * password is supplied, rotates the stored admin password hash.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { password?: string; clear?: boolean };
  const password = typeof body.password === "string" ? body.password : "";
  if (password && password.length < 12) {
    return NextResponse.json({ error: "Password must contain at least 12 characters." }, { status: 400 });
  }

  const savedHash = await prisma.setting.findUnique({ where: { key: "auth.password_hash" } });

  if (password) {
    const hash = await hashPassword(password);
    await prisma.setting.upsert({
      where: { key: "auth.password_hash" },
      update: { value: hash, updatedAt: new Date() },
      create: { key: "auth.password_hash", value: hash },
    });
  } else if (body.clear) {
    await prisma.setting.deleteMany({ where: { key: "auth.password_hash" } });
  }

  const [contacts, accounts, campaigns, settings] = await Promise.all([
    prisma.contact.count(),
    prisma.whatsAppAccount.count(),
    prisma.campaign.count(),
    prisma.setting.count(),
  ]);

  return NextResponse.json({
    ok: true,
    rotated: Boolean(password),
    cleared: Boolean(body.clear && !password),
    hadStoredPassword: Boolean(savedHash),
    env: {
      graphVersion: process.env.WA_GRAPH_API_VERSION || "",
      metaAppIdLength: (process.env.META_APP_ID || "").trim().length,
      metaAppIdNumeric: /^\d{5,}$/.test((process.env.META_APP_ID || "").trim()),
      metaAppSecretLength: (process.env.META_APP_SECRET || "").trim().length,
      metaConfigIdPresent: Boolean(process.env.META_CONFIG_ID),
      sessionSecretLength: (process.env.AUTH_SESSION_SECRET || "").trim().length,
      encryptionKeyLength: (process.env.WA_TOKEN_ENCRYPTION_KEY || "").trim().length,
      adminUsername: process.env.ADMIN_USERNAME || "",
    },
    counts: { contacts, accounts, campaigns, settings },
  });
}
