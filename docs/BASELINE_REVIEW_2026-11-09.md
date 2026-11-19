# Baseline review — local With Admin candidate

**Review date:** 2026-11-09  
**Candidate:** `03 - With Admin Clean Base 2026-11-09`  
**Commit:** `8cbeda12b8d8c5f6685e9cacff722033ae27dcf4`  
**Scope:** Read-only source and Supabase metadata review. No app/data/deployment changes.

**Status precedence:** The sections below capture the 2026-11-09 baseline; dated follow-ups supersede earlier findings when they conflict. The latest aggregate and remote-branch check is in the 2026-11-10 addendum at the end.

## 1. Current layout and confirmed behavior

- `main` remains the separate Sheets/Apps Script patient-booking edition. `with-admin` is the Supabase-backed booking and clinic administration edition.
- This candidate is a clean checkout of the published `with-admin` tracking ref. The two older local folders contain unpublished changes and are not included in this checkout; they remain untouched.
- The patient site contains the clinic profile, gallery, service chooser, pregnancy calculator, booking section, postpartum assistant link, reviews, contact details, and local privacy/preview messaging.
- The admin source contains a login gate; daily dashboard, all bookings, patient directory, calendar, alerts, monthly reports; doctor-only finance/settings; payment recording; private notes; expenses; CSV export; and close-case archive call.
- `staff-access/` is a separate static mock/prototype and is not loaded or linked from the active dashboard. It must not be treated as active authentication or team administration.
- Database migrations define `pending`, `secretary`, and `doctor`. Auth users are not self-approved by default. Dashboard role checks are backed by RLS/database functions, not only hidden UI buttons.

## 2. Findings to resolve

### P0 — Environment and data-state confirmation

1. **Historical 2026-11-09 snapshot, superseded:** metadata then reported 474 appointments, 84 appointment events, 6 alerts, 3 patients, 0 profiles, 0 clinic settings, and 0 archive rows. Those figures led to a missing-profile/settings concern. See the 2026-11-10 aggregate check below: profiles and settings now exist, so do not use the old counts as current state.
2. **Historical browser-access finding, superseded:** computer control initially reported unavailable. It later connected successfully. The 2026-11-10 addendum records current browser evidence and the remaining need for a signed-in workflow check.

### P1 — Operational consistency

1. Closed-case Excel archive is not proven live. Local code queues and calls the bridge, but memory records say the Apps Script deployment previously reported `needs_setup`/`configured:false`; test a completed and a cancelled synthetic case only after bridge setup is verified. Surface `pending`, `synced`, and `error` clearly and ensure retries are idempotent.
2. Some dashboard flows write a primary row and its history event in separate requests (for example manual booking creation); a partial failure can leave data without a matching audit event. Consolidate critical status/payment/booking mutations into guarded transactional RPCs, or make partial outcomes explicit and repairable.
3. Runtime coverage must verify public booking idempotency, date/closure/capacity rules, duplicate handling, dashboard refresh, and a timeout outcome that never encourages a duplicate submission.

### P1 — Roles and team lifecycle

1. The active navigation has no staff/team management view. A separate prototype under `staff-access/` contains static sample data and a “read only” banner; it is not a substitute.
2. Build doctor-owned team administration: create/invite, approve pending account, assign/revoke secretary or doctor role, disable/remove access safely, show current active count, and cap active users at five. Never place Supabase service credentials in the browser; use a narrowly authorized server function for Auth Admin operations.
3. Test signed-out, pending, secretary, and doctor access at the database/API boundary. Secretaries must not access financial amounts/audits, doctor-only settings, or private notes even if they call the API directly.

### P2 — Security, resilience, and commercial readiness

1. Supabase security advisor: three authenticated-callable `SECURITY DEFINER` functions and leaked-password protection disabled. Source inspection shows the three functions explicitly require `private.is_doctor()` and revoke `PUBLIC`/`anon`; verify this with negative-role tests and retain only the grants required. Enable compromised-password checks where the project plan supports it.
2. Performance advisor: nine unindexed foreign keys and five RLS init-plan warnings. Add only indexes supported by query patterns; rewrite per-row auth calls as `(select auth.uid())` where appropriate; re-run advisors.
3. CSV backup is a browser download of currently loaded data, not a scheduled backup/restore system. Define secure database backups, restore rehearsal, retention and export permissions before commercial use.
4. Add visible system health/sync status, durable error reporting, pagination/limits for large datasets, and accessible keyboard/mobile behavior. Check external fonts/CDN dependency and offline/error messaging.
5. Review privacy/data minimization, attachment limits/types/retention, audit-log retention, consent language, and clinic operational ownership before production.

## 3. Draft acceptance gates

1. **Booking:** valid synthetic booking creates one appointment and patient, returns an unambiguous confirmation/code, and appears in the dashboard after refresh. Repeating the identical idempotency key returns the same result without duplicates. A timeout with unknown outcome has a safe recovery/check path.
2. **Validation:** duplicate identity, closed weekday/date, daily capacity, malformed phone/date, attachment constraints, and past-date rules are enforced server-side and produce understandable user feedback.
3. **Workflow:** each allowed status transition records actor, old/new status, timestamp, and reason consistently; invalid transitions are rejected. A deliberate failure between mutation and audit cannot silently lose the audit trail.
4. **Payment:** doctor-only completion atomically records due/paid/method/note, completion status, and payment audit. Secretary API reads/updates cannot reveal or mutate finance fields.
5. **Team:** doctor provisions/approves/revokes accounts; pending accounts cannot access clinic data; active account limit is five; all role checks are verified against RLS/functions.
6. **Archive:** completion/cancellation produces one archive snapshot with available operational/payment fields and no private clinical note or attachment bytes. Outage leaves an explicit retryable pending/error state; retry is idempotent; success is verifiable in the target workbook.
7. **Resilience/UI:** local responsive checks cover login, loading/empty/error states, keyboard navigation, mobile layout, refresh/back navigation, session expiry, and connection loss. No action falsely claims success.
8. **Release readiness:** automated suite covers critical rules; advisor findings are triaged; backup restore is rehearsed; secrets and patient rows are absent from committed files; publishing remains prohibited until Bassem approves a specific build.

## 4. Proposed sequence

1. Restore local browser access and confirm the local dashboard/login with a read-only walkthrough; verify exact settings/profile state without changing production settings.
2. Reconcile code migrations against the live schema and resolve P0 boot/config discrepancies. Add safe seed/bootstrap instructions to a fresh development environment.
3. Complete atomic workflow/audit/payment transitions and deterministic synthetic end-to-end tests.
4. Implement doctor-owned team/role management with a five-user cap and server-side Auth administration.
5. Finish and verify the closure archive bridge and retry visibility.
6. Address security/performance findings, backup/restore, privacy and resilience; complete responsive accessibility review.
7. Prepare a release candidate and full acceptance report. Do not push or publish until explicit approval.

## 5. Current stop point

Static review is recorded. Manual dashboard and browser-origin integration checks can proceed now that the local browser is available, but require an authorized staff login and explicit workflow checks. See the 2026-11-09 addendum below for the source repair and what has/has not been verified.

## 6. Local dashboard startup repair — 2026-11-09

- User confirmed a duplicate booking was rejected, demonstrating that the local booking flow reads the existing Supabase test data. The dashboard initially showed “ملفات لوحة الإدارة غير مكتملة”.
- Browser evidence showed `dashboard/dashboard.js` failed to parse; the displayed setup warning was a generic timeout fallback, not proof that `dashboard/` or `js/config.js` was missing.
- The tracked dashboard source contained literal truncation artifacts. In the local candidate only, restored the patient-directory/reports/finance/calendar/settings/workflow helper block from the preserved older local admin edition, removed the two truncation labels in the daily close view, and reconstructed the close-workflow save tail to retain its existing Supabase update, audit event, and optional archive behavior.
- Verification: `node --input-type=module --check` passed for the repaired dashboard file; scan found no truncation markers in that file; local browser now renders the dashboard sign-in form at `http://127.0.0.1:5500/dashboard/` instead of the fallback. No login was attempted, so post-login screens/permissions and admin actions remain unverified.
- The separate older local edition was read as a repair source but not modified. Published `main` and `with-admin` branches, Supabase data/schema, Google Sheet, and Apps Script deployment were not changed by this repair. Local candidate now has a tracked source modification and remains local-only.
- Next: Bassem signs into the local dashboard and checks that Home, All Bookings, Patient Family, Calendar, Alerts, Reports, Finance (doctor only), and Settings load. Then report any remaining failure; only after screen checks should we proceed to safe workflow tests.

## 7. Offline acceptance checks and access-control finding — 2026-11-09

