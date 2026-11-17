#!/usr/bin/env node
/**
 * Campaign worker
 *
 * Vercel's free (Hobby) cron runs only once a day, so a campaign that is
 * already started would otherwise stop as soon as you close the dashboard.
 * This little script runs on your own PC (the same one as the WhatsApp bridge),
 * calls the app's campaign tick every few seconds, and the app keeps sending at
 * the delay you configured — one message per connected number in a loop.
 *
 * Setup (once):
 *   1. Vercel → Project → Settings → Environment Variables → add WORKER_SECRET
 *      (any 32+ character random string) for Production (and Preview).
 *   2. Create `.env.worker` in the project root:
 *          WORKER_SECRET=<the same value>
 *          APP_URL=https://whatsappmarketingtool-main.vercel.app
 *
 * Run:
 *   node scripts/campaign-worker.mjs
 *
 * Options (environment variables):
 *   WORKER_EVERY_SECONDS   seconds between ticks (default 25, minimum 10)
 *   WORKER_SECRET          falls back to .env.worker
 *   APP_URL                falls back to .env.worker, then the production URL
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readEnvFile(file) {
  if (!existsSync(file)) return {};
  const values = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

const fileEnv = { ...readEnvFile(join(root, ".env.worker")), ...readEnvFile(join(root, ".env.local")) };
const appUrl = (process.env.APP_URL || fileEnv.APP_URL || "https://whatsappmarketingtool-main.vercel.app").replace(/\/+$/, "");
const secret = (process.env.WORKER_SECRET || fileEnv.WORKER_SECRET || "").trim();
const everySeconds = Math.max(10, Number(process.env.WORKER_EVERY_SECONDS || 25) || 25);

if (secret.length < 24) {
  console.error("WORKER_SECRET is missing (or too short). Add it to .env.worker, e.g.");
  console.error("  WORKER_SECRET=<32+ random characters>");
  process.exit(1);
}

const stamp = () => new Date().toLocaleTimeString();
let running = true;
let totals = { sent: 0, failed: 0 };

process.on("SIGINT", () => {
  running = false;
  console.log(`\n[${stamp()}] Stopping after this tick. Total sent: ${totals.sent}, failed: ${totals.failed}.`);
});

async function tick() {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${appUrl}/api/cron/campaigns`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(75_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.log(`[${stamp()}] HTTP ${response.status}: ${body.error || "request failed"}`);
      return;
    }
    const results = Array.isArray(body.results) ? body.results : [];
    if (results.length === 0) {
      console.log(`[${stamp()}] idle - no campaign is running or due`);
      return;
    }
    for (const result of results) {
      if (result.error) {
        console.log(`[${stamp()}] ${result.campaignId}: ${result.error}`);
        continue;
      }
      totals.sent += result.sent || 0;
      totals.failed += result.failed || 0;
      console.log(
        `[${stamp()}] ${result.campaignId}: sent ${result.sent || 0}, failed ${result.failed || 0}, ` +
        `${result.remaining || 0} left (${result.status}${result.batches ? `, ${result.batches} batches` : ""})`
      );
    }
  } catch (error) {
    console.log(`[${stamp()}] ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // Keep a steady rhythm even when a tick used its full 50s budget.
    const waitMs = Math.max(1000, everySeconds * 1000 - (Date.now() - startedAt));
    if (running) await new Promise(resolve => setTimeout(resolve, waitMs));
  }
}

console.log(`Campaign worker -> ${appUrl}`);
console.log(`Tick every ${everySeconds}s. Press Ctrl+C to stop.\n`);

while (running) await tick();
