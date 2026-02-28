# Cold Email Platform (Opt-in Only)

This project is a compliant outbound email platform designed for opt-in audiences. It supports:

- Multiple Mailgun mailboxes/domains with rotation
- Per-domain and per-mailbox daily limits with warmup
- Sequences and enrollments
- Delivery tracking (open/click)
- Bounce handling + suppression
- One-click unsubscribe (CAN-SPAM/GDPR aligned)

## Tech stack
- Node.js + TypeScript + Express
- Postgres (Prisma)
- Redis + BullMQ

## Quick start
Requires Node.js 20+.
1) Copy env:
```
cp .env.example .env
```
2) Install dependencies:
```
npm install
```
3) Run migrations:
```
npm run prisma:migrate
```
4) Start API and worker:
```
npm run dev
npm run worker
```
Optional scheduler (auto-dispatch every minute):
```
npm run scheduler
```
Open the UI at `http://localhost:3000` and paste your admin token.
5) Trigger dispatch manually (or via cron):
```
npm run dispatch
```

## Admin API
All admin routes require the `x-admin-token` header matching `ADMIN_TOKEN`.

### Create domain
```
POST /admin/domains
{
  "domain": "example.com",
  "dailyLimit": 200
}
```

### Create mailbox (Mailgun)
```
POST /admin/mailboxes
{
  "name": "mg-1",
  "domain": "example.com",
  "apiKey": "key-...",
  "fromName": "Your Name",
  "fromEmail": "you@example.com"
}
```

### Create sequence + steps
```
POST /admin/sequences
{ "name": "Welcome", "status": "active" }
```
```
POST /admin/sequences/:id/steps
{
  "stepNumber": 1,
  "subjectTemplate": "Hi {{firstName}}",
  "bodyTemplate": "Hello {{firstName}}, ..."
}
```

### Enroll a contact
```
POST /admin/enrollments
{ "sequenceId": "...", "contactId": "..." }
```

### Dispatch jobs
```
POST /admin/dispatch
```

## Webhooks
- Mailgun: `POST /webhooks/mailgun` (optionally validate with `MAILGUN_WEBHOOK_SIGNING_KEY`).

## Tracking
- Open tracking pixel: `/track/open/:token.png`
- Click redirect: `/track/click/:token?u=...`

## Timezone send windows
Send windows are enforced in the contact's timezone (if set). If not set, UTC is used. Set `sequence.timezonePolicy` to `utc` to force UTC.

## Compliance notes
- Only send to opted-in recipients.
- Unsubscribe is enforced with a one-click link and suppression list.
- Bounce/complaint events add recipients to suppression.

## Deployment
Render works well for API + worker + scheduler + Postgres + Redis. Netlify can host the frontend.

### Render
- Use `render.yaml` for web + worker + scheduler services.
- Ensure env vars: `DATABASE_URL`, `REDIS_URL`, `ADMIN_TOKEN`, `PUBLIC_BASE_URL`, `MAILGUN_WEBHOOK_SIGNING_KEY`, `UNSUBSCRIBE_SECRET`.
- Run `prisma migrate deploy` in your Render build or a release step.

### Netlify
- Deploy the `frontend` folder as a static site.
- Set the API base in `frontend/config.js` to your Render URL.

## Frontend UI
The UI is a static app served by the API. Use it to manage domains, mailboxes, contacts, lists, sequences, enrollments, and dispatch.