- Rechecked browser state: dashboard remains at the sign-in form; no staff session was opened by Codex.
- Initial local Node test run was 25/28 because the harness had one incomplete outbox mock and two assertions that still described the old bridge flow. Updated those checks to match the current Supabase booking function and the new doctor-only attachment boundary.
- **P1 — Attachment body is not role-protected at the database layer (source review; no exploit attempt):** `supabase/08_supabase_canonical_admin.sql` grants `SELECT(attachment_base64)` to all `authenticated` users. The appointment RLS policy permits all active staff, and `09_role_financial_separation.sql` revokes finance columns but does not revoke attachment data. The UI guards `openAppointmentDetails()` to doctor role, then reads the body directly from `appointments`; a secretary with an authenticated JWT could bypass that UI guard and select the column through the REST API. This is inferred from the committed SQL and browser code, not tested against a live secretary token.
- **Local browser follow-up:** after an earlier “dashboard files incomplete” fallback was shown, the current Chrome page at `http://127.0.0.1:5500/dashboard/` was observed to load the dashboard sign-in form. This confirms the local page and dashboard module now start; no credentials were entered and no live data was changed.
- **Local source remediation prepared:** added `supabase/14_doctor_only_attachments.sql` to remove broad appointment reads, restore only non-finance/non-body columns for staff, and expose the body through a doctor-checked RPC. Updated the doctor-only UI retrieval to call that RPC. This migration has **not** been applied to Supabase, so the live test project’s existing permissions remain unchanged until applied.
- Updated the dashboard startup fallback so it no longer claims the files are definitely missing: it now describes a startup timeout, gives a retry button, and waits 15 seconds before replacing the loading view. Asset query versions were bumped for local cache refresh.
- Updated local Supabase function config for `clinic-db-booking` with `verify_jwt = false`, matching the public booking Edge Function that validates the public action and uses its server-only service key. Replaced stale assertions that targeted the unused Sheet proxy.
- Latest verification: existing Node suite passes 28/28; dashboard module syntax check passes; `git diff --check` passes. No live Supabase or GitHub changes were made.
- Application attempt: Bassem confirmed the Supabase project ref matches the experimental database and approved migration 14. Browser navigation to its SQL Editor timed out and the new tab remained blank; no SQL was pasted or run. There is no direct Supabase database connector available in this session, so stop here per the user's connection-failure instruction. Migration remains unapplied; no remote changes.
- **Before treating confidentiality as verified:** apply migration 14 to the isolated test project and confirm doctor success plus secretary denial at the API boundary. Keep this candidate local-only until then.

## Follow-up — migration 14 applied and privilege check passed (2026-11-09)

- Applied the approved migration in the confirmed experimental Supabase project `ccuharkcusmsjdxfuamq`; SQL Editor reported success.
- Read-only database checks confirmed authenticated staff can read appointment IDs, cannot directly select attachment bodies, authenticated users can invoke the guarded RPC, and anonymous users cannot invoke it.
- Doctor-versus-secretary runtime behavior still needs an authenticated UI/API check. The SQL grant boundary and doctor-role guard are verified from the deployed schema; no patient rows were modified.

## Follow-up — current Supabase and secretary UI evidence (2026-11-09)

This follow-up supersedes earlier pre-recovery statements in this report about the dashboard not being inspectable and the attachment migration remaining unapplied.

- Migration 14 is applied in the confirmed experimental project. A read-only SQL grant check confirmed: authenticated role can select normal appointment identifiers, cannot select `attachment_base64`, may execute the RPC, and anonymous may not execute the RPC.
- A non-mutating role simulation on an existing test attachment completed successfully. The SQL script would fail unless the secretary RPC call is denied with `42501` and the doctor RPC returns the attachment row. It returned no attachment bytes, patient identifiers, or database row contents.
- Local dashboard is currently signed in as secretary and loaded live test data. Opening an attachment-marked request showed the doctor-only access message; DOM checks found no attachment image or iframe. No appointment fields or status were changed.
- Local suite rerun: 28/28 passed. Doctor-side visual loading and the remaining full workflow acceptance gates are still open. Candidate remains local and unpublished.

## Follow-up — local doctor-owned team administration — 2026-11-09

- Added a doctor-only dashboard screen for team invitations, role changes, and access suspension. The browser calls a dedicated Edge Function; the service-role key is read only from server environment variables.
- Added migration 15 with doctor-only `SECURITY DEFINER` procedures, serialized seat reservations, a maximum of five active users, protection against removing the last doctor, and a doctor-readable audit trail for invitations, role changes, and access suspension/restoration. Invitation activation and its audit event are atomic.
- The team screen now displays the most recent 200 audit events, limited to the doctor session.
- Added `clinic-team-admin` Edge Function and local Supabase CLI config. Added local team styling and instructions for the Auth redirect URL.
- Static regression coverage now asserts the role gates, server-only credential boundary, serialized cap, and last-doctor guard.
- Verified locally: 30/30 Node checks pass, dashboard module syntax check passes, the Edge Function TypeScript syntax check passes under Node's type stripping, and `git diff --check` passes. Deno/Supabase CLI are not installed, so Deno runtime/local Supabase checks remain unavailable.
- Migration 15 and Edge Function are not applied/deployed to Supabase; team-management screen will report an unavailable service until both are configured. No invitations, role changes, patient data changes, or GitHub publication were made.

## Verification correction — 2026-11-09

The current local suite after adding the doctor-only team audit feed passes 27/27; dashboard JS syntax, Edge Function TypeScript syntax check, and `git diff --check` pass. Earlier 28/30 test totals in this report describe earlier revisions. Migration 14 is already applied on the confirmed trial project and was not reapplied in this step. Team migration 15 and its Edge Function remain local only. No GitHub or patient-data changes.

## Follow-up — team administration activated on trial Supabase — 2026-11-09

Migration 15 was applied successfully to the confirmed trial project, with RLS enabled for the invitation reservation table. Edge Function `clinic-team-admin` was deployed from Supabase Dashboard and its legacy platform JWT check was switched off; the function verifies the bearer session against Auth and requires doctor role before serving team operations. A request without a session returned 401. The local authenticated doctor dashboard successfully loaded two active accounts (limit five) and the empty audit list. No invitation, role change, access suspension, patient row, GitHub branch, workbook, or Apps Script was changed. Before the first invitation, confirm Auth invite redirect URLs for local and intended deployment origins. This supersedes the earlier note that migration 15/function were not deployed.

## Follow-up — invitation readiness check — 2026-11-09

- Read-only inspection of Supabase Auth URL Configuration on the confirmed trial project found Site URL `http://localhost:3000` and an empty Redirect URLs allowlist. The active local admin is hosted at `http://127.0.0.1:5500/dashboard/`; invitation links would otherwise fall back to the wrong URL.
- The dashboard has no password setup or recovery screen (`updateUser`, reset-password, and recovery flows are absent). Therefore the team invite workflow is not ready for its first real invitation, even though team listing and role controls are active.
- Prepared a local-only change in `supabase/functions/clinic-team-admin/index.ts` to pin invites from the current local doctor dashboard to `http://127.0.0.1:5500/dashboard/` rather than rely on Site URL. This candidate change has not been deployed. It still requires allowing that exact callback URL in Supabase Auth and implementing/verifying an invite password setup experience.
- No invitation was sent and no Auth settings, team member, patient record, GitHub branch, workbook, or Apps Script was changed during this inspection.

## Local invitation onboarding preparation — 2026-11-09

- Added a local-only password setup screen for Supabase invite/recovery links; it validates matching passwords (12+ characters), updates the authenticated user's password, removes token/query material from the visible URL, and continues into the dashboard.
- Updated local `clinic-team-admin` source to send invitations back only to the observed local dashboard URL (`http://127.0.0.1:5500/dashboard/`). This source is not deployed yet. The remote Auth redirect allowlist is still empty, so the invite cannot yet complete safely.
- `git diff --check` passes. No invitation or external configuration change was made. The callback and password setup still need an end-to-end invite acceptance using a disposable test email before the feature can be considered ready.

## Trial auth callback configured and function redeployed — 2026-11-09

- With Bassem's approval, added the exact allowed Auth redirect `http://127.0.0.1:5500/dashboard/` to the trial Supabase project. Verified the saved URL remained present after reloading the configuration page; left Site URL (`http://localhost:3000`) unchanged as unrelated fallback.
- Deployed the local `clinic-team-admin` source with its allowlisted, explicit redirect target. Supabase editor showed successful completion (deployment control returned to ready, no modified marker). The function stays on manual bearer validation and doctor-role authorization; legacy Verify JWT remains OFF.
- Post-deploy unauthenticated `team.list` request returned HTTP 401, confirming the server still rejects missing sessions.
- Local JavaScript and TypeScript syntax checks and `git diff --check` pass. No invitation email was sent. End-to-end invite/password activation remains unverified until a disposable test mailbox is selected; no GitHub publication or patient data mutation occurred.

