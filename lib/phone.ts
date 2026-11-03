/**
 * Normalizes a phone number into E.164 format ("+" followed by 8-15 digits).
 * Returns null when the input cannot be a valid international number.
 *
 * Storing every number in one canonical shape keeps contact lookups,
 * opt-out webhooks and campaign sends consistent.
 */
export function normalizePhone(input: string): string | null {
  const digits = String(input).replace(/\D/g, "").replace(/^00/, "");
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return `+${digits}`;
}
