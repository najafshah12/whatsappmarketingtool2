import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { WhatsAppAccount } from "@prisma/client";

export type GraphError = { message?: string; type?: string; code?: number; error_subcode?: number };
export class WhatsAppApiError extends Error {
  constructor(message: string, readonly status = 502, readonly graphCode?: number) {
    super(message);
    this.name = "WhatsAppApiError";
  }
}

export function graphVersion() {
  const value = process.env.WA_GRAPH_API_VERSION?.trim() || "v23.0";
  return value.startsWith("v") ? value : `v${value}`;
}

export function getMetaAppConfig() {
  return {
    appId: process.env.META_APP_ID?.trim() || "",
    configId: process.env.META_CONFIG_ID?.trim() || "",
    appSecret: process.env.META_APP_SECRET?.trim() || "",
    graphVersion: graphVersion(),
  };
}

/**
 * Placeholder values (for example "[SENSITIVE]") can end up in an environment
 * after a masked env pull is pushed back. Treat them as missing so the UI does
 * not advertise a broken one-click signup.
 */
export function isUsableMetaAppId(value: string) {
  return /^\d{5,}$/.test(value);
}

export function isUsableMetaAppSecret(value: string) {
  return value.length >= 20 && !value.toLowerCase().includes("sensitive");
}

function encryptionKey() {
  const secret = process.env.WA_TOKEN_ENCRYPTION_KEY?.trim() || process.env.AUTH_SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("Set WA_TOKEN_ENCRYPTION_KEY to a stable secret of at least 32 characters.");
  return createHash("sha256").update("ReachPulse WhatsApp token encryption v1\0").update(secret).digest();
}

export function encryptAccessToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptAccessToken(encrypted: string) {
  const [version, ivText, tagText, ciphertextText] = encrypted.split(".");
  if (version !== "v1" || !ivText || !tagText || !ciphertextText) throw new Error("Stored WhatsApp credential has an unsupported format.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
}

export async function graphRequest<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${path.replace(/^\//, "")}`);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  const raw = await response.text();
  let data: T & { error?: GraphError };
  try { data = JSON.parse(raw) as T & { error?: GraphError }; }
  catch { throw new WhatsAppApiError("Meta returned an unreadable response.", response.status); }
  if (!response.ok) {
    throw new WhatsAppApiError(data.error?.message || `Meta API request failed (${response.status}).`, response.status, data.error?.code);
  }
  return data;
}

export function accountAccessToken(account: Pick<WhatsAppAccount, "accessTokenEncrypted" | "phoneNumberId">) {
  if (account.accessTokenEncrypted) return decryptAccessToken(account.accessTokenEncrypted);
  if (process.env.WA_ACCESS_TOKEN && process.env.WA_PHONE_NUMBER_ID === account.phoneNumberId) return process.env.WA_ACCESS_TOKEN;
  throw new Error("Connect this WhatsApp account with Meta before using it.");
}

export function phoneForWhatsAppApi(phone: string) {
  return phone.replace(/\D/g, "");
}

export async function sendCloudMessage<T>(account: Pick<WhatsAppAccount, "accessTokenEncrypted" | "phoneNumberId">, payload: Record<string, unknown>) {
  if (!account.phoneNumberId) throw new Error("The sender is missing its WhatsApp phone number ID.");
  const accessToken = accountAccessToken(account);
  return graphRequest<T>(accessToken, `${encodeURIComponent(account.phoneNumberId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
}

export function metaWebhookSecret() {
  return process.env.WA_APP_SECRET?.trim() || process.env.META_APP_SECRET?.trim() || "";
}

/**
 * Exchanges a short-lived Meta user access token for a 60-day long-lived access token.
 * If the token is already a permanent system user token or page token, or if META_APP_SECRET is unset,
 * returns the original token.
 */
export async function exchangeForLongLivedToken(token: string): Promise<{ accessToken: string; expiresIn: number | null; isLongLived: boolean }> {
  const { appId, appSecret, graphVersion: version } = getMetaAppConfig();
  if (!appId || !appSecret) {
    console.warn("META_APP_ID or META_APP_SECRET not configured. Skipping 60-day token exchange.");
    return { accessToken: token, expiresIn: null, isLongLived: false };
  }

  try {
    const url = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
    url.searchParams.set("grant_type", "fb_exchange_token");
    url.searchParams.set("client_id", appId);
    url.searchParams.set("client_secret", appSecret);
    url.searchParams.set("fb_exchange_token", token);

    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json() as { access_token?: string; expires_in?: number; error?: GraphError };

    if (res.ok && data.access_token) {
      // 60 days in seconds is 5,184,000
      return {
        accessToken: data.access_token,
        expiresIn: data.expires_in ?? 5184000,
        isLongLived: true,
      };
    }

    console.warn("Meta long-lived token exchange notice:", data.error?.message || "Using provided token directly.");
  } catch (err) {
    console.warn("Error during token exchange request:", err instanceof Error ? err.message : err);
  }

  return { accessToken: token, expiresIn: null, isLongLived: false };
}

/**
 * Inspects a Meta token using the debug_token endpoint.
 * Detects whether token is valid, expiration date, and whether it's a permanent System User token.
 */
export async function inspectToken(token: string): Promise<{
  isValid: boolean;
  type?: string;
  expiresAt: Date | null;
  isPermanent: boolean;
  scopes?: string[];
  errorMessage?: string;
}> {
  const { appId, appSecret, graphVersion: version } = getMetaAppConfig();
  if (!appId || !appSecret) {
    return { isValid: true, expiresAt: null, isPermanent: false };
  }

  try {
    const appToken = `${appId}|${appSecret}`;
    const url = new URL(`https://graph.facebook.com/${version}/debug_token`);
    url.searchParams.set("input_token", token);
    url.searchParams.set("access_token", appToken);

    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json() as {
      data?: {
        is_valid?: boolean;
        type?: string;
        expires_at?: number;
        data_access_expires_at?: number;
        scopes?: string[];
        error?: { message?: string };
      };
    };

    if (data.data) {
      const d = data.data;
      const isValid = Boolean(d.is_valid);
      const isPermanent = d.expires_at === 0 || d.type === "SYSTEM_USER";
      const expiresAt = isPermanent || !d.expires_at ? null : new Date(d.expires_at * 1000);
      return {
        isValid,
        type: d.type,
        expiresAt,
        isPermanent,
        scopes: d.scopes,
        errorMessage: d.error?.message,
      };
    }
  } catch (err) {
    console.warn("debug_token check failed:", err instanceof Error ? err.message : err);
  }

  return { isValid: true, expiresAt: null, isPermanent: false };
}

/**
 * Verifies that the given access token has access to the specified WhatsApp Phone Number ID.
 */
export async function verifyWhatsAppPhoneNumber(accessToken: string, phoneNumberId: string) {
  return graphRequest<{ id: string; display_phone_number?: string; verified_name?: string; quality_rating?: string }>(
    accessToken,
    `${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number,verified_name,quality_rating`
  );
}