## Follow-up — invite safety and current roster — 2026-11-09

- Live local doctor dashboard loads the team roster from the trial project: 2 active accounts out of 5 (`reception@drdoaa.com` and `drdoaashaban@clinic.com`). Supabase Auth Users confirms 2 total users. The proposed test address `Dokyy2@gmail.com` is not in the current Auth user list.
- Invite safety review found an automatic long-term ban if invitation profile activation failed. Local candidate now scans Auth users in pages before inviting and rejects an already registered email; if profile activation fails, it releases the seat reservation and leaves the account without a clinic role rather than banning it.
- Added static regression assertions for duplicate-email prevention and the no-auto-ban failure behavior. Current suite passes 30/30; `node --check dashboard/dashboard.js`, `node --check supabase/functions/clinic-team-admin/index.ts`, and `git diff --check` pass.
- These latest safety changes remain local and unpublished/undeployed. No invitation was sent, no Auth account was created, and no GitHub or patient data changed. Bassem supplied the email but has not yet confirmed sending the invite with a selected role; default role in the form is secretary.

## Approved test invite — browser control unavailable — 2026-11-09

- Bassem explicitly approved deploying the latest local invite-safety change to the trial Supabase project and sending an invite to `Dokyy2@gmail.com` as `secretary`. This action would create a user account and use one of five active seats.
- Attempt to resume the already open Supabase browser tab was blocked because local browser use is disabled in Work settings. No deployment action completed and no invitation was sent. This authorization remains pending execution once browser access is enabled.
- Rechecked local suite: 30/30 pass; `git diff --check` passes. No changes to GitHub, Auth users, patient rows, or published branches.
- Expanded local guard coverage to assert the single explicit invite redirect, fail-closed behavior for other origins, invite/recovery password setup, and removal of token material from the address. Current suite remains 30/30; JS and Edge Function syntax checks and whitespace checks pass.
- Independently reviewed financial separation: migration 09 revokes direct reads of appointment payment columns and finance settings from all authenticated roles and routes reads/completion through doctor-checked RPCs. Added regression assertions for those guards; suite now passes 31/31. This was a local-only test/doc change.

## Current-state reconciliation — 2026-11-09

This section supersedes earlier statements above that said the team migration/invite flow was not deployed or verified. Evidence observed after those historical entries:

- Local candidate is still on branch `with-admin`, based on `8cbeda1`, tracking `origin/with-admin`; it has uncommitted local candidate changes. No push was made. Published `main` and `with-admin` remain out of scope.
- On the confirmed trial Supabase project `ccuharkcusmsjdxfuamq`, migration 14 (doctor-only attachment RPC) and migration 15 (team admin) were applied, and `clinic-team-admin` was deployed. The Auth redirect allowlist includes `http://127.0.0.1:5500/dashboard/`.
- The trial Auth user list now contains 3 accounts. The local dashboard successfully authenticated `Bassem Ashraf` as `secretary`, proving the invite was accepted and the password setup/session completed. The doctor-only team management navigation is therefore expected to be hidden in this session. This does not verify secretary denial at every underlying data/API boundary.
- The invite template remains Supabase's default on the hosted project. The dashboard displays “Set up custom SMTP to edit templates”; the project is on the Free organization. A premium Arabic RTL invite template and subject now exist under `supabase/email-templates/`, and `supabase/config.toml` points local CLI Auth to that template. Per Supabase docs, this config only affects local development; hosted projects require custom SMTP and dashboard template editing.
- No hosted SMTP, Auth template, GitHub branch, workbook, Apps Script, or patient record was changed in this reconciliation.

### Updated open gates

1. **Role coverage:** verify the doctor session and secretary session separately at UI and data/API boundaries; current live evidence proves secretary login only.
2. **Closed-case archive:** still needs a fresh bridge readiness check and synthetic completion/cancellation round trip to the workbook, including idempotent retry behavior.
3. **Atomic workflow/payment audit:** local review called out multi-request status/event writes; transaction boundaries and failure recovery remain to be assessed.
4. **Commercial operations:** backup/restore rehearsal, pagination/performance, security advisor triage, privacy/retention policy, and accessible responsive flows remain open.
5. **Premium invite email:** hosted activation is blocked only on choosing/configuring custom SMTP; do not put SMTP credentials in source or chat.

### Current source of truth

- **Stable/published:** GitHub `main` and `with-admin`; leave unchanged.
- **Active candidate:** local `03 - With Admin Clean Base 2026-11-09` on `with-admin`, with uncommitted changes for the candidate build, team UI/function/migrations, bridge hardening, and invite email template. Treat this as experimental until audited and explicitly selected for publication.
- **Trial backend:** `ccuharkcusmsjdxfuamq`; trial accounts/records are disposable per Bassem. Do not infer that the dashboard's “PRODUCTION” label means the clinic's live production environment; project identity was explicitly confirmed as trial by Bassem.

## Live role-boundary check — 2026-11-10

- On the confirmed trial project `ccuharkcusmsjdxfuamq`, the local dashboard session is the secretary account. Its navigation shows booking workflow, alerts and Excel export; team administration and finance tools are absent.
- In Supabase SQL Editor, simulated the secretary JWT subject and ran role-boundary assertions without selecting patient or payment values. Five checks returned `true`: direct SELECT privilege for `appointments.amount_paid` is absent; direct SELECT for `attachment_base64` is absent; secretary calls to `doctor_finance_settings`, `doctor_finance_snapshot`, and `doctor_appointment_attachment` are rejected with insufficient privilege.
- A follow-up positive-access check for the doctor could not be confirmed: the SQL editor returned an existing temporary-table error from the prior test session while attempting to refresh the check. No appointment rows were displayed or changed. Mark doctor-side positive access as open; do not infer it from the secretary denial test.
- No GitHub branch, permanent table, patient record, appointment, or hosted email setting changed during this check. Next: verify doctor-side RPC access with a fresh SQL Editor session, then run synthetic appointment lifecycle and archived workbook reconciliation checks.

## Doctor-positive role check — 2026-11-10

- Repeated the doctor-side check in a fresh Supabase SQL Editor tab on the trial project, impersonating the verified doctor user through local transaction claims and `SET LOCAL ROLE authenticated`.
- The three boolean results were all `true`: doctor finance settings RPC allowed, finance snapshot RPC allowed, and doctor-only attachment RPC allowed. The query returned booleans only; it did not display financial values, attachment contents, or patient rows, and ended with `ROLLBACK`.
- Combined with the prior secretary-denial assertions and UI check, this closes the targeted permission gate for these three RPCs. It does not replace a full RLS audit for every table or prove production readiness.

## Closed-case archive hardening — 2026-11-10

- Added an identity consistency guard in `google-apps-script/commercial/Code.gs`: the queued archive record's appointment ID and booking code must match the embedded snapshot before any workbook row is written. This prevents a malformed queue payload from being filed under another case.
- Added synthetic regression coverage for a successful archive, repeated-request idempotency, retry after a transient Sheet write failure, and rejection of a mismatched snapshot identity.
- Verification: full `node --test` suite passes 34/34; `git diff --check` passes (only existing LF/CRLF warnings). This is local candidate code only. No Apps Script deployment, live workbook write, Supabase schema change, or GitHub push occurred.
- The external workbook round-trip is still an open acceptance check; unit coverage does not prove the deployed bridge or actual workbook connection.

## Closed-case archive privilege check — 2026-11-10

- Read-only system metadata on the trial Supabase project confirmed `public.clinic_closed_case_archive` and trigger `appointments_closed_case_sheet_archive` exist.
- `service_role` has table read privilege; `authenticated` does not. A direct archive read from the SQL editor session was denied, consistent with the service-only boundary. No archive rows or patient data were selected.
- This verifies the database access boundary only. The deployed Apps Script and actual workbook round-trip remain unverified; no workbook write, deployment, schema change, or GitHub push occurred in this check.

## Follow-up workflow and invitation readiness — 2026-11-10

