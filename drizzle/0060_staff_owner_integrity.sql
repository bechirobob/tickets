-- Keep an active master account even when separate owner requests race.
-- This additive guard applies to the existing account update path as well as
-- future writers; the application's DELETE path already checks atomically.
CREATE TRIGGER staff_last_active_owner_update_guard
BEFORE UPDATE OF role, status ON staff_accounts
WHEN OLD.role = 'owner' AND OLD.status = 'active'
  AND (NEW.role <> 'owner' OR NEW.status <> 'active')
  AND (SELECT COUNT(*) FROM staff_accounts WHERE role = 'owner' AND status = 'active') <= 1
BEGIN
  SELECT RAISE(ABORT, 'Keep at least one active master account.');
END;
