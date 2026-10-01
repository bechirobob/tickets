-- Owner-confirmed public verification for the existing Kofi Bills profile.
-- No account roles, permissions, event assignments or other hosts are changed.
UPDATE hosts
SET verification_status = 'verified', updated_at = CURRENT_TIMESTAMP
WHERE id = 'host:kofi-bills' AND slug = 'kofi-bills'
  AND verification_status = 'reviewed';
