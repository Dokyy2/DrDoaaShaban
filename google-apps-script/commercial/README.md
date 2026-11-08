# Separate Sheet-first Apps Script deployment

`Code.gs` is a new deployment for the commercial edition. It is separate from the v2.7.0 Apps Script project. Do not paste it over the live script or reuse that deployment URL.

## What the bridge does

- Writes new patient bookings and duplicate alerts to the Sheet before attempting Supabase projection.
- Resolves the header row and columns by normalized aliases, then appends any missing integration columns at the end. The clinic's appointment sheet has headers on row 1; contacts and birth sheets have a merged title on row 1 and headers on row 2. Column 8 of `Sheet1` remains `الساعة`, never `Status`.
- Accepts staff mutations only after validating the Supabase access token and reading that user's `profiles.role` server-side.
- Requires the doctor role for settings, private notes, expenses, and attachment retrieval.
- Stages each action in a retryable workbook outbox, applies the canonical Sheet action idempotently, then projects to Supabase. A 10-minute trigger retries staged actions and pending projections.
- Saves uploaded documents to a private Drive folder and stores its file ID in the Sheet; it serves attachment contents only to a verified doctor.
- Keeps the visitor counter on short-lived random IDs in Apps Script properties; it does not record visitor names or IP addresses.
- Stamps payment recorder identity and time on the server from the authenticated staff profile; client-supplied attribution fields are ignored.
- The public health endpoint returns readiness booleans only; it confirms required Script Properties and the retry trigger without returning property values.

## Script Properties

Create a new Apps Script project and add these properties under **Project Settings → Script Properties**. Values are intentionally not in source control.

| Property | Value |
|---|---|
| `WORKBOOK_ID` | ID of the approved clinic workbook |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key used to validate staff sessions |
| `SUPABASE_SECRET_KEY` | Server-only `sb_secret_...` key; sent via the `apikey` header only, never put it in browser config or GitHub |
| `ATTACHMENTS_FOLDER_ID` | ID of a private Drive folder for uploaded documents |
| `NOTIFICATION_EMAIL` | One approved clinic recipient, configured privately by the owner |

Only the project owner should be an Apps Script editor. The Drive folder should be private and shared only with the people who need attachment access. The bridge does not grant public access to files.

## Current live setup checkpoint — 2026-11-08

- The clinic selected its original Google workbook as the canonical data source; Supabase is a synchronized projection for the administration app. The original workbook ID, patient rows, and all credentials stay outside this repository.
- The separate Sheet-first Apps Script project is deployed as a public booking web app (deployment version 3). It runs as the owner, reports `configured: true`, and confirms the retry trigger is installed. Health check: `GET /exec?mode=health` returns readiness metadata only.
- Script Properties use `SUPABASE_SECRET_KEY` and `SUPABASE_PUBLISHABLE_KEY`; the old `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` properties were removed. Supabase legacy API keys were disabled after migration to publishable/secret keys. Never add key values to source control or logs.
- Supabase migration `20261108001453_sheet_canonical_lockdown` is applied. Supabase acts as a read projection; staff actions are validated and written to the Sheet first, then synchronized through the retryable outbox.
- A private staging workbook was used for a synthetic booking and projection/retry verification. The synthetic booking and related rows were cleaned up; no synthetic rows were written to the original clinic workbook. The live bridge health endpoint was rechecked after the key correction and reports ready.
- The original clinic workbook remains canonical. On 2026-11-08, general link access was changed to restricted; only the owner and the directly invited clinic doctor retain direct access. Staff use the authenticated dashboard. No patient rows were changed during this sharing update.
## Completed deployment checkpoint

1. A separate Apps Script project was configured and deployed as a Web App running as the owner, with public access for patient bookings.
2. `js/config.js` points to that `/exec` deployment. API credentials remain in Apps Script Script Properties only.
3. The reviewed Sheet-canonical lockdown migration was applied after bridge verification.
4. The private staging workbook was used for a synthetic booking, retry, and Supabase projection check. Test rows were removed; the original clinic workbook was not used for test writes.
5. The public health endpoint was rechecked after correcting Script Properties and reported ready with the retry trigger installed.
## Current limitations / release notes

- Run the local bridge guard checks from the build root with `node --test tests/bridge-guards.test.cjs`. They use synthetic fixtures and do not contact Google Sheets, Drive, email, or Supabase.
- Historical Sheet rows without an explicit status header are treated conservatively as unresolved matches; same-phone booking attempts create a review alert rather than assuming prior rows are closed.
- The deployed v3 dashboard's doctor-only reconciliation preview lists unique candidates, ambiguous candidates, and unmatched rows without writing. A unique or explicitly selected ambiguous candidate can be linked only after doctor confirmation and server-side revalidation of the current Sheet row, patient phone, date, request type, and booking-code uniqueness. The Sheet audit log records the decision; Supabase projection updates go through the retryable outbox. Ambiguous candidates are never linked automatically.
- Deployment v3 was published on 2026-11-08 and keeps the existing `/exec` Web App URL. Health was verified after publishing (`status: ready`, `configured: true`, `retryTriggerInstalled: true`). The reconciliation action has not yet been exercised by the doctor account; sign in as the doctor, run the preview, and review counts before approving any link. No original Sheet rows were changed by this deployment.
- Applied Supabase migrations include Monday closure, function privilege hardening, and Sheet-canonical lockdown. The Sheet is the source of truth and Supabase is a projection, not a second writable source.
- The production Apps Script deployment URL is configured in `js/config.js`; credentials remain private in Script Properties.