- Reviewed the current workflow controls in `dashboard/dashboard.js` against migration 16. The detail dialog currently offers every status for every appointment; the RPC checks required fields and optimistic status freshness, but does not enforce a status-transition graph.
- This is an open product decision, not yet a proven defect: restricting transitions without the clinic's real workflow could block legitimate corrections. Before release, define the allowed transitions and whether a doctor can override them; then enforce the same policy in the database RPC and UI, with rejected-transition checks.
- The Arabic RTL premium invite HTML is present locally at `supabase/email-templates/invite-user.html`, and local Supabase config references it. Hosted Supabase still uses its default Auth email because custom SMTP has not been configured. Activating the branded message requires choosing/configuring an SMTP provider and then copying the subject/body template into the hosted Auth template settings; no provider credentials are stored in the repository.
- No live database, Auth email setting, patient record, published GitHub ref, Apps Script deployment, or workbook changed during this review.

## Reschedule validation hardening — 2026-11-10

- Updated the local migration 16 workflow RPC so `follow_up` and `rescheduled` changes check clinic closed weekdays/dates, reject another active booking for the same patient/date, and enforce the configured daily capacity. The database uses the same per-phone and per-date advisory locks as booking creation to serialize these checks. Birth bookings retain the existing closed-day/capacity behavior.
- Updated the rollback-only validator to use the identical RPC definition and added source guards for each server-side check.
- Expanded the rollback-only integration script to create synthetic duplicate/capacity fixtures and temporarily close a date, then assert that reschedule attempts for each case are rejected. The script remains one transaction with one final `ROLLBACK`; fixture rows and temporary settings are not retained.
- Verification: `node --test tests/bridge-guards.test.cjs` passes 35/35; `node --check dashboard/dashboard.js` and `git diff --check` pass. These source-level checks do not parse SQL or prove live behavior.
- PostgreSQL/Supabase CLI, Docker, and `psql` are not installed in this environment. The live migration remains unapplied; the rollback-only integration SQL still needs to be run in the confirmed trial SQL Editor before applying migrations 16–17. No live data or published branch changed.

## Booking attachment read-failure handling — 2026-11-10

- The patient form previously resolved FileReader errors as an empty attachment while retaining the filename, so the UI could continue with a misleading “attachment exists” state. The local candidate now rejects oversized files above 5 MiB and failed/empty reads, shows an Arabic/English explanation, and stops before any booking request is sent. The upload hint now states the size limit.
- Added a focused test for successful read, oversize rejection, read failure, and empty read. Verification: `node --test tests/bridge-guards.test.cjs` passes 36/36; both patient and dashboard JavaScript syntax checks and `git -c core.whitespace=cr-at-eol diff --check` pass.
- This is client-side upload feedback, not a server-side file-type/content inspection. The public edge function and database validation still need a stricter allowed-type/content policy before commercial release. No live booking, patient record, database, workbook, or published branch changed.

## Booking attachment server validation — 2026-11-10

- Added a server-side validator to `supabase/functions/clinic-db-booking/attachment-validation.mjs` and wired it into the Edge Function before reading privileged Supabase credentials or making the database request. It rejects partial metadata, malformed/oversized Base64, filenames over 180 characters, unsupported types including SVG, and MIME/signature mismatches. Accepted types are PDF and the listed common raster image formats, limited to 5 MiB.
- Updated the patient file picker to advertise the same supported types. Added regression checks for valid PDF/PNG/JPEG/WebP signatures, malformed/unsupported/mismatched files, size overflow, and filename sanitization. The first run exposed a large-input regex stack failure; validation now checks size first and scans Base64 linearly.
- Verification: `node --test tests/bridge-guards.test.cjs` passes 38/38; `node --check js/main.js`, `node --check dashboard/dashboard.js`, and `git -c core.whitespace=cr-at-eol diff --check` pass. Deno is unavailable, so Edge Function type/runtime checking was not possible here.
- This improves request validation but does not inspect files with a full malware scanner or deeply parse document contents. No Edge Function deployment, Supabase change, Sheet write, patient booking, or GitHub change occurred. Published `main` and `with-admin` remain untouched.
- Bassem asked to defer SMTP setup and activation of the premium invitation email until he explicitly reopens that step. The premium template already exists locally; hosted SMTP and Auth email templates remain unchanged.

## Invitation email decision — 2026-11-10

- Bassem confirmed the default Supabase invitation email is sufficient for the small number of free trial invitations. Keep the hosted and local Auth invitation email on the default template; do not set up a custom sender or proactively bring up SMTP again.
- Kept `supabase/email-templates/invite-user.html` as an inactive saved design for possible future use, but removed its local Supabase CLI config binding. No hosted Auth settings or invitations changed.

## Workflow audit-write gap confirmed in source — 2026-11-10

- A focused source review confirmed two multi-request paths in `dashboard/dashboard.js`: `saveAppointmentForWorkflow()` updates an appointment and then inserts its event as separate requests for non-finance workflow changes; `createManualBooking()` inserts the appointment and then inserts its creation event separately.
- If the second request fails, the primary change remains committed without the matching audit event. The UI reports a partial outcome, but the record is not repaired automatically.
- `record_appointment_completion()` is already transactional for doctor-only visit/payment completion. The remaining paths need a server-side transaction/RPC design and role/transition constraints before they can meet the workflow audit acceptance gate. No database change or test was run in this source review.

## Apps Script health check connection failure — 2026-11-10

- Rechecked the connected Chrome session: it contains local clinic/Supabase pages, but no Google Sheets or Apps Script tab.
- Made one read-only request to the known Apps Script health endpoint. The available browser/search connection reported that the URL was not accessible. Per Bassem's connection-failure rule, stopped here and did not retry, call a write action, or change the workbook/script.
- Live archive readiness and workbook round-trip remain unverified. Resume after Bassem restores/open-confirms the Google session or Apps Script page.

## Atomic workflow candidate — 2026-11-10

- Implemented local migration `supabase/16_atomic_staff_workflow.sql`: staff status changes and audit event inserts run in one transaction; manual appointment creation and its event are also atomic and use a request key for idempotent retry. Direct authenticated REST writes for these appointment fields/events are revoked in this candidate.
- Updated `dashboard/dashboard.js` to call the two RPCs rather than separate table requests. The existing doctor-only completion/payment RPC remains the finance path.
- Added regression guards for transaction structure, staff checks, request-key idempotency, direct-write revocation, and UI routing. Full local `node --test`: 36/36 passed; `node --check dashboard/dashboard.js` passed.
- The migration was not parsed/applied against a PostgreSQL server in this session (`psql`/Supabase CLI unavailable), and it has not been applied to the trial Supabase project. Static tests are not proof that the migration will apply or that live RPC integration works.
- No change to hosted Supabase, Apps Script, workbook, published GitHub refs, or patient records. Next gate: validate migration against a disposable/local database or the explicitly confirmed trial project, then test manual booking, status change, audit row, concurrency/retry, and secretary/doctor grants.
- Follow-up: Chrome reached the confirmed trial SQL Editor, but browser policy explicitly blocked opening the local validation script (`file://`). Per that policy, no alternate path was used to transfer the local file into the editor. The migration remains unapplied and unvalidated against PostgreSQL.
- Prepared `supabase/16_atomic_staff_workflow_VALIDATE_ROLLBACK_ONLY.sql` for a manual test: temporary DDL and grants, synthetic doctor-authorized booking plus retry/status/audit checks, direct-write denial assertions, then unconditional `ROLLBACK`. Reviewed its transaction markers locally (one `BEGIN`, one `ROLLBACK`, zero `COMMIT`). Not run yet.
- Found and fixed an adjacent workflow gap: when finance is disabled, a completion can pass through the general workflow RPC; that path previously did not request the closed-case Sheet archive. It now archives completed cases as well as cancelled/no-show cases, while finance-enabled completion continues using its doctor-only atomic RPC. A regression guard covers this route.
- Re-ran full local suite after the fix: 36/36 passed; JS syntax check and `git diff --check` passed (only existing LF/CRLF warnings). This still does not prove live database or Sheet behavior.

## Rollback validator and browser-control retry — 2026-11-10

- Corrected the rollback-only validator's ambiguous PL/pgSQL test variable and reran it against the confirmed trial project. The transaction completed and rolled back; follow-up aggregate checks found no synthetic patients, appointments, archive rows, workflow RPC, or no-show trigger change left behind.
- Current candidate regression suite: 41/41 passed. Remote migrations 16–17 remain unapplied. The cached published `with-admin` client still uses direct appointment writes that migration 16 revokes, so defer applying the migrations until an app release is coordinated or a separate database is used.
- Supabase migration history and live schema are not fully reconciled: team-management schema objects exist although the migration ledger does not clearly account for the same state. Resolve this drift before formalizing future migration deployment.
- Browser-control troubleshooting now begins by verifying the connection tool and its visible browser/app inventory. On the first retry the tool failed to initialize; a subsequent retry succeeded and detected Chrome (local clinic booking tab), VS Code, and Supabase Studio. The local booking page accessibility tree loaded successfully. This was read-only; no form, data, or release changed.
- No permanent Supabase change, Apps Script deployment, workbook write, GitHub publish, or patient-row mutation occurred in this checkpoint.

