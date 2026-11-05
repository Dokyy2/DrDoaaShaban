# Dr Doaa Shaban Clinic — Administration edition

**Project version:** `v2.5.0`  
**Branch:** `with-admin`  
**Status:** ready to publish on the existing `with-admin` branch.

This edition carries the same `v2.5.0` clinic experience as `main`, with the administration dashboard added. It preserves the existing Supabase booking path and dashboard code; the patient-facing form continues to use the Supabase RPC when its public client configuration is available.

## Included in v2.5.0

- Clear, stationary booking-service choices and a two-step cue.
- Heart/flower celebration after a completed booking, plus refreshed alerts.
- The five-photo story rail and viewer.
- The health assistant logo, scroll-aware floating orb, and embedded assistant window.
- A visitor counter capped at five visible visitors. The local Apps Script presence endpoint has not been deployed, so the live counter remains inactive until that endpoint is deployed.
- The dashboard at `dashboard/`, authenticated through the existing Supabase project.

## Switching the same GitHub Pages URL

The root page is intentionally different by branch:

- `main` serves the no-dashboard edition.
- `with-admin` serves this edition and includes the `dashboard/` page.

To switch which edition GitHub Pages serves, open repository **Settings → Pages → Build and deployment → Deploy from a branch**, choose `main` or `with-admin`, choose `/(root)`, and save. Both editions then use the same Pages URL; changing the selected branch changes the edition at that URL. Do not merge `with-admin` into `main` to switch versions.

The dashboard depends on the existing Supabase project and its active access policies. This repository contains only the public client configuration; it must never contain a service-role/secret key or patient exports. Keep Supabase RLS and authorized staff access in place.

## Local preview safety

Opening this edition via `file://` or localhost shows a preview banner and simulates booking completion. The preview does not send booking requests to Supabase or Apps Script. The visitor counter also stays simulated until the server endpoint is deployed.

## Key files

- `index.html`, `css/main.css`, `css/gallery.css`, `js/gallery.js`: shared clinic interface at `v2.5.0`.
- `js/main.js`: the existing administration-edition booking logic; keep its Supabase integration intact.
- `js/admin-experience-v25.js`: shared UX upgrades layered over the administration logic.
- `js/config.js`: public Supabase client configuration.
- `dashboard/`: staff dashboard.
- `supabase/`: schema and security migrations.
- `google-apps-script/Code.gs`: local Apps Script source, including the pending presence endpoint.

