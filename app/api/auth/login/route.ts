import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSessionToken, sessionCookieName, verifyPassword } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json();
    if (typeof username !== "string" || typeof password !== "string") return NextResponse.json({ error: "Enter your login ID and password." }, { status: 400 });
    const configuredUsername = process.env.ADMIN_USERNAME;
    const initialHash = process.env.ADMIN_PASSWORD_HASH;
    const savedHash = await prisma.setting.findUnique({ where: { key: "auth.password_hash" }, select: { value: true } });
    const passwordHash = savedHash?.value ?? initialHash;
    if (!configuredUsername || !passwordHash || !process.env.AUTH_SESSION_SECRET) return NextResponse.json({ error: "Login is not configured on this server yet." }, { status: 503 });
    const matches = username.trim().toLowerCase() === configuredUsername.trim().toLowerCase() && await verifyPassword(password, passwordHash);
    if (!matches) return NextResponse.json({ error: "Login ID or password is incorrect." }, { status: 401 });
    const mustChangePassword = !savedHash;
    const response = NextResponse.json({ ok: true, mustChangePassword });
    response.cookies.set(sessionCookieName, createSessionToken(configuredUsername, mustChangePassword), {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 12,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Could not sign in. Check the database connection and try again." }, { status: 503 });
  }
}
