# QR (Baileys) senders — setup & how the integration works

This build adds a second sending channel next to the Meta Cloud API:

| | Meta sender | QR sender (this build) |
|---|---|---|
| Auth | Long-lived access token | WhatsApp QR scan (Baileys session) |
| Message type | Approved template | Plain text (template body rendered) |
| Approval needed | Yes, Meta review | No |
| 24-hour window | Yes | No |
| Cost per message | Meta conversation pricing | Free (WhatsApp Web session) |
| Ban risk | Low | **Real** — bulk bursts get numbers banned |

Meta support is untouched: existing token senders keep working exactly as before.

---

## 1. Server env

Add these in Vercel → Project → Settings → Environment Variables (Production **and** Preview):

```
WA_BRIDGE_URL=https://your-tunnel-or-vps-url
WA_BRIDGE_API_KEY=<the bridge's API_SECRET_KEY>
WA_BRIDGE_MIN_DELAY_MS=20000
```

`WA_BRIDGE_URL` must be reachable from Vercel (public HTTPS). The API key is only
used server-side; the browser never sees it (the QR image is proxied through
`/api/accounts/[id]/qr`).

Changing an env var does **not** reach a deployment that already exists — redeploy
after editing it.

### Tunnel dropped? One command fixes it

Cloudflare quick tunnels have no uptime guarantee; they can be revoked after a few
hours and the app then reports *"Could not reach the WhatsApp bridge server"*. Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bridge-up.ps1
```

It starts the bridge if needed, creates a fresh tunnel, verifies it, updates
`WA_BRIDGE_URL` / `WA_BRIDGE_API_KEY` in Vercel (Production + Preview) and
redeploys production. `GET /api/health` then shows `bridge: configured` and
`bridgeReachable: yes`.

Quick tunnels are fine for testing. For a stable URL, create a *named* tunnel in
your Cloudflare account (free) and point `WA_BRIDGE_URL` at that hostname once.

## 2. Database

```bash
npx prisma migrate deploy     # production
npx prisma migrate dev        # local
```

Migration `20261116090000_bridge_provider` adds `provider` (`meta` | `bridge`) and
`bridgeSessionId` to `WhatsAppAccount`.

## 3. Connect a number

1. Accounts → **Add QR Sender (Baileys)**.
2. Name, the WhatsApp number, and a session name (`account1`, `account2`, …).
3. The QR panel opens and refreshes every 3 seconds.
4. Phone: WhatsApp → Linked Devices → Link a Device.
5. The panel flips to "Connected" and the card shows **qr connected**. The number
   is read from the bridge and saved on the account.

One session name per number. The bridge keeps the session on disk, so it survives
restarts; deleting the session folder, logging out from the phone, or losing the
phone's WhatsApp login requires a fresh QR scan.

## 4. Sending

- Campaign → pick the QR sender(s) under **Assigned accounts** (rotate senders
  works for QR senders too).
- The template body is rendered as text: `{{1}}` name, `{{2}}` phone, `{{3}}`
  email (named `{{name}}`, `{{phone}}`, `{{email}}` also work).
- If the campaign has no template, the campaign note/message is sent as-is.
- QR sends are never faster than `WA_BRIDGE_MIN_DELAY_MS` (default 20s) plus up to
  30% jitter, even if the campaign interval is shorter.

### Statuses written per message

| Bridge answer | `Message.status` | Notes |
|---|---|---|
| 200 | `sent` | `providerId` stays empty; `MessageEvent.payload.provider = "bridge"` |
| 404 (number not on WhatsApp) | `failed` | event `invalid`, never retried |
| 400 (sender not connected) | back to `queued` | next batch tries again |
| 401 (bad API key) | `failed` + batch aborts | fix `WA_BRIDGE_API_KEY` |
| timeout / 5xx | `failed` | operator can re-queue |

Delivery/read receipts and inbound inbox messages are Meta-webhook features and
stay Meta-only. The bridge returns `sent` only.

## 5. Serverless time limits (important)

Vercel functions have a 60s ceiling, and QR sends need 20s+ gaps. Batches
therefore send as many messages as fit in ~48s and leave the rest `queued`:

- Manual "Send next batch" sends 2–3 QR messages per click.
- Scheduled campaigns continue through `/api/cron/campaigns` (Hobby = once a day).

For a real bulk run (300+ / day across 5 numbers) put the app on a VPS, or run the
campaign loop worker next to the bridge. `sendCampaignBatch(id, size, { deadline })`
already accepts a deadline, so a worker can call it repeatedly.

## 6. Ban safety

The defaults are deliberately slow. If you shorten the delay, raise volume or
reuse identical text for thousands of numbers, expect the number to be banned —
WhatsApp does not allow bulk messaging from a personal/WhatsApp Web session.

- 3–4 message variants, rotated per recipient.
- Warm up: ~50–100/day on a new number, 300–500/day max afterwards.
- Honour opt-outs (`optedOut` already blocks sends).
- Keep `marketingOptIn` accurate — the campaign loop only sends to opted-in contacts.
