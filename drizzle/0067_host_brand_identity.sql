-- Public brand presentation only. Preserve personal identity, verification,
-- event associations, organizer credits, permissions and financial records.
ALTER TABLE hosts ADD COLUMN brand_name TEXT;
ALTER TABLE hosts ADD COLUMN brand_logo_url TEXT;

UPDATE hosts
SET brand_name = 'The Yorke Way', brand_logo_url = '/hosts/the-yorke-way.svg',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'host:kofi-bills' AND slug = 'kofi-bills';
