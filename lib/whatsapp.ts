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
