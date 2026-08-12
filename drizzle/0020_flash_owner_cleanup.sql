UPDATE room_flashes
SET image_data = NULL,
    status = 'deleted',
    moderation_result = 'owner_removed',
    deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE event_slug = 'after-dark-osu'
  AND status = 'active'
  AND id = (
    SELECT id
    FROM room_flashes
    WHERE event_slug = 'after-dark-osu' AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 1
  )
  AND 1 = (
    SELECT COUNT(*)
    FROM room_flashes
    WHERE event_slug = 'after-dark-osu' AND status = 'active'
  );
