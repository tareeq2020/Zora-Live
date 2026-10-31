-- BS148: Google sign-in for organizers.
--
-- app_user.google_sub is the stable Google account id (the ID token's `sub`).
-- Organizer Google sign-in matches by sub FIRST, then by verified email
-- (case-insensitive); the sub is stored when an organizer signs up with Google
-- or first signs in with Google on an email-matched account. Unique (partial —
-- most users have none) so one Google account can never map to two identities.
alter table app_user add column if not exists google_sub text;
create unique index if not exists app_user_google_sub_uq
  on app_user (google_sub) where google_sub is not null;
