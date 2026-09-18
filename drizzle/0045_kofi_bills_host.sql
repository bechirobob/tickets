-- Public profile details only. Existing hosts and event ownership stay intact.
ALTER TABLE hosts ADD COLUMN full_name TEXT;
ALTER TABLE hosts ADD COLUMN instagram_handle TEXT;
ALTER TABLE hosts ADD COLUMN snapchat_handle TEXT;

INSERT INTO hosts (id, slug, name, full_name, bio, city, verification_status,
  profile_image_url, instagram_handle, snapchat_handle, created_at, updated_at)
VALUES ('host:kofi-bills', 'kofi-bills', 'Kofi Bills', 'Henry Yorke',
  'Accra nightlife, a good fit and a guest list worth leaving the house for. Henry Yorke, better known as Kofi Bills, brings his eye for fashion to private parties and events. Come looking like you had plans. Stay like tomorrow can wait.',
  'Accra', 'reviewed', '/hosts/kofi-bills.webp', 'mr.yorke', 'kofi_billz123',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT(slug) DO UPDATE SET
  name = excluded.name, full_name = excluded.full_name, bio = excluded.bio,
  city = excluded.city, profile_image_url = excluded.profile_image_url,
  instagram_handle = excluded.instagram_handle, snapchat_handle = excluded.snapchat_handle,
  updated_at = CURRENT_TIMESTAMP;
