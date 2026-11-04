import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSessionToken, sessionCookieName, verifyPassword } from "@/lib/auth";

// Small in-process throttle. Serverless instances keep their own counters,
// so this slows down brute-force attempts per instance without a shared store.
// Kept short (5 minutes) so a mistyped password never locks the admin out for long.
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 5 * 60 * 1000;

function clientKey(req: Request, username: string) {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || req.headers.get("x-real-ip") || "local";
  return `${ip}|${username.trim().toLowerCase().slice(0, 80)}`;
}

function tooManyAttempts(key: string) {
  const entry = attempts.get(key);
  if (!entry) return null;
  if (entry.resetAt <= Date.now()) {
    attempts.delete(key);
    return null;
  }
  if (entry.count < MAX_ATTEMPTS) return null;
  return Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 60000));
}

function recordFailure(key: string) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count += 1;
  }
  if (attempts.size > 5000) {
    for (const [storedKey, stored] of attempts) {
      if (stored.resetAt <= now) attempts.delete(storedKey);
    }
  }
}

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json();
    if (typeof username !== "string" || typeof password !== "string") {
      return NextResponse.json({ error: "Enter your login ID and password." }, { status: 400 });
    }
    if (!username.trim() || !password || username.length > 80 || password.length > 200) {
      return NextResponse.json({ error: "Login ID or password is incorrect." }, { status: 401 });
    }

    const key = clientKey(req, username);
    const retryMinutes = tooManyAttempts(key);
    if (retryMinutes) {
      return NextResponse.json(
        { error: `Too many failed sign-in attempts. Try again in ${retryMinutes} minute${retryMinutes === 1 ? "" : "s"}.` },
        { status: 429 }
      );
    }

    const configuredUsername = process.env.ADMIN_USERNAME;
    const initialHash = process.env.ADMIN_PASSWORD_HASH;
    const savedHash = await prisma.setting.findUnique({ where: { key: "auth.password_hash" }, select: { value: true } });
    const passwordHash = savedHash?.value ?? initialHash;
    if (!configuredUsername || !passwordHash || !process.env.AUTH_SESSION_SECRET) {
      return NextResponse.json({ error: "Login is not configured on this server yet." }, { status: 503 });
    }

    const matches =
      username.trim().toLowerCase() === configuredUsername.trim().toLowerCase() &&
      (await verifyPassword(password, passwordHash));
    if (!matches) {
      recordFailure(key);
      return NextResponse.json({ error: "Login ID or password is incorrect." }, { status: 401 });
    }

    attempts.delete(key);
    const mustChangePassword = !savedHash;
    const response = NextResponse.json({ ok: true, mustChangePassword });
    response.cookies.set(sessionCookieName, createSessionToken(configuredUsername, mustChangePassword), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Could not sign in. Check the database connection and try again." }, { status: 503 });
  }
}
