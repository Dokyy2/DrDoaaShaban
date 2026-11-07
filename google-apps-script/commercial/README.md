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

## Script Properties

Create a new Apps Script project and add these properties under **Project Settings → Script Properties**. Values are intentionally not in source control.

| Property | Value |
|---|---|
| `WORKBOOK_ID` | ID of the approved clinic workbook |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase publishable/anon key used to validate staff sessions |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service role key; never put it in browser config or GitHub |
| `ATTACHMENTS_FOLDER_ID` | ID of a private Drive folder for uploaded documents |
| `NOTIFICATION_EMAIL` | One approved clinic recipient, configured privately by the owner |

Only the project owner should be an Apps Script editor. The Drive folder should be private and shared only with the people who need attachment access. The bridge does not grant public access to files.

## Current live setup checkpoint — 2026-11-07

- The user selected the original clinic workbook as the canonical source: `حجوزات العيادة` (the workbook ID is held in Apps Script Script Properties; credentials and patient data do not belong in this repository).
- The separate Apps Script project contains the bridge code and the required Script Properties. The owner granted Google authorization and ran `doGet`; Apps Script reported execution completed.
- This proves the basic handler runs. It does **not** yet prove workbook writes, Supabase projection, a web-app deployment, or live booking behavior.
- A screenshot in the conversation showed part of the service-role key. Rotate it in Supabase and replace it in Script Properties before deployment or privileged database calls. Never copy the key into this repository or chat.
- Original workbook sharing remains as the user chose (anyone with the link, temporarily). No workbook rows or permissions were changed during setup.
- Read-only header review confirmed `Sheet2` as the contact-leads tab (name, phone, message/source, registration time), matching the legacy script. The separate `جهات الاتصال` tab is the name/phone directory and is not a write target. `Sheet1` remains booking requests and `Sheet3` birth requests. No sheet cell was changed during this review.

## Deployment sequence

1. Save a backup of the workbook and finish the historical Sheet-to-Supabase dry-run reconciliation.
2. Create the separate Apps Script project, install `Code.gs` and `appsscript.json` from this folder, set Script Properties, and run `installRetryTrigger()` once while signed in as the owner. The manifest declares only the scopes required for Sheets, private Drive attachments, UrlFetch to Supabase, the retry trigger, and clinic email notifications; Apps Script will request authorization when those features are first used.
3. Deploy as a Web App that runs as the owner and accepts public requests, because patient booking is public. Staff write actions still require a valid Supabase session and role. Keep Apps Script editor access restricted.
4. Set the resulting `/exec` URL in `js/config.js` as `window.CLINIC_BRIDGE.url`.
5. Apply the reviewed SQL migration `supabase/07_sheet_canonical_lockdown.sql` only after the endpoint is ready. This removes browser write privileges, isolates doctor notes/attachments, and disables the old public Supabase booking RPC.
6. Verify with the blank staging workbook and synthetic rows first. The original workbook contains clinic data; do not use it for synthetic test writes.

## Current limitations / release gates

- Run the local bridge guard checks from the build root with `node --test tests/bridge-guards.test.cjs`. These checks use synthetic data and do not connect to Google Sheets, Drive, email, or Supabase.

- The bridge code is installed in the separate Apps Script project and `doGet` completed once, but no web-app deployment or end-to-end booking/write test has been verified.
- Historical Sheet rows without an explicit status header are treated conservatively as unresolved matches; booking requests with the same phone create a review alert instead of assuming those rows are closed.
- Existing Supabase rows without an exact matching booking code cannot be edited through the bridge yet. The historical reconciliation report must identify and explicitly approve their mapping first.
- Supabase migrations `20261107214532 add_monday_clinic_closure` and `20261107214631 function_privilege_hardening` are applied and verified. Monday is included without removing other configured closure days; trigger-only functions are not callable by web roles; the existing booking RPC remains callable by `anon` only. The Sheet-first lockdown migration `07` is deliberately not applied yet because the bridge is not deployed or end-to-end verified.
- The user authorized using the original workbook as the canonical source and chose to leave its current public-link access enabled temporarily. The workbook was inspected read-only; no cells or permissions have been changed by the integration work.
- Local guard tests now include payment-attribution spoof rejection, confirmed Sheet tab routing, and a schema-correct doctor-only private-note projection (9 total passing checks after the 2026-11-08 fix). They remain synthetic and do not prove any live service connection.
