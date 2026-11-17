import { timingSafeEqual } from "node:crypto";

/**
 * Shared bearer-token check for machine callers.
 *
 * CRON_SECRET is used by Vercel Cron; WORKER_SECRET lets the local PC (campaign
 * worker, tunnel watchdog) authenticate against the deployed app. Either secret
 * is accepted, so rotating one of them never locks the stack out.
 */
export function workerAuthorized(req: Request) {
  const supplied = req.headers.get("authorization") || "";
  const secrets = [process.env.CRON_SECRET, process.env.WORKER_SECRET]
    .map(secret => (secret || "").trim())
    .filter(secret => secret.length >= 24);
  const a = Buffer.from(supplied);
  return secrets.some(secret => {
    const b = Buffer.from(`Bearer ${secret}`);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}
