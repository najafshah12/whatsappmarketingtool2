import { NextRequest, NextResponse } from "next/server";

const cookieName = "wa_admin_session";
const publicPaths = new Set(["/login", "/api/auth/login", "/api/webhook", "/api/cron/campaigns"]);
const passwordPaths = new Set(["/account/password", "/api/auth/change-password", "/api/auth/logout"]);

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
}

async function readSession(token: string | undefined) {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret || secret.length < 32 || !token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, decodeBase64Url(signature), new TextEncoder().encode(payload));
    if (!valid) return null;
    const session = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
    if (typeof session.username !== "string" || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now() / 1000) return null;
    return session as { username: string; expiresAt: number; mustChangePassword: boolean };
  } catch { return null; }
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (publicPaths.has(path)) return NextResponse.next();
  const session = await readSession(request.cookies.get(cookieName)?.value);
  if (!session) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }
  if (session.mustChangePassword && path !== "/account/password" && !passwordPaths.has(path)) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Change the initial password to continue." }, { status: 403 });
    const passwordUrl = request.nextUrl.clone();
    passwordUrl.pathname = "/account/password";
    passwordUrl.search = "";
    return NextResponse.redirect(passwordUrl);
  }
  if (!session.mustChangePassword && path === "/account/password") return NextResponse.next();
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.).*)"] };
