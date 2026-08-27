-- 0026_scanner_org.sql (BS106) — organizer-owned door staff.
--
-- Scanning (the /scan gate PWA, coded scanner_user accounts, two-step admit) has
-- been super-admin-provisioned only. This adds ownership so an ORGANIZER can run
-- their own door: create/rotate/revoke scanners scoped to their own events.
--
-- Additive + back-compat: existing admin-created scanners keep organizer_handle
-- NULL and are untouched. New org-created scanners carry the acting org's handle
-- and are ALWAYS pinned to a specific owned event (event_scope NOT NULL) — an org
-- scanner with a NULL scope would scan every org's events, so the application
-- layer forbids it (this column only records ownership; scan-time scope is still
-- event_scope, unchanged).

alter table scanner_user add column if not exists organizer_handle text;
create index if not exists scanner_user_org_idx on scanner_user (organizer_handle) where organizer_handle is not null;