## Live-state and release-boundary refresh — 2026-11-10

- Read-only Supabase aggregate check in the confirmed trial project: 3 profiles with active clinic roles, 1 singleton clinic settings row, 3 active appointments dated today or later, and 0 closed-case archive rows pending sync. No names, phone numbers, or appointment details were selected.
- Live GitHub heads were fetched read-only after network access was enabled for this turn: `main` = `2e825f79ca0b76dfa9d62cfe3503b9cbf9ce43d4`; `with-admin` = `8cbeda12b8d8c5f6685e9cacff722033ae27dcf4`. Both match the previously recorded published heads. No fetch/merge/push or release action changed either branch.
- Supabase development-branch inventory is empty. Bassem declined creating a billable branch after receiving its quote ($0.01344/hour). No branch was created and no branch charge was incurred.
- The local browser control is connected. The booking page loads; a separate local `/dashboard/` tab currently shows the sign-in form. No credentials were entered and no appointment, staff, or settings action was submitted. Role-specific workflow acceptance still requires an authorized doctor/secretary session.
- Migration 16 remains incompatible with the currently published admin client because that client uses direct appointment writes; migrations 16–17 remain unapplied. Keep the published branches and shared trial schema unchanged until Bassem explicitly selects a coordinated candidate release or a zero-cost isolated test database becomes available.

## Read-only privilege audit — 2026-11-10

- Bassem declined creation of a Supabase development branch after the displayed hourly cost; no branch was created.
- Read-only ACL inspection found `public.staff_appointment_events` has broad view grants (`anon` and `authenticated`) despite intended staff-only read usage. The view is `security_invoker=true`, while its source table `appointment_events` has RLS enabled and no table-level grants to those roles; therefore the broad view ACL is excessive, but this inspection alone does not show an RLS bypass.
- Prepared a local-only SQL draft `supabase/18_staff_event_view_privilege_hardening.sql` to revoke broad view grants and restore authenticated SELECT only. It is not a CLI-managed timestamped migration and is not applied remotely.
- Published GitHub refs and live Supabase were not changed. No patient records were read or modified.
## Team invitation local redirect correction — 2026-11-10

- The candidate runs by default on port 5501, but the team Edge Function only mapped invitation redirects for port 5500. Added exact redirect mappings for localhost and 127.0.0.1 on ports 5500 and 5501, each returning to the dashboard on the same origin.
- Documented the exact Auth Redirect URLs needed for the default 5501 local server in README and SUPABASE_SETUP. The live Supabase Auth allowlist was not changed, so invitation delivery still requires those destinations to be allowlisted there.
- No invite was sent and no account, live Supabase configuration, published branch, or patient record changed. No tests were run in this step.

## Browser connection and Auth redirect boundary — 2026-11-10

- Fresh computer-use inventory succeeded and listed Chrome with Supabase SQL Editor and the clinic page at http://127.0.0.1:5500/index.html, plus VS Code with the local clean candidate open. This confirms the control tool is connected; the browser inventory did not show Supabase Auth URL Configuration.
- The current session's clinic page is on port 5500, whose same-origin invite redirect is already present in the local function. The candidate README/setup guide uses port 5501 as its default; that port now has matching local redirects and documented Auth allowlist URLs.
- No Auth allowlist setting was changed. Invite flow remains gated until the exact active dashboard URL is allowed in Supabase Auth. No credentials, invites, patient data, or releases were changed.


## Fresh Supabase security advisor — 2026-11-10

- Advisor reports 8 authenticated-callable SECURITY DEFINER functions. Source review of team functions found explicit doctor checks and revoked PUBLIC/anon execution; these remain intentional RPC entry points but require negative-role verification as a release gate.
- Advisor reports the private invite-reservation table has RLS enabled without policies. It is intentionally inaccessible to anon/authenticated by grants, so this is deny-by-default; document rather than opening it.
- Leaked password protection remains disabled and needs review before production. No Auth setting or database change was made.


## Local detail-modal check and workflow schema gap — 2026-11-10

- Rechecked the computer-control connection first; it is currently connected. The local candidate dashboard loaded at `http://127.0.0.1:5501/dashboard/`, and the details modal opened for an existing clearly synthetic test request. No save/status/payment action was submitted and no row changed.
- Read-only inspection of the confirmed Supabase trial project shows the current migration ledger still ends at the existing ten migrations. A catalog query found `public.record_appointment_completion`, but did not find the candidate's `public.record_appointment_workflow` or `public.create_manual_appointment` RPCs.
- The local candidate calls those two missing RPCs for appointment status/history changes and manual bookings. Those write paths therefore cannot be considered operational against the current shared database yet, even though the dashboard and details modal render. Do not ask Bassem to test a save until the RPC/schema rollout is prepared.
- Migration 16 currently also revokes direct authenticated appointment/event writes used by the untouched published `with-admin` client. Applying it as-is to the shared project would risk breaking that published client. The next engineering step is a staged, backward-compatible rollout: add and validate the RPCs while retaining old-client compatibility; only revoke legacy writes when the replacement client is explicitly selected for release.
- Fresh read-only advisor check: no health findings; security/performance findings remain consistent with the recorded baseline (intentional authenticated `SECURITY DEFINER` RPCs, compromised-password protection disabled, unindexed foreign keys/RLS init-plan notices). No migrations, settings, data, workbook, Apps Script, GitHub ref, or published deployment changed.

## Expand-only workflow migration and branch-cost decision — 2026-11-10

- Bassem declined creating a paid Supabase branch. No branch was created and no cost incurred.
- Updated local draft `supabase/16_atomic_staff_workflow.sql` to add the two staff-checked atomic RPCs without revoking the authenticated table grants used by the currently published `with-admin` frontend. This keeps the migration backward-compatible while the replacement client is evaluated locally.
- Updated the rollback-only SQL validator to avoid changing or requiring removal of those legacy grants. It still creates temporary test fixtures and ends with `ROLLBACK`; it has not been run against Supabase in this step.
- Updated the existing source guard to enforce that migration 16 remains expand-only. Full existing Node suite passed: 41/41 across `tests/*.test.cjs`.
- `git diff --check` reported pre-existing line-ending/trailing-whitespace warnings in the separate modified `js/main.js`; this workflow change did not touch that file, and no broad formatting rewrite was made.
- Supabase remains unchanged; migrations 16–17 are unapplied. No GitHub refs, secrets, user accounts, or patient data changed. A later contract/cutover stage must separately verify every client uses the new RPCs before any legacy write grants are tightened.


## Dashboard resilience follow-up — 2026-11-10

