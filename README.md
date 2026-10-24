# ConnectHub

A consent-first dashboard for **Phone Call** and **WhatsApp** campaigns. Both channels share contacts, media, campaign history, authentication, suppression and compliance, but each has its own provider adapter.

> **Nothing real is sent by default.** Every campaign runs against mock providers in **simulation mode**. Live delivery stays locked until three independent gates all pass (see [Safety model](#safety-model)).

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · shadcn/ui · Supabase (Postgres, Auth, Storage, RLS) · Vitest · Vercel

---

## Features

| Area | What it does |
| --- | --- |
| **Auth** | Supabase email/password sign-up and sign-in, session refresh in `src/proxy.ts`, every page and server action re-verifies the user. |
| **Contacts** | Search, tag and consent filters, bulk grant/revoke consent (with a required source), bulk tagging, delete. |
| **Smart import** | CSV, TSV, XLSX, XLS, ODS, or paste straight from Excel/Google Sheets. Detects columns from headers *and* content, lets you remap anything, normalises phones to E.164, validates emails/consent values, flags in-file and existing duplicates, and lets you download problem rows. The server re-validates every row. |
| **Media library** | Audio (calls), images and videos (WhatsApp headers), stored in a private bucket. Type, size and duration limits, in-browser previews through short-lived signed URLs. |
| **Phone Calls** | Draft → pick a tag segment → choose an audio file and caller ID → run in simulation or schedule. Each attempt records its outcome (answered, voicemail, no answer, busy, failed) and duration. |
| **WhatsApp** | Draft → segment → **approved template only** → map `{{1}}…` variables to contact fields or fixed text → attach an image/video header when the template needs one → live phone preview → simulate delivery (sent → delivered → read, or a Cloud-API-style error). |
| **Suppression list** | Per-channel or all-channel do-not-contact list with reason and optional expiry. Checked before every send, in both modes. |
| **Compliance** | Records per channel (provider approval, consent policy, DNC check, Meta business verification, template approval, live attestation) with pending/verified/rejected/expired states and a live-readiness checklist. |
| **Audit log** | Append-only log of sign-ins, imports, consent changes, media, campaign runs and compliance decisions. RLS forbids edits and deletes. |
| **Mode indicator** | A banner on every page, a badge on every campaign, recipient attempt and history row, and a confirmation dialog that says what will happen. |

---

## Safety model

Live delivery requires **all three** of these at once:

1. **Server flag:** `LIVE_VOICE_ENABLED=true` or `LIVE_WHATSAPP_ENABLED=true` (both default to `false`).
2. **A real provider adapter:** registered in `src/lib/providers/registry.ts` and selected with `VOICE_PROVIDER` / `WHATSAPP_PROVIDER`. **None ship with this repo**, so live mode can't work until you add one deliberately.
3. **Verified compliance records:** every required record type for that channel must be `verified` and unexpired.

The database enforces gate 3 on its own. A trigger (`campaigns_enforce_live_mode`) rejects any campaign saved with `mode = 'live'` unless `public.live_mode_ready()` passes, and another trigger stops a `live` delivery attempt from being written against a simulation campaign. Only an `owner` or `admin` can mark a record verified, and the database stamps who verified it and when.

Other guarantees:
- A contact is reached only with consent for **that channel**. Voice and WhatsApp consent are tracked separately.
- Suppression always wins over consent.
- WhatsApp uses template messages through a Business Platform provider interface. There is **no WhatsApp Web automation**.
- Campaigns are claimed atomically (`draft|scheduled → running`), so a double click or cron overlap can't send twice.
- Campaigns that have run can't be deleted, which keeps the audit trail intact.

---

## Project structure

```
supabase/
  migrations/
    20261022000100_core_schema.sql      tables, enums, indexes, profile trigger
    20261022000200_rls_and_guards.sql   RLS policies, privilege hardening, live-mode guard
    20261022000300_storage.sql          private `media` bucket + storage policies
  tests/rls-check.mjs                   runs migrations in PGlite and checks RLS/guards as two users
src/
  proxy.ts                              session refresh + auth redirect (Next 16 "proxy", formerly middleware)
  app/
    login/, auth/callback/, setup/      auth and first-run screens
    (app)/                              authenticated dashboard
      dashboard/ calls/ whatsapp/ contacts/ contacts/import/ media/
      history/ suppression/ compliance/ audit/
    api/cron/dispatch/                  runs due scheduled campaigns (Vercel Cron)
  components/
    campaigns/                          list, form, detail, actions, WhatsApp preview, readiness checklist
    ui/                                 shadcn/ui components
  lib/
    import/       fields, parse (CSV/XLSX/paste), detect (column mapping), validate, preview (dedupe/merge)
    providers/    types (VoiceProvider, WhatsAppProvider), voice/mock, whatsapp/mock, registry
    campaigns/    logic (eligibility, stats, templates), engine (server-side run + scheduling)
    compliance/   requirements (live-readiness rules), readiness (server)
    media/        upload rules and storage paths
    actions/      server actions (auth, contacts, imports, media, campaigns, compliance)
    supabase/     browser, server and service-role clients
tests/                                  Vitest suite (import, validation, campaigns, providers, media)
```

---

## Accounts you need

| Service | Needed for | Cost |
| --- | --- | --- |
| **Supabase** (supabase.com) | Database, auth, file storage | Free tier is enough |
| **GitHub** | Hosting the code | Free |
| **Vercel** (vercel.com) | Deployment | Free Hobby tier works (cron then runs once a day) |
| *Later, only to go live:* a voice provider (e.g. Twilio, Plivo, Exotel) | Real phone calls | Paid, needs business verification |
| *Later, only to go live:* Meta WhatsApp Business Platform (directly or through a BSP such as Twilio, Gupshup or 360dialog) | Real WhatsApp messages | Paid per conversation, needs Meta business verification and approved templates |

You don't need any provider account to run everything in simulation.

---

## 1. Set up Supabase

1. Go to **supabase.com → New project**. Pick a region close to your users and save the database password somewhere safe.
2. **Run the migrations.** Choose one option:
   - **SQL Editor (simplest):** open *SQL Editor → New query*, then paste and run each file in `supabase/migrations/` **in filename order** (`…0100_core_schema.sql`, then `…0200_rls_and_guards.sql`, then `…0300_storage.sql`).
   - **Supabase CLI:**
     ```bash
     npx supabase login
     ```
     ```bash
     npx supabase link --project-ref <your-project-ref>
     ```
     ```bash
     npx supabase db push
     ```
3. **Check storage.** *Storage* should now list a **private** bucket called `media` (50 MB limit, audio/image/video MIME types). The migration creates it along with four policies on `storage.objects`, which let each user read and write only inside their own `<user-id>/…` folder. If the bucket is missing, re-run `…0300_storage.sql`.
4. **Check RLS.** Under *Database → Tables*, every table should show **RLS enabled**. The policies give each user their own rows only; `audit_logs` and `delivery_attempts` are append-only.
5. **Configure auth URLs.** Under *Authentication → URL Configuration*:
   - **Site URL:** `http://localhost:3000` for now (change it to your Vercel URL later).
   - **Redirect URLs:** add `http://localhost:3000/auth/callback` and, after deploying, `https://<your-app>.vercel.app/auth/callback`.
6. **Email confirmation** is on by default, so new users must click the link in their inbox. For quick local testing you can turn off *Authentication → Providers → Email → Confirm email*. Supabase's built-in mailer is rate-limited, so add custom SMTP before real use.
7. **Copy your keys** from *Project Settings → API Keys*:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - Publishable key (`sb_publishable_…`) or legacy `anon` key → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - Secret key (`sb_secret_…`) or legacy `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`. This one is optional and used only by the cron. Never prefix it with `NEXT_PUBLIC_`.

## 2. Run locally

Requires Node.js 20.9 or newer.

```bash
npm install
```
```bash
cp .env.example .env.local
```

Fill in `.env.local` (see [Environment variables](#environment-variables)), then:

```bash
npm run dev
```

Open http://localhost:3000, create an account, and you'll land on the overview. If the Supabase variables are missing, the app sends you to `/setup` with instructions.

### Try the whole flow in simulation

1. **Contacts → Import.** Paste this into the *Paste from Excel* tab:
   ```
   Name	Mobile	Tags	Call consent	WhatsApp opt-in
   Asha Verma	98765 40001	vip	yes	yes
   Ravi Kumar	98765 40002	vip	yes	no
   Meera Shah	98765 40009	mumbai	no	yes
   Bad Row	123	vip	yes	yes
   ```
   The columns are detected automatically. One row is flagged invalid.
2. **Media library:** upload an MP3 for calls and a JPEG for WhatsApp.
3. **Phone Calls → New campaign:** choose tag `vip`, pick the MP3, *Create draft*, then *Run simulation*.
4. **WhatsApp → New campaign:** pick `seasonal_offer_image`, map `{{1}}` to *First name* and `{{2}}` to fixed text, pick the image, then save and run.
5. Look at the per-recipient outcomes, the **Campaign history**, and the **Audit log**.

**Mock outcomes are deterministic.** The same campaign and number always give the same result. Numbers ending in these digits force an outcome:

| Ending | Phone call | WhatsApp |
| --- | --- | --- |
| `0001` | answered | read |
| `0002` | no answer | delivered |
| `0003` | busy | sent |
| `0004` | voicemail | (random) |
| `0009` | failed | failed |

---

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | **yes** | | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **yes** | | Publishable or anon key (`NEXT_PUBLIC_SUPABASE_ANON_KEY` also works) |
| `NEXT_PUBLIC_SITE_URL` | recommended | request origin | Base URL for email confirmation links |
| `NEXT_PUBLIC_DEFAULT_PHONE_COUNTRY` | no | `IN` | ISO country used to read local-format numbers |
| `SUPABASE_SERVICE_ROLE_KEY` | for cron | | Lets `/api/cron/dispatch` run due campaigns for all users (bypasses RLS, server only) |
| `CRON_SECRET` | for cron | | Bearer token for the cron route. Vercel sends it automatically. |
| `LIVE_VOICE_ENABLED` | no | `false` | Gate 1 for live calls |
| `LIVE_WHATSAPP_ENABLED` | no | `false` | Gate 1 for live WhatsApp |
| `VOICE_PROVIDER` | no | `mock` | Which registered voice adapter live mode uses |
| `WHATSAPP_PROVIDER` | no | `mock` | Which registered WhatsApp adapter live mode uses |

---

## Tests

```bash
npm test
```
123 Vitest tests cover:
- **Import:** CSV/TSV/paste/XLSX parsing, header and content-based column detection, phone/email/consent validation, in-file and existing duplicates, and merge rules.
- **Campaign engine** (`tests/engine.test.ts`, against an in-memory Supabase fake in `tests/helpers/`): audience snapshots, consent and suppression skips, per-recipient attempts, atomic claiming (two simultaneous runs send once), failure handling, WhatsApp template variables and header media, scheduled dispatch, and live mode staying locked even with the env flag on.
- **Server actions** (`tests/actions.test.ts`): import chunks with skip/update strategies and consent attestation, contacts, suppression, and campaign save/delete rules.
- **Rules:** eligibility, template rendering, the live-readiness gate, the provider registry, both mock providers and media rules.

```bash
npm run test:db
```
Applies every migration to an in-memory Postgres (PGlite) with stand-ins for Supabase's `auth` and `storage` schemas, then runs about 40 checks as two different users: cross-tenant isolation, the live-mode trigger, append-only audit logs, immutable delivery attempts, role escalation and storage folder isolation.

Also available: `npm run typecheck`, `npm run lint` and `npm run build`.

---

## Deploy to Vercel

1. Push this repo to GitHub (already done if you're reading this there).
2. In Vercel: **Add New → Project → Import** the `ConnectHub` repo. The framework is detected as Next.js, so keep the defaults.
3. Under **Environment Variables**, add at least `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `NEXT_PUBLIC_SITE_URL=https://<your-app>.vercel.app`. For scheduled campaigns, also add `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` (generate one with `openssl rand -hex 32`). **Leave the `LIVE_*` flags unset or `false`.**
4. Click **Deploy**.
5. Back in Supabase *Authentication → URL Configuration*, set the **Site URL** to your Vercel URL and add `https://<your-app>.vercel.app/auth/callback` to the redirect URLs.

**Scheduled campaigns:** `vercel.json` registers a daily cron (`0 9 * * *` UTC) that calls `/api/cron/dispatch`, because the Hobby plan only allows daily crons. On Pro you can change it to `*/5 * * * *`. You can also run due campaigns at any time with **Run due now** on the Phone Calls or WhatsApp page.

---

## Going live (when you're ready)

1. Get approval from your provider for your use case, and complete Meta business verification for WhatsApp.
2. Implement the interface in `src/lib/providers/types.ts`:
   - Voice: `VoiceProvider.placeCall()`, for example a Twilio `calls.create` that plays `audioUrl`.
   - WhatsApp: `WhatsAppProvider.listTemplates()` and `sendTemplate()` against the WhatsApp Cloud API (`/{phone-number-id}/messages`, `type: "template"`).
3. Register a factory in `src/lib/providers/registry.ts` (`liveVoiceAdapters` / `liveWhatsAppAdapters`), and keep provider credentials in server-only env vars.
4. Add a webhook route for delivery receipts and inbound **STOP** replies that writes to `suppression_records`.
5. Under **Compliance**, add and verify every required record for the channel.
6. Set `VOICE_PROVIDER` / `WHATSAPP_PROVIDER` to the adapter id and `LIVE_*_ENABLED=true`, then redeploy.
7. Campaigns can now be saved in live mode. The run button turns red and asks for an explicit confirmation.

Local rules (TRAI DND/DLT in India, TCPA/FTC DNC in the US, GDPR/PECR in the EU and UK) apply to you as the sender. The compliance records here help you track evidence. They are not legal advice.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Redirected to `/setup` | `NEXT_PUBLIC_SUPABASE_URL` / `…PUBLISHABLE_KEY` are missing. Restart `npm run dev` after editing `.env.local`. |
| "Can't reach Supabase" on sign-in | Wrong project URL, or the project is paused (free projects pause after inactivity). |
| Page says the database tables were not found | The migrations haven't been run, so run all three in order. |
| Upload fails with a policy error | `…0300_storage.sql` wasn't run, or the bucket isn't named `media`. |
| Sign-up email link goes to the wrong host | Fix the Site URL and Redirect URLs in Supabase Auth settings, and `NEXT_PUBLIC_SITE_URL`. |
| Excel phone numbers look like `9.19877E+11` | Format the column as **Text** in Excel before saving. The importer flags these rows rather than guessing. |
