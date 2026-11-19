# Local migration status — 2026-11-12

## Local validation update — 2026-11-14

- Docker Desktop was restarted and the local PostgreSQL container `supabase_db_doaa-admin-local-validation-run` was reachable on port `54322`.
- This was an older initialized local volume, not a blank Supabase bootstrap: `clinic_member_permissions` and the `owner` role were missing, and no Supabase migration-ledger table was present. An early attempt to apply the final migration failed on the missing prerequisite and rolled back without partial changes.
- Applied successfully to this local PostgreSQL database, in order: `supabase/21_owner_role_enum.sql`, `supabase/22_owner_control_room.sql`, `supabase/migrations/20261113200000_owner_permission_matrix.sql`, and `supabase/migrations/20261114120000_permission_enforcement_and_named_profiles.sql`.
- A rollback-only SQL workflow test passed for owner management, doctor visit closure, secretary payment-only after doctor closure, denied secretary visit closure/attachment access, denied doctor actions after permission revocation, and denied anonymous permission-management access. The test transaction was rolled back.
- Post-test verification found zero rows in `profiles`, `appointments`, `patients`, and `clinic_permission_profiles`; test fixtures did not persist. Permission tables and RPCs are present.
- These were direct local `psql` applications, not Supabase CLI migrations; the migration ledger remains absent/unreconciled. No hosted Supabase project, GitHub branch, or patient data was changed.
- This validates PostgreSQL enforcement only. Local Auth/REST/Storage services and end-to-end dashboard flows have not been tested. Do not claim the whole admin app is closed until those services are available and the browser is confirmed to target the local stack.

The repository has a historical SQL layout that predates Supabase CLI migrations: the baseline (`schema.sql`), follow-up schema scripts, and later numbered SQL files live directly in `supabase/`. The hosted migration ledger has not been reconciled one-to-one with those local files.

Known hosted change: the root-level patch `20_secretary_payment_only.sql` was applied directly in Supabase Studio to the user-confirmed trial project on 2026-11-11. This direct application did not reconcile the migration ledger.

Local candidate migrations:

- `20261110211333_clinic_admin_write_rpcs_and_audit.sql` — admin workflow/audit candidate; previously checked against a local reconstruction only.
- `20261112200000_arabic_name_duplicate_normalization.sql` — current booking hardening candidate. It adds per-phone attempt throttling, normalizes common Arabic letter variants when checking active duplicate names, and preserves the existing patient name when a new booking uses the same phone number. It has not been applied to the hosted trial database.
- `20261113200000_owner_permission_matrix.sql` — owner-managed per-account permission selections. Applied on 2026-11-13 to the user-identified trial project `ccuharkcusmsjdxfuamq`. It adds the permission catalog and owner-only read/write RPCs. It does not yet replace role checks in every existing database RPC or RLS policy; do not treat a checkbox selection as backend-enforced access until those operations are migrated and verified.
- `20261114120000_permission_enforcement_and_named_profiles.sql` — applied to the local PostgreSQL validation database on 2026-11-14 after its owner-role and permission-matrix prerequisites. It enforces selected permissions across appointment, attachment, finance, expense, notes, alerts, settings, payment, and team invitation paths; stores unique named permission groups; makes dependency scopes explicit; rejects access for pending/suspended profiles; and prevents deleting groups still assigned to accounts. It has **not** been applied to hosted Supabase. UI/edge-function changes in `dashboard/dashboard.js` and `functions/clinic-team-admin/index.ts` remain local only.

The matching source snapshot is `../10_booking_idempotency_and_atomic_limits.sql`; the booking Edge Function in `../functions/clinic-db-booking/` derives a server-only HMAC throttle key. This is a per-phone control, not a complete IP/global bot defense: automated callers can rotate phone numbers. The deployment remains local-only and the published GitHub branches are outside this candidate's scope.

The migrations directory is not a blank-project bootstrap and must not be treated as the whole schema history. Do not run `supabase db reset`, `supabase db push`, or replay migrations against the hosted project until the complete baseline and hosted ledger are reconciled. Do not apply the new booking migration remotely until its dependency state has been reconciled and the exact trial project is positively identified.

## Backup and recovery status

An actual backup restore has not been performed or verified for this candidate. Before treating the hosted trial data as production data, document the configured backup/retention method for its Supabase plan, take a schema-and-data backup through the approved route, and rehearse restoration into an isolated database. Do not claim recoverability based only on the presence of live rows or local SQL files.

## Validation gate

For future full-stack local validation:

1. Build a data-free local schema baseline that matches the intended trial schema. Prefer a schema-only source; do not import patient rows, credentials, or storage objects.
2. Apply this candidate migration to the local database inside a rollback-only test transaction.
3. Check the four write RPCs as doctor and secretary roles, unauthorized roles, audit field names, and absence of note/message/amount values in the audit table.
4. Roll back the test transaction, then document the local schema snapshot/version used.
5. Only after local verification, reconcile the exact hosted branch and migration history before considering any remote apply.

The local candidate passed 51 JavaScript/source-guard checks and `node --check` for the dashboard bundle before this DB validation. PostgreSQL role/permission behavior was subsequently verified with rollback-only synthetic SQL checks. Browser-authenticated doctor/secretary/owner workflows and end-to-end attachment/payment behavior remain unverified; only the database container was running. Do not mark the full admin release closed until local Auth/REST/Storage are available and those UI flows are checked against the local stack.

## Superseding status — 2026-11-18

This section supersedes statements above that say the current hosted permission matrix or UI workflows are unverified. The active trial project is now `gtpmzbjakfvjpvpliwnj`, not the older project references in this historical log. Its hosted migration ledger lists 20 migrations through `restore_staff_finance_enabled_gate`; the trial database has the permission tables/RPCs and the browser rendered the owner and secretary dashboards. The secretary's expense-entry and permission-change test was reported successful by the user. Current source tests pass 51/51, and all three JavaScript entry files pass `node --check`.

The source migration directory still does not reproduce the hosted `trial_*` ledger one-to-one. This is not a blocker for preserving the current local candidate, but it must be reconciled before rebuilding the database from source or claiming reproducible deployment. Supabase security advisories still include 29 generic `SECURITY DEFINER` warnings, two RLS/no-policy notices for permission tables (direct `anon` and `authenticated` reads are revoked), and leaked-password protection disabled. Review all flagged functions and enable the Auth protection before public/production launch. See [`../docs/RELEASE_READINESS_2026-11-18.md`](../docs/RELEASE_READINESS_2026-11-18.md).
