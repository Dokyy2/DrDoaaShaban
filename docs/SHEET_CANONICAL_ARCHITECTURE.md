# Sheet-first data architecture

**Status:** implementation contract, 2026-11-07  
**Applies to:** new commercial build only; the closed v2.7.0 booking edition and its deployed Apps Script remain untouched.

## Agreed flow

1. A patient submits a booking to a new, separate Google Apps Script deployment.
2. The Apps Script validates the request and writes it to the clinic workbook. The existing public deployment is not reused or modified.
3. After the Sheet write succeeds, the bridge projects the changed row into Supabase. Supabase is the operational read model for the portal, not the authority for clinic data.
4. A staff action first authenticates the Supabase access token and checks the server-side profile role, then writes the action and an audit entry to the Sheet. Only after the Sheet accepts it does the bridge update the Supabase projection.
5. If projection fails after the Sheet write, the operation is still recorded as **Sheet saved / mirror pending**. An idempotent retry repairs the mirror; the UI must never imply that both stores succeeded when they did not.
6. Excel/CSV is an export/backup only. It is not a third editable database.

Google Sheets and Supabase cannot share one atomic transaction. Sheet-first writes plus a durable, retryable Sheet outbox and reconciliation report provide eventual consistency without losing the canonical edit.

## Roles

| Capability | Clinic staff (`secretary`) | Doctor (`doctor`) |
|---|---:|---:|
| Read/process bookings, contact, status, schedule, waitlist | Yes | Yes |
| Record visit completion and payment | Yes, per clinic workflow | Yes |
| Read operational hours, closure days, capacity, service prices, and payment-workflow availability | Yes, as needed for clinic work | Yes |
| Read private clinical notes, finance reports, expenses, and payment audit | No | Yes |
| Change clinic settings/finance controls or user roles | No | Yes |

The server validates roles on every write. Hiding a control in the browser is not authorization. Keep a maximum of five active accounts. New accounts default to `pending` until the doctor approves them.

## Sheet mapping safety

- Map by normalized header names, never by fixed column numbers.
- Preserve all existing columns and rows. Add any required integration columns at the end only.
- The original workbook tabs are `Sheet1`, `Sheet2`, `Sheet3`, and `جهات الاتصال`. A read-only CSV metadata review of the first three rows (printing only recognized headers and blank/nonblank shapes, never patient values), together with the legacy script's sheet initialization, confirms `Sheet1` = appointment requests, `Sheet2` = contact leads (`ID`, name, phone, message, source, registration time), and `Sheet3` = birth requests. The separate `جهات الاتصال` tab is the name/phone directory and is not a write target for booking/contact leads. Keep the bridge contact mapping on `Sheet2`.
- Header-only review identified key headers on row 1 of all four tabs; the `headerRow_` detector supports headers offset by title rows for other workbook layouts. Do not assume the first physical column is a header when it contains a title; map the confirmed field aliases.
- The observed `Sheet1` headers include `ID`, `الاسم`, `الهاتف`, `نوع الكشف`, `تاريخ الحجز`, `تاريخ آخر زيارة`, `وقت التسجيل`, `الساعة`, `المصدر`, `ملاحظات`, and `رسالة المريض`. Some saved Apps Script logic has treated column 8 as `Status`; the bridge must keep it mapped to appointment time and add any missing status column by header at the end.
- The contact and birth tabs have a merged title in row 1 and column labels in row 2. New integration fields must be added to row 2, never written over the title row.
- Before attaching historical rows to Supabase, produce a dry-run match report using stable booking ID first, then phone + date + type as a candidate only. Ambiguous candidates remain unmatched for human review; no automatic merges or deletes.
- New writes carry a generated external booking key. Retries use that key so they cannot create duplicate appointments.
- A sync log records timestamp, external key, action, outcome, retry count, and sanitized error. It must not duplicate patient message, phone, notes, or attachment data.

## Credentials and deployment boundary

- Public website contains only the Supabase publishable/anon key and the new Apps Script deployment URL.
- Supabase `service_role` key, project secrets, and any webhook signing secret belong only in Apps Script Script Properties. They must never be committed or sent in chat.
- The new Apps Script project must use the approved workbook ID stored as a Script Property. Do not repoint the existing v2.7.0 endpoint.
- Keep the deployed production branch and current Pages site unchanged during local integration and synthetic-data verification.

## Release gates

1. Review a header-only workbook map; confirm all target tabs and exact header aliases.
2. Build and verify the bridge with the private blank staging workbook and synthetic names/phones only. It contains no patient data; keep its URL in local memory, not the public repository.
3. Reconcile historical rows in dry-run mode; review unmatched/ambiguous totals before import.
4. Run role tests (secretary, doctor, pending, signed-out) and failure/retry tests without modifying real patient rows.
5. Verify Sheet is the first durable write and failed Supabase sync is visible and retryable.
6. Review the final public file list for data, credentials, and deployment URLs before publishing to the approved test branch.

## Current blockers to deployment

- The separate Apps Script bridge and dashboard write routing exist in the local build. The bridge source is installed in its own Apps Script project, required Script Properties were saved, Google authorization was granted, and one `doGet` execution completed. The bridge is not deployed as a web app and no end-to-end workbook/Supabase write was verified.
- The original workbook's sharing indicator currently says anyone on the internet with the link can open it. The user chose to leave this setting temporarily; no sharing settings or cells have been changed by this integration work.
- A private blank staging workbook was created with `Sheet1`–`Sheet3` and synthetic header layouts only. No patient rows were copied; retain it for synthetic write verification. The user selected the original workbook as canonical, so do not configure production operations to use staging.
- A read-only header review confirmed the destination tabs. Historical appointment IDs still need a dry-run match report against Supabase.
- Apps Script Script Properties are configured privately. The service-role key must be rotated and replaced because a portion appeared in a shared screenshot. Do not paste service credentials in chat, source files, or GitHub.
- Supabase migrations `add_monday_clinic_closure` and `function_privilege_hardening` are applied and verified. `closed_weekdays` is `[1,4,5]`; trigger-only functions no longer have web-role execute grants; `create_booking` remains `anon`-only while the old route is still active. Migration `07_sheet_canonical_lockdown.sql` must wait until the Apps Script bridge is deployed and verified.
- A local review on 2026-11-08 found and corrected the private-note projection payload: the bridge now maps `patientId`/`actorId` to the actual Supabase `patient_id`/`updated_by` columns and validates a patient UUID. The live schema confirms that `patient_private_notes` and outbox idempotency columns are created by migration `07`, so notes/expenses/alerts cannot fully project until that guarded cutover.
- The shared dashboard read omits the unused `finance_start_date` field and the cutover grant does not expose it. Secretaries retain only the operational price/payment-availability fields needed for their workflow; server-side checks still reserve setting changes, finance reports, private notes, and user-role administration for the doctor.
- The bridge has only passed local syntax/guard checks so far. Do not create synthetic writes in the clinic workbook or call the Sheet-first design live until staging verifies writes, roles, outbox retry, and reconciliation.
