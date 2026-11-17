/**
 * Client for the self-hosted WhatsApp bridge (the Baileys REST API in the
 * `whatsapp-crm-api` project).
 *
 * The bridge is a small Express server that keeps a WhatsApp Web session per
 * `sessionId` (account1, account2, ...). This module is the only place that
 * talks to it, so every route and the campaign sender share the same timeout,
 * error mapping and message rendering rules.
 */

import { prisma } from "@/lib/prisma";

export type BridgeSessionStatus = {
  sessionId: string;
  status: string;
  phone?: string | null;
};

export type BridgeSendResult = {
  status?: boolean;
  message?: string;
  sentFrom?: string;
  to?: string;
};

/** Error raised for any bridge failure, with the HTTP status the bridge returned. */
export class BridgeApiError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = "BridgeApiError";
  }
}

/**
 * Bridge location.
 *
 * A free Cloudflare quick tunnel changes its URL every time it is restarted or
 * revoked, and Vercel only applies environment changes on a new deployment. So
 * the live URL *and* the API key are also stored in the database: the tunnel
 * watchdog posts them to /api/bridge/url and the next request uses them — no
 * redeploy, no window where the dashboard points at a dead tunnel. The env vars
 * stay as the fallback for a fresh database or a manual override.
 */
const BRIDGE_URL_KEY = "bridge.url";
const BRIDGE_API_KEY_KEY = "bridge.key";
const SETTINGS_CACHE_MS = 10_000;
let cached: { base: string; key: string; at: number } | null = null;

function cleanUrl(value: string) {
  return (value || "").trim().replace(/\/+$/, "");
}

export function bridgeEnvUrl() {
  return cleanUrl(process.env.WA_BRIDGE_URL || "");
}

export function bridgeEnvKey() {
  return (process.env.WA_BRIDGE_API_KEY || "").trim();
}

export function invalidateBridgeUrlCache() {
  cached = null;
}

/** Stored settings first, environment second. Never throws. */
export async function bridgeConfig() {
  if (cached && Date.now() - cached.at < SETTINGS_CACHE_MS) {
    return { base: cached.base, key: cached.key, configured: cached.base.length > 0 && cached.key.length > 0 };
  }
  let base = bridgeEnvUrl();
  let key = bridgeEnvKey();
  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: [BRIDGE_URL_KEY, BRIDGE_API_KEY_KEY] } },
      select: { key: true, value: true },
    });
    const storedUrl = cleanUrl(rows.find(row => row.key === BRIDGE_URL_KEY)?.value || "");
    const storedKey = (rows.find(row => row.key === BRIDGE_API_KEY_KEY)?.value || "").trim();
    if (/^https?:\/\/[^\s]+$/i.test(storedUrl)) base = storedUrl;
    if (storedKey.length >= 8) key = storedKey;
  } catch {
    // Database hiccup: the environment fallback keeps the bridge reachable.
  }
  cached = { base, key, at: Date.now() };
  return { base, key, configured: base.length > 0 && key.length > 0 };
}

export async function bridgeBaseUrl() {
  return (await bridgeConfig()).base;
}

export { BRIDGE_URL_KEY, BRIDGE_API_KEY_KEY };


/**
 * Minimum gap between two bridge sends. WhatsApp bans numbers that receive
 * machine-speed bursts, so the campaign loop never goes faster than this even
 * when the campaign itself asks for a shorter interval.
 */
export function bridgeMinDelayMs() {
  const raw = Number(process.env.WA_BRIDGE_MIN_DELAY_MS ?? 20000);
  if (!Number.isFinite(raw) || raw < 5000) return 20000;
  return Math.min(raw, 120000);
}

