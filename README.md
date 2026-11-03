# ReachPulse

ReachPulse is a WhatsApp Business campaign workspace built with Next.js, React, TypeScript, Prisma, and PostgreSQL.

## Working modules

- Dashboard metrics and campaign history are read from PostgreSQL.
- Inbox stores signed WhatsApp webhooks, delivery updates, and inbound replies. Free-text replies are sent through the matching sender during the 24-hour customer-service window.
- Accounts connect WhatsApp Business numbers with Meta Embedded Signup. Access tokens are encrypted at rest and never returned by account APIs.
- Campaign Designer creates message-template drafts, submits them to Meta, and refreshes provider approval status.
- Audience Pool supports contact entry, CSV import, audience lists, explicit marketing opt-in, and opt-out. Incoming `STOP`, `UNSUBSCRIBE`, `CANCEL`, `END`, and `QUIT` requests disable marketing sends.
- Create Campaign makes drafts or schedules. Only contacts with recorded opt-in and without an opt-out are queued. A scheduled campaign requires a Meta-approved template and the connected sender that owns it.
- Sending uses the official WhatsApp Cloud API, processes small batches, and records provider message IDs, errors, and delivery events.

The app never marks a template approved by itself, and it does not send marketing campaigns to imported contacts unless the CSV explicitly includes a consent value. Use only numbers you own and contacts who agreed to receive messages.

## Requirements and local startup

- Node.js 20+
- pnpm
- PostgreSQL 16+ (or Docker Compose)

1. Run `pnpm install`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` and `DATABASE_URL_UNPOOLED`.
3. Start PostgreSQL with `docker compose up -d postgres` or use another PostgreSQL server.
4. Apply migrations and generate Prisma Client: `pnpm exec prisma migrate deploy` and `pnpm run prisma:generate`.
5. Start the app with `pnpm run dev` and open `http://localhost:3000`.

## Meta / WhatsApp setup

Create and configure a Meta developer app with WhatsApp Business Platform and Embedded Signup. Set these server-side variables in Vercel or `.env`:

- `META_APP_ID`: Meta developer app ID.
- `META_CONFIG_ID`: the Embedded Signup configuration ID.
- `META_APP_SECRET`: private Meta app secret; also used to verify webhook signatures.
- `WA_WEBHOOK_VERIFY_TOKEN`: a private value entered in the Meta webhook configuration.
- `WA_TOKEN_ENCRYPTION_KEY`: a private random value of at least 32 characters. If omitted, token encryption derives a key from `AUTH_SESSION_SECRET`; keep that secret stable or previously connected tokens cannot be decrypted.
- `WA_GRAPH_API_VERSION`: optional Graph API version; defaults to `v23.0`.

Then:

1. Open **Accounts → Connect with Meta** and complete the Meta business / number flow.
2. In the Meta app, set the callback URL to `https://your-domain/api/webhook`, enter the same verify token, and subscribe to WhatsApp message and message-status fields. The server verifies `X-Hub-Signature-256` with the Meta app secret.
3. Create a draft under **Campaign Designer** and submit it using the connected business sender. Wait for Meta to approve it; refresh the provider status from the draft card.
4. Import or add audience contacts with documented opt-in. Create a campaign with the approved template and its sender, then use **Send next batch** or schedule it.

Meta app review, business verification, permissions, template approval, and sender eligibility remain controlled by Meta. The deployment currently has no Meta app credentials configured, so live signup/sends stay disabled until the owner adds them in Vercel.

## Contacts CSV

Required columns: `name,phone`. Optional columns: `email,groupName,tags,marketingOptIn,optedOut`. Phones must use international format, e.g. `+14155550123`. Mark consent with `true` or `yes` only when permission was recorded; tags use `|` between values. Duplicate phone numbers are skipped. Opt-out always overrides opt-in.

## Scheduled campaigns

The protected endpoint is `GET /api/cron/campaigns`; set a private `CRON_SECRET` of at least 32 characters in the Production environment and redeploy. Vercel sends it as `Authorization: Bearer <CRON_SECRET>`. Without this variable, the cron endpoint stays locked and scheduled sends do not run. This project is on Vercel Hobby, so `vercel.json` schedules the sender once daily at 00:00 UTC and campaigns may be delayed by up to a day. Use the manual **Send next batch** action for immediate progress. More frequent schedules require a Vercel plan that supports a higher cron frequency or an external scheduler calling this protected endpoint.

## Admin login and deployment

The app uses a single-admin username and password. Set `ADMIN_USERNAME`, a scrypt `ADMIN_PASSWORD_HASH`, and a private `AUTH_SESSION_SECRET` (at least 32 characters). Change the initial password after signing in. For local setup, run `pnpm run auth:setup-local`; to generate a deployment hash, run `pnpm run auth:hash-password`. Never put plain passwords or provider secrets in Git.

Set `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in the deployment environment. Apply database migrations with `pnpm exec prisma migrate deploy` before deploying schema-dependent code. Build with `pnpm run build` and serve with `pnpm run start`.