- Improved the local candidate dashboard login so network/profile-load failures return a useful retry message instead of leaving an unhandled rejection or a permanent disabled submit button. Optional alert, payment-audit, and doctor-only expense query failures now appear in a visible partial-load banner rather than looking like empty datasets.
- Started the candidate static preview at `http://127.0.0.1:5501/dashboard/`. Browser loads the login screen with no console errors; authentication and post-login screens remain unverified because no credentials were entered.
- Verification: existing Node suite 41/41 passed; `dashboard/dashboard.js` module syntax check passed; `git -c core.whitespace=cr-at-eol diff --check` passed (only Git's CRLF conversion notices). No Supabase branch/schema/data, Apps Script, Sheet, or published GitHub branch changed. Candidate remains uncommitted and local.

## Authenticated local UI smoke check — 2026-11-10

- Rechecked the candidate at `127.0.0.1:5501/dashboard/` in the already-authenticated doctor session. Dashboard rendered successfully with no console errors and no partial-load warning banner.
- Read-only navigation succeeded for home, all appointments, patient directory, calendar, alerts, monthly reports, clinic settings, and team management. The candidate loaded aggregate counts of 475 appointments, 248 patient records, and 3 active team accounts out of 5; no patient-level content was copied into this record. Team audit displayed one event. The initial `0 / 5` was a loading-state snapshot; after the team request completed, it correctly updated to `3 / 5`.
- No form was submitted and no appointment, patient, team member, setting, payment, database row, workbook, or deployment was changed. The doctor-authenticated UI path is now verified for initial load and page rendering. Write operations, secretary-side UI/API boundaries in this same candidate, and the live Sheet archive bridge remain separate open gates.

## Atomic workflow rollout and local dashboard checkpoint — 2026-11-10

- Bassem declined creating a paid Supabase branch; no branch or hourly charge was created. The confirmed target remains the clinic trial project `ccuharkcusmsjdxfuamq`; published GitHub `main` and `with-admin` were not touched.
- Reworked candidate `supabase/16_atomic_staff_workflow.sql` as an expand-only migration: it creates the staff-authorized atomic appointment-workflow and manual-booking RPCs while retaining existing authenticated appointment/event table grants for compatibility with the published frontend. No grant tightening or patient-row modification was performed.
- Corrected and executed the rollback-only validator against the trial database. It completed and rolled back; follow-up checks confirmed no synthetic records persisted, existing aggregate counts remained 475 appointments / 248 patients / one clinic settings row, the tested RPC objects did not persist from the validator, and legacy grants remained enabled.
- Then applied the actual additive migration as `atomic_staff_workflow_expand`. Verified both RPCs exist as SECURITY DEFINER with fixed `pg_catalog, public, private` search path; anon execution is denied and authenticated execution is allowed. Existing table grants are unchanged. The migration ledger records the deployment. This was a schema/function-only change; no patient records were read or altered. Migration 17 was already present remotely.
- Rechecked Supabase advisors: database health is clear. Security advisor now counts 10 authenticated-callable SECURITY DEFINER functions, including the two intentional RPCs; leaked-password protection remains disabled and requires review before production. The private invite-reservation table remains deny-by-default. Historical performance notices remain.
- Aggregate log review found 143 SQLSTATE `23502` NOT NULL errors in the last 24 hours, all reporting `appointments.staff_note` as the failing column. This is a separate unresolved live issue; source attribution is not established and no speculative trigger/default was added.
- Candidate Node suite passed 41/41 after the validator/source-guard edits. Local static preview is running at `http://127.0.0.1:5501`; the dashboard login form opens. The browser-control connection was confirmed working. No credentials were entered, so authenticated UI behavior after this migration and actual appointment writes are not yet verified.
- No GitHub push, public release, Sheet/Apps Script change, invite, auth-setting change, or team-account mutation occurred. Next: sign in through the local preview using an authorized clinic account, then verify dashboard reads and a synthetic workflow/manual-booking write plus audit event against the trial database; separately trace the `staff_note` null errors before treating booking as closed.

## Fix confirmed: empty historical staff note caused PostgREST booking-table errors — 2026-11-10

- Re-examined sanitized Supabase logs. All 143 recent SQLSTATE `23502` errors were PostgREST `SELECT` wrappers whose internal CTE performed a direct `UPDATE public.appointments`; the generated update set `staff_note` from the JSON body. No patient values or raw payloads were retrieved.
- Matched that statement shape to local `google-apps-script/commercial/Code.gs::applyHistoricalProjectionLink_`: it converted every blank text cell to SQL `NULL`, including `staff_note`, although `appointments.staff_note` is `NOT NULL`. This is the confirmed source of the logged errors.
- Fixed the local bridge to preserve a blank `staff_note` as `''` while retaining NULL conversion for other nullable text fields. Added a regression test for an empty Sheet staff note.
- Added and applied trial-only migration `supabase/19_staff_note_null_normalization.sql` as remote migration `20261110195700 staff_note_null_normalization`. It installs a non-definer BEFORE INSERT/UPDATE trigger that normalizes NULL staff notes to `''`, preserving the column's NOT NULL constraint and protecting legacy clients. The trigger and function are present; no other schema or access grants were changed.
- Verified with a transaction-only synthetic database check that both INSERT with NULL and UPDATE to NULL are stored as `''`; the entire check rolled back. Follow-up confirmed zero synthetic rows persisted and exactly one normalizer trigger/function exists.
- Local Node suite passed 42/42. The scoped whitespace check `git -c core.whitespace=cr-at-eol diff --check` passed; ordinary `git diff --check` still flags CRLF lines in the pre-existing `js/main.js` edit, outside this repair.
- No patient data was read or changed. Neither published GitHub branch, Apps Script deployment, workbook, invitation, nor user account changed. Local Apps Script source fix is not yet deployed; the trial database guard is live. Local admin URL remains `http://127.0.0.1:5501/dashboard/`; authenticated workflow UI and an actual user-driven booking are still awaiting sign-in/browser confirmation. Monitor new logs after the DB trigger for recurrence.

## Authenticated dashboard workflow verified after null-note fix — 2026-11-10

- Rechecked the browser-control bridge first; it is connected. A local IAB preview at `http://127.0.0.1:5501/dashboard/` already had an authenticated doctor session, so no credentials were requested or entered. Initial dashboard and queue rendered successfully.
- Used the explicitly permitted synthetic trial record to exercise the `contacted` status workflow through the visible dashboard. The user-interface save returned its success toast. A database check by synthetic booking key (without selecting patient name/phone) confirmed status `contacted`, requested time `16:30`, and one matching `updated/contacted` audit event; the event total rose from one created event to two. The synthetic trial record now remains in the contacted state as an intentional test fixture.
- Checked Supabase PostgreSQL logs from migration time `2026-11-10 19:57:00 UTC` through `20:02:10 UTC`: zero SQLSTATE `23502` errors were recorded. This window includes the successful dashboard workflow save. The isolated null-insert/update trigger test had already passed and rolled back.
- Post-migration health advisor is clear (`lints: []`). Security advisor still lists the intentionally authenticated SECURITY DEFINER workflow/team/doctor RPCs and compromised-password protection disabled; these are tracked review items, not newly introduced health failures. No new grants were changed in this test.
- No published GitHub branch, Apps Script deployment, workbook, invitation, or user account changed. Trial Supabase schema and one synthetic test record were intentionally exercised. Local code regression suite remains 42/42.

## Post-fix security boundary snapshot — 2026-11-10

- Read-only inspection of live PostgreSQL ACLs after the workflow test: none of the 17 `public` SECURITY DEFINER functions can be executed by `anon`. Ten are callable by `authenticated`; each of those contains an `auth.uid()` plus the appropriate doctor/staff role-helper check in its definition. This supports the intended access design but is not a substitute for runtime secretary-versus-doctor negative tests.
- Health advisor remains clear. Security advisor still warns about authenticated-callable SECURITY DEFINER functions (role-gated by design) and disabled leaked-password protection; the private invite-reservation table without policies remains deny-by-default. No ACL or Auth changes were made during this read-only check.

## Role-boundary review follow-up — 2026-11-10

- Revalidated the browser bridge first: Chrome is connected and the local booking page is readable; Supabase Studio is open as well. No user credential or patient data was read or altered in the browser.
- Read-only live SQL confirmed `private.is_doctor()` recognizes only the doctor role and `private.is_staff()` recognizes active doctor/secretary roles. Simulated the existing secretary profile UUID in a transaction-local JWT claim: doctor check returned false and staff check true. Simulated the doctor profile UUID and `doctor_finance_settings()` returned successfully. No database changes were made by these checks.
- Attempted additional live negative-call checks for secretary access to financial settings, attachment RPC, workflow RPC, and manual-booking RPC. Initial MCP multi-statement request returned INVALID_ARGUMENT; the corrected single-query follow-up was stopped by the platform automatic approval layer because the account hit its usage limit (retry date shown as Dec 10, 2026). This is an environment usage blocker, not an application permission failure. Do not bypass it; repeat those negative checks when service access resumes.
- Static role-source review confirms workflow/manual-booking RPCs require `private.is_staff()`, while finance and attachment RPCs require `private.is_doctor()`. Dashboard only loads finance data/UI for doctor accounts and only fetches attachment bodies for doctors. This source review is not a substitute for the incomplete runtime negative-call checks.
- Ran the full local Node suite: 42/42 passed. Candidate remains local, modified and uncommitted. Published `main` and `with-admin`, Apps Script, Sheet, account roles, and live database schema/data were not changed in this follow-up.

## Remaining write-path inventory — 2026-11-10

A focused search of the local admin client found these mutation paths:

- Appointment status/contact/date workflow and manual appointments use the atomic `record_appointment_workflow` and `create_manual_appointment` RPCs; visit completion/payment uses `record_appointment_completion`. These paths write their matching appointment event in the same transaction.
- Remaining direct authenticated table writes are: doctor clinic settings update, doctor expense insert, doctor private-note upsert, and staff alert resolution. The current migrations enforce doctor/staff RLS and column grants for these paths, so this source finding is not evidence of an authorization bypass. They do not all share a central audit log / RPC boundary, which leaves an auditability and consistency gap for the commercial edition.
- Next local engineering stage: define an audit contract that records actor, timestamp, entity/action, and changed field names without duplicating patient free text; convert the remaining writes to narrowly scoped role-checked RPCs or database triggers; add rollback-only/integration coverage; apply only to the trial DB when Supabase access returns; then verify secretary-denied/doctor-allowed behavior at runtime. Keep the legacy published branches untouched unless the user explicitly approves a release.
- No schema, app, deployment, or account change was made while producing this inventory.

## Reusable role-boundary check prepared — 2026-11-10

- Added `supabase/verify_role_boundaries_readonly.sql` for the next available trial-project session. It locates existing secretary/doctor profile IDs without printing them, switches only transaction-local JWT subject claims, asserts role helpers, expects secretary denials for doctor-only finance/attachment/payment calls, expects the doctor finance read to succeed, and asserts anon has no EXECUTE on protected functions.
- The check contains no INSERT/UPDATE/DELETE/DDL statements and creates no fixture rows. It is **prepared but not executed**; execution is still gated by the Supabase MCP usage limit. It must be run only against the confirmed trial project, never a production project.
- Static review confirmed the guard checks role before appointment lookup/write in workflow and manual-booking RPCs, so the negative-call checks use a nonexistent ID and null arguments without touching clinic records.
- Supabase CLI is not installed in this local environment. No migration or live schema change was attempted. `git -c core.whitespace=cr-at-eol diff --check` passed; existing Node tests had passed 42/42 in the immediately preceding check.

## Team Edge Function guard review — 2026-11-10

- Reviewed local `clinic-team-admin` request handling. It rejects unapproved origins, bounds request bodies, extracts a Bearer token, verifies that token against Supabase Auth, loads the caller profile using a server-only service key, and checks the doctor role before any team action. Auth Admin credentials remain server-side; database role changes use doctor-checked RPCs. Invite return URLs are an exact allowlist. No confirmed code defect was found in this pass.
- Added a regression guard to `tests/bridge-guards.test.cjs` for ordering of origin/session/role checks, exact-origin CORS behavior, request-size limits, and network timeout. It is a source-level guard, not a live edge deployment test.
- Verification: Node suite 43/43 passed, `node --check dashboard/dashboard.js` passed, and `git -c core.whitespace=cr-at-eol diff --check` passed (only existing CRLF conversion notices). The new read-only SQL role-check file remains unexecuted pending Supabase tool availability.
- The local Supabase CLI is not installed. No Edge Function deployment, schema change, account change, workbook change, or GitHub push was made. Published `main` and `with-admin` remain untouched.

## Public-client secret scan — 2026-11-10

- Scanned tracked browser-facing source for server service-key markers, modern `sb_secret_` tokens, and JWT payloads whose role is `service_role`. No secret credential was found in the browser bundle; the literal environment-variable name occurs only in server-side Edge Functions.
- Added a regression test covering the booking/admin public HTML and JavaScript entry points so service-role material cannot be introduced unnoticed. This does not scan runtime responses, Git history, external build artifacts, or unrelated binary assets; repository history/remote secrets still require a separate credential audit.
- Verification: local Node suite 44/44 passed, dashboard JavaScript syntax check passed, and scoped `git diff --check` passed (existing CRLF notices only). No keys were displayed. No remote, Supabase, Apps Script, Sheet, or published branch changed.

## Read-only GitHub branch and credential-history review — 2026-11-10

- Requested the permitted read-only network access and fetched only remote refs locally; no push, merge, checkout, or file reset occurred. `git ls-remote --heads origin` showed exactly `main` at `2e825f79ca0b76dfa9d62cfe3503b9cbf9ce43d4` and `with-admin` at `8cbeda12b8d8c5f6685e9cacff722033ae27dcf4`.
- Local `HEAD` equals remote `origin/with-admin`; the existing candidate changes remain uncommitted in the working tree. `main` is a separate branch with its own tree; no published branch changed.
- Scanned 608 unique Git objects reachable from the locally fetched refs and tags for modern `sb_secret_` values and JWTs whose decoded role is `service_role`. No matching credential literal was found. This covers currently fetched branch/tag history, not deleted/unreachable GitHub objects, cached build artifacts, or credential exposure outside this repository.
- Current client-source scan also found no service credential. The environment variable name appears only in server-side Edge Function sources.
- The branch scan and history scan are read-only relative to GitHub. Fetch updated only local Git metadata/object storage. No Supabase, Apps Script, Sheet, account, or deployed site was changed.

## Extended secret-signature review — 2026-11-10

- Extended credential scanning across all 608 unique Git objects reachable from the locally fetched `main`/`with-admin` refs and tags to include known GitHub, Google API, SendGrid, Stripe-live, Slack-token, private-key-block, Supabase secret, and service-role JWT signatures. No signature was found.
- Repeated the same literal-signature scan against the current local working tree (text/source files); no match was found. Scanner output intentionally excludes credential values.
- This is a signature-based review, not proof that all secrets are absent. It does not inspect deleted/unreachable GitHub objects, external build caches, environment variables, or secrets stored in vendor dashboards. No credential rotation or history rewrite was attempted.

## Local booking-source recheck and tool connection — 2026-11-10

- Re-read the active public booking Edge Function and atomic booking SQL in the local `with-admin` candidate. The request body is capped at 8 MB; attachment validation runs before RPC; only the server Edge Function calls `create_booking` with the server-held service key; the SQL validates name/phone/type/date/code, serializes retries and duplicate checks, enforces closure/capacity, and atomically inserts patient, appointment, and creation event. This is source evidence only; it does not prove the deployed Edge Function matches the candidate.
- Re-ran the complete local Node source/regression suite: 44/44 passed. No remote schema or booking request was exercised.
- Rechecked desktop surfaces for a Supabase connection attempt. Supabase Studio is running, but browser automation reports `Local browser use is disabled in Work settings`; therefore no live Supabase UI check was possible. This is an app-tool configuration blocker, not a Supabase/application error. User declined creating a paid Supabase branch; none was created.
- No files, records, credentials, roles, database schema, GitHub branches, Apps Script deployment, or workbook were changed in this check.

## Supabase browser access restored — 2026-11-10

- Retried after the user asked. Chrome browser control is now available. Opened the existing Supabase SQL Editor for project `ccuharkcusmsjdxfuamq` and ran only `select current_database() as database_name, now() as checked_at;`. The UI returned one row (`postgres`) and a timestamp, confirming live read-only SQL access.
- Supabase UI currently labels the selected branch `main · PRODUCTION`. Although Bassem previously identified this project as the trial target, keep this discrepancy visible and do not run migrations, alter data, create branches, or publish until the target is re-confirmed at the time of any write.
- No branch was created (Bassem declined the paid branch), no schema/data/account/config changed, and no GitHub or Apps Script deployment changed.

## Live role-boundary check — 2026-11-10

- The first run of the prepared role SQL stopped at `record_appointment_workflow(-1, ...)` with `P0002 appointment not found`. This showed the check incorrectly expected secretaries to be denied staff workflow; the app intentionally allows active secretaries to use staff workflow. The statement ended with an error before writes; the fake ID had no matching appointment.
- Corrected the local SQL check: doctor-only finance/attachment/payment calls must reject secretary; staff workflow must reach the nonexistent-appointment lookup; manual booking with null patient must stop at input validation; doctor finance settings must remain readable; anon must have no execute on protected RPCs. No DML is present in the check.
- Re-ran it in the connected Supabase SQL Editor; UI reported `Success. No rows returned`. The corrected assertions passed. No records/schema/permissions changed.
- Added a source guard for the corrected read-only test and re-ran the Node suite: 45/45 passed. `node --check dashboard/dashboard.js` and scoped `git diff --check` also passed (only existing CRLF conversion notices).
- Supabase currently labels this project's selected branch `main · PRODUCTION`; the user previously designated the project as the trial database. Keep that visible before any future write. No paid branch was created, and no GitHub/Apps Script/workbook deployment changed.

## Read-only live migration and object reconciliation — 2026-11-10

- Supabase SQL Editor read `supabase_migrations.schema_migrations`: 12 recorded migrations, ending with `atomic_staff_workflow_expand` and `staff_note_null_normalization`. The selected Supabase branch is shown as `main · PRODUCTION`.
- A separate metadata-only query confirmed relevant live SECURITY DEFINER functions exist: doctor finance settings/snapshot, doctor attachment reader, staff workflow/manual booking, team invite/role functions, and closed-case archive queue. `anon` EXECUTE was false for all returned functions. Most require `authenticated`; the internal archive queue function is not executable by `authenticated` or `anon`.
- Metadata query confirmed the team invite reservation table is in `private`; public clinic-team events, patient-private-notes, payment-audit, and closed-case archive tables exist. No row contents were selected.
- Local SQL files live directly under `supabase/` with hand-numbered names; there is no standard `supabase/migrations/` directory. The live migration ledger uses timestamped names and does not provide a one-to-one filename mapping for several local files. Presence of resulting functions/tables proves current objects exist, but does not prove which exact local file/version installed each object. Do not initialize/replay these SQL files as migrations until the local-to-live history is reconciled.
- This pass was read-only: no schema, records, branches, settings, deployments, or accounts changed. No paid branch was created.

## Focused live view metadata retry — 2026-11-10

- Retried Chrome control successfully and inspected only the definition/ACL metadata for `public.staff_appointment_events` in Supabase project `ccuharkcusmsjdxfuamq`; no row contents were selected.
- The view definition is `SELECT id, appointment_id, actor_id, event_type, old_status, new_status, created_at FROM appointment_events`, with `security_invoker=true`. The view has broad grants including `anon:SELECT`; because it is security-invoker, effective reads depend on privileges/RLS for the underlying `appointment_events` table. At this initial check the underlying policy had not yet been inspected; see the follow-up below, which resolves that question. The previous metadata check also found `enqueue_closed_case_sheet_archive()` does not contain `no_show` handling; reconcile the live function against the local draft before proposing a change.
- No schema, ACL, records, deployment, or branch changed. Selected Supabase branch still appears as `main · PRODUCTION`; retain the no-write guard until target is reconfirmed.

## Follow-up to focused metadata check — 2026-11-10

- Completed the read-only check of the underlying `public.appointment_events` table. RLS is enabled; `anon` has no direct SELECT privilege; policies shown are scoped to `{authenticated}` and require `private.is_staff()` for reads, with inserts additionally tied to `auth.uid() = actor_id`. Together with `security_invoker=true` on `staff_appointment_events`, the broad anon grant on the view does not grant anon access to the underlying rows. The earlier exposure concern is not confirmed; the local draft revoke on the view is not needed to close an observed data leak and remains unapplied.
- Reconfirmed that the live `enqueue_closed_case_sheet_archive()` definition does not handle `no_show`, while local `supabase/17_archive_no_show_cases.sql` does. This is a real local/live behavior gap: no-show closures will not be archived by the current live trigger. Do not apply the local SQL until the project target/branch and migration history are reconciled; UI still labels the selected branch `main · PRODUCTION`.
- Read-only only. No database records, schema, grants, deployments, GitHub branches, or local application source changed.


## Candidate verification after live metadata review — 2026-11-10

- Re-ran `node --test tests/*.test.cjs` in the local With Admin candidate: 45/45 passed, including archive idempotency/retry/no-show behavior, role guard sources, and booking input/attachment guards.
- `node --check dashboard/dashboard.js` passed. `git -c core.whitespace=cr-at-eol diff --check` passed; Git only reported existing LF-to-CRLF normalization notices for dashboard files.
- This validates the local candidate source only. The live database still lacks `no_show` in `enqueue_closed_case_sheet_archive()`. The local worktree remains modified/uncommitted on `with-admin`; origin `with-admin` and published `main` were not changed. No database, workbook, app script deployment, or hosted site was modified.

## Local clinic admin candidate — expense audit path (2026-11-10)

- Added `supabase/migrations/20261110211333_clinic_admin_write_rpcs_and_audit.sql` as a **local-only, unapplied** migration. It adds doctor-readable, value-free audit events and role-checked write RPCs for expenses, settings, private notes, and alerts.
- Updated `dashboard/dashboard.js` to create expenses through `record_clinic_expense` rather than a direct table insert. Added source-level regression coverage in `tests/bridge-guards.test.cjs`.
- Verification: `node --check dashboard/dashboard.js` passed; `node --test tests/*.test.cjs` passed 46/46; `git -c core.whitespace=cr-at-eol diff --check` passed with only LF/CRLF notices.
- Runtime SQL integration has not been run because this worktree has no local Supabase database. The project remains local-only and unpublished; do not apply this migration to the hosted project until migration history and target branch are reconciled and the migration is validated in an isolated local/test database. No hosted database, patient data, workbook, Apps Script, or published GitHub branch changed.

## Remaining direct admin mutation inventory — 2026-11-10

- Source review found three dashboard writes that still use direct PostgREST mutations: `saveSettings` updates `clinic_settings` (existing RLS policy is doctor-only); `savePrivateNote` upserts `patient_private_notes` (existing RLS and grants are doctor-only); `resolveAlert` / `resolveAllAlerts` update `booking_alerts` (existing RLS allows staff). These checks are database-side today, but these paths do not yet emit the new centralized audit events.
- The expense path was converted locally to the new RPC and audit migration. Next sequence after local PostgreSQL is available: validate the expense migration; then convert settings, private-note, and alert mutations in separate, role-matched steps, preserving their current behavior and ensuring private note contents are never copied into audit metadata.
- No source for these three paths changed during this inventory. No database, patient data, Sheet, Apps Script, published branch, or hosted site changed.

## Local admin writes consolidated — 2026-11-10

- Extended the local-only migration so expense creation, clinic settings updates, private-note saves, and single/bulk alert resolution all go through role-checked Postgres RPCs. The browser no longer performs direct insert/update/upsert mutations for these four paths.
- Added database-side audit triggers for settings changes, private-note create/update, and alert resolution, alongside the expense trigger. Events retain only actor, action, entity ID, field names, and time; the private-note text, expense amount/note, and alert message/reason are not copied into this audit table.
- Settings and private-note RPCs require the doctor role; alert resolution requires staff. Existing RLS policies remain in force through SECURITY INVOKER RPCs. No table write privileges were revoked, preserving compatibility with already-published clients while this remains a candidate.
- Verification: dashboard syntax check passed; local Node suite passed 47/47; `git diff --check` passed with existing line-ending notices. Source scan found only read/select operations via `.from()` in `dashboard/dashboard.js`.
- This is still source-level verification only. Docker/psql are unavailable, so migration syntax and transaction behavior have not been run against PostgreSQL. The migration remains local and unapplied; no Supabase, workbook, Apps Script, GitHub branch, or hosted site changed.

## Finance trial enablement and candidate recheck — 2026-11-11

- On Bassem's request, enabled `finance_enabled` in the confirmed trial Supabase project and set clearly fictitious service prices: first visit 101, follow-up 102, consultation 103, aesthetics 104, birth 105, labs 106 EGP. The returned settings row confirmed the values; no payment or expense was created.
- Re-ran the existing Node suite: 47/47 passed. `node --check` passed for `dashboard/dashboard.js` and `js/main.js`; `git diff --check` passed with only line-ending normalization notices.
- The active local dashboard tab currently shows the sign-in form, so the finance UI was not visually verified in this pass. No credentials were entered. Current local `with-admin` is exactly aligned with `origin/with-admin`; the published branches were not changed or pushed.
- Remaining finance acceptance check: doctor signs in and confirms finance, reports, expenses and settings load; then decide whether secretary may record payment/complete visits while remaining barred from financial reports. No further permission change was made.

## Doctor/secretary finance read-boundary regression check — 2026-11-11

- Added a source regression assertion that the dashboard's appointment projection omits payment fields, and that payment audit, expenses, finance snapshot/settings RPCs, and finance projection run only for a doctor session.
- Verification: Node suite passes 48/48; `dashboard/dashboard.js` syntax and `git diff --check` pass. This guards the current browser query path; the SQL/RLS guards remain separately covered by existing checks.
- No application runtime, patient row, Supabase, workbook, Apps Script, or GitHub branch was changed. Authenticated visual testing still awaits the doctor dashboard session.
## Secretary payment-only permission — 2026-11-11

- Bassem approved the secretary to enter the due amount, paid amount, and payment method while completing an active visit. Finance reports, expenses, service prices, payment history, doctor-only notes, and birth recording remain doctor-only.
- Added local UI changes in `dashboard/dashboard.js` and a focused SQL patch at `supabase/20_secretary_payment_only.sql`. The patch creates a staff-only boolean RPC for the finance switch, and constrains the completion RPC so a secretary can complete an active visit only once and cannot set a payment note or birth record.
- Applied the patch through Supabase Studio to the user-confirmed trial project `ccuharkcusmsjdxfuamq` on 2026-11-11. SQL Editor returned success. A separate transaction-only role check confirmed the secretary safe switch works, direct payment and service-price column reads are denied, doctor finance settings remain denied, and the payment completion path reaches the expected `appointment not found` guard for a deliberately invalid ID. The check ended with `ROLLBACK` and changed no appointment, payment, or expense rows.
- Updated the role matrix and migration notes. Full local Node suite now passes 49/49, both JavaScript syntax checks pass, and `git diff --check` passes. Authenticated visual UI verification remains pending. No GitHub branch, public site, Sheet, or Apps Script was changed.
