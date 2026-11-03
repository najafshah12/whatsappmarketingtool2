import { NextResponse } from "next/server";
import { createSessionToken, currentSession, hashPassword, sessionCookieName, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  try {
    const { currentPassword, password } = await req.json();
    if (typeof password !== "string" || password.length < 12) return NextResponse.json({ error: "Choose a password with at least 12 characters." }, { status: 400 });
    const savedHash = await prisma.setting.findUnique({ where: { key: "auth.password_hash" }, select: { value: true } });
    const currentHash = savedHash?.value ?? process.env.ADMIN_PASSWORD_HASH;
    if (typeof currentPassword !== "string" || !currentHash || !await verifyPassword(currentPassword, currentHash)) return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
    if (savedHash?.value && await verifyPassword(password, savedHash.value)) return NextResponse.json({ error: "Choose a password you have not used before." }, { status: 400 });
    const passwordHash = await hashPassword(password);
    await prisma.setting.upsert({ where: { key: "auth.password_hash" }, create: { key: "auth.password_hash", value: passwordHash }, update: { value: passwordHash } });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(sessionCookieName, createSessionToken(session.username, false), {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 12,
    });
    return response;
  } catch { return NextResponse.json({ error: "Could not update the password." }, { status: 503 }); }
}
