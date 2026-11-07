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

## Current live setup checkpoint — 2026-11-07

- The user selected the original clinic workbook as the canonical source: `حجوزات العيادة` (the workbook ID is held in Apps Script Script Properties; credentials and patient data do not belong in this repository).
- The separate Apps Script project contains the bridge code and the required Script Properties. The owner granted Google authorization and ran `doGet`; Apps Script reported execution completed.
- The private Drive attachment folder is configured through `ATTACHMENTS_FOLDER_ID`. The owner also ran `installRetryTrigger()` successfully; `retryPendingSyncs` is installed on a 10-minute schedule. These setup steps do not verify a real booking or staff write.
- This proves the basic handler runs. It does **not** yet prove workbook writes, Supabase projection, a web-app deployment, or live booking behavior.
- A screenshot in the conversation showed part of the legacy service-role key. The owner has created a replacement Supabase secret key, but its value has not yet been installed in Script Properties. This bridge now expects `SUPABASE_SECRET_KEY` and `SUPABASE_PUBLISHABLE_KEY`; add those properties privately, verify the bridge with synthetic data, then retire the compromised legacy key. Never copy any key into this repository or chat.
- Original workbook sharing remains as the user chose (anyone with the link, temporarily). No workbook rows or permissions were changed during setup.
- Read-only header review confirmed `Sheet2` as the contact-leads tab (name, phone, message/source, registration time), matching the legacy script. The separate `جهات الاتصال` tab is the name/phone directory and is not a write target. `Sheet1` remains booking requests and `Sheet3` birth requests. No sheet cell was changed during this review.

## Deployment sequence

1. Save a backup of the workbook and finish the historical Sheet-to-Supabase dry-run reconciliation.
2. Create the separate Apps Script project, install `Code.gs` and `appsscript.json` from this folder, set Script Properties, and run `installRetryTrigger()` once while signed in as the owner. The manifest declares only the scopes required for Sheets, private Drive attachments, UrlFetch to Supabase, the retry trigger, and clinic email notifications; Apps Script will request authorization when those features are first used.
3. Deploy as a Web App that runs as the owner and accepts public requests, because patient booking is public. Staff write actions still require a valid Supabase session and role. Keep Apps Script editor access restricted.
4. Set the resulting `/exec` URL in `js/config.js` as `window.CLINIC_BRIDGE.url`.
5. Apply the reviewed SQL migration `supabase/07_sheet_canonical_lockdown.sql` only after the endpoint is ready. This removes browser write privileges, isolates doctor notes/attachments, moves role helpers into an unexposed `private` schema, removes the public attachment RPC, and disables the old public Supabase booking RPC.
6. Verify with the blank staging workbook and synthetic rows first. The original workbook contains clinic data; do not use it for synthetic test writes.

## Current limitations / release gates

- Run the local bridge guard checks from the build root with `node --test tests/bridge-guards.test.cjs`. These checks use synthetic data and do not connect to Google Sheets, Drive, email, or Supabase.

- The bridge code is installed in the separate Apps Script project, `doGet` completed, and the retry trigger was installed; however, no web-app deployment or end-to-end booking/write test has been verified. `ATTACHMENTS_FOLDER_ID` is configured for a private Drive folder.
- Historical Sheet rows without an explicit status header are treated conservatively as unresolved matches; booking requests with the same phone create a review alert instead of assuming those rows are closed.
- Existing Supabase rows without an exact matching booking code cannot be edited through the bridge yet. The historical reconciliation report must identify and explicitly approve their mapping first.
- Supabase migrations `20261107214532 add_monday_clinic_closure` and `20261107214631 function_privilege_hardening` are applied and verified. Monday is included without removing other configured closure days; trigger-only functions are not callable by web roles; the existing booking RPC remains callable by `anon` only. The Sheet-first lockdown migration `07` is deliberately not applied yet because the bridge is not deployed or end-to-end verified.
- The user authorized using the original workbook as the canonical source and chose to leave its current public-link access enabled temporarily. The workbook was inspected read-only; no cells or permissions have been changed by the integration work.
- The lockdown migration now targets the live `booking_alerts` schema shape (`matched_appointment_id`, without a pre-existing `appointment_id`). Its complete DDL passed a transaction-wrapped live syntax/schema dry run that ended with `ROLLBACK`; while still in the temporary transaction, the private role helpers returned `false` for a synthetic authenticated user. Follow-up catalog checks confirmed the private schema/table/idempotency columns were not created and no extra migration was recorded.
- The lockdown migration moves `is_staff`/`is_doctor` out of the exposed `public` API schema, rebinds every retained RLS policy to the private helpers, and removes the doctor attachment SECURITY DEFINER RPC. Dashboard attachment retrieval uses the already role-checked Apps Script route. These are prepared changes only; migration 07 remains unapplied until the bridge passes full verification.
- Local guard tests now include payment-attribution spoof rejection, confirmed Sheet tab routing, a schema-correct doctor-only private-note projection, and the role-safe settings read (10 total passing checks after the 2026-11-08 fixes). They remain synthetic and do not prove any live service connection.