async function bridgeRequest<T>(path: string, init: RequestInit = {}, timeoutMs = 25000): Promise<T> {
  const { base, key, configured } = await bridgeConfig();
  if (!configured) {
    throw new BridgeApiError("WhatsApp bridge is not configured. Set WA_BRIDGE_URL and WA_BRIDGE_API_KEY on the server.", 503);
  }
  const url = new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`);
  url.searchParams.set("apiKey", key);
  const headers = new Headers(init.headers);
  headers.set("x-api-key", key);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new BridgeApiError(
      timedOut ? "The WhatsApp bridge did not answer in time." : "Could not reach the WhatsApp bridge server. Check that the tunnel is running.",
      502
    );
  }

  const raw = await response.text();
  let data: (T & { status?: boolean; message?: string }) | null = null;
  try {
    data = raw ? JSON.parse(raw) as T & { status?: boolean; message?: string } : null;
  } catch {
    throw new BridgeApiError("The WhatsApp bridge returned an unreadable response.", 502);
  }
  if (!data) throw new BridgeApiError("The WhatsApp bridge returned an empty response.", 502);
  if (!response.ok || data.status === false) {
    throw new BridgeApiError(data.message || `WhatsApp bridge request failed (${response.status}).`, response.status || 502);
  }
  return data;
}

export async function bridgeSessions(timeoutMs = 15000) {
  const data = await bridgeRequest<{ status: boolean; totalConnected: number; accounts: BridgeSessionStatus[] }>("/sessions/status", {}, timeoutMs);
  return {
    totalConnected: data.totalConnected ?? 0,
    accounts: Array.isArray(data.accounts) ? data.accounts : [],
  };
}

export async function bridgeSession(sessionId: string) {
  const { accounts } = await bridgeSessions();
  return accounts.find(account => account.sessionId === sessionId) ?? null;
}

export function bridgeSend(input: { sessionId: string; number: string; message: string }) {
  return bridgeRequest<BridgeSendResult>("/send-message", { method: "POST", body: JSON.stringify(input) }, 20000);
}

export function bridgeQr(sessionId: string) {
  return bridgeRequest<{ status: string; qr: string | null; phone?: string | null }>(
    `/session/qr/${encodeURIComponent(sessionId)}`,
    {},
    15000
  );
}

/**
 * Asks the bridge to open a session so it starts emitting QR codes.
 * The bridge answers with an HTML page, so the body is intentionally ignored.
 */
export async function bridgeStartSession(sessionId: string) {
  const { base, key, configured } = await bridgeConfig();
  if (!configured) throw new BridgeApiError("WhatsApp bridge is not configured. Set WA_BRIDGE_URL and WA_BRIDGE_API_KEY on the server.", 503);
  const url = new URL(`${base}/session/add/${encodeURIComponent(sessionId)}`);
  url.searchParams.set("apiKey", key);
  try {
    await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) });
  } catch {
    // The next QR poll reports the real state; a slow page render is not fatal.
  }
}

/** Maps a bridge session status onto the statuses the dashboard already knows. */
export function bridgeAccountStatus(status: string): "connected" | "attention" | "disconnected" {
  if (status === "connected") return "connected";
  if (status === "qr_ready" || status === "connecting") return "attention";
  return "disconnected";
}

/**
 * Renders a template body / campaign message as plain text for the bridge.
 * Meta uses {{1}} name, {{2}} phone, {{3}} email; the named variants are
 * accepted too so hand-written campaigns keep working.
 */
export function renderBridgeMessage(body: string, contact: { name: string; phone: string; email?: string | null }) {
  const indexed = [contact.name, contact.phone, contact.email || ""];
  return body
    .replace(/\{\{\s*([1-9])\s*\}\}/g, (_match, index: string) => indexed[Number(index) - 1] ?? "")
    .replace(/\{\{\s*name\s*\}\}/gi, contact.name)
    .replace(/\{\{\s*phone\s*\}\}/gi, contact.phone)
    .replace(/\{\{\s*email\s*\}\}/gi, contact.email || "");
}

/** Strips formatting from the bridge's raw phone (923001234567). */
export function bridgePhone(raw?: string | null) {
  const digits = String(raw ?? "").replace(/\D/g, "").replace(/^00/, "");
  return digits.length >= 8 ? `+${digits}` : null;
}
