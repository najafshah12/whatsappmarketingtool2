import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";

const scrypt = promisify(scryptCallback);
export const sessionCookieName = "wa_admin_session";
const sessionDurationSeconds = 60 * 60 * 12;

export type Session = { username: string; expiresAt: number; mustChangePassword: boolean };

function sessionSecret() {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SESSION_SECRET must contain at least 32 characters.");
  return secret;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("base64url")}:${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [algorithm, saltText, hashText] = stored.includes("$") ? stored.split("$") : stored.split(":");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;
  try {
    const expected = Buffer.from(hashText, "base64url");
    const actual = (await scrypt(password, Buffer.from(saltText, "base64url"), expected.length)) as Buffer;
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch { return false; }
}

export function hashVerificationCode(challengeId: string, code: string) {
  return createHmac("sha256", sessionSecret()).update(`${challengeId}.${code}`).digest("hex");
}

function sign(payload: string) {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export function createSessionToken(username: string, mustChangePassword: boolean) {
  const payload = Buffer.from(JSON.stringify({ username, mustChangePassword, expiresAt: Math.floor(Date.now() / 1000) + sessionDurationSeconds })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readSessionToken(token: string | undefined): Session | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const supplied = Buffer.from(signature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    return typeof session.username === "string" && Number.isFinite(session.expiresAt) && session.expiresAt > Date.now() / 1000 ? session : null;
  } catch { return null; }
}

export async function currentSession() {
  const jar = await cookies();
  return readSessionToken(jar.get(sessionCookieName)?.value);
}
