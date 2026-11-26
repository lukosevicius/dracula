ALTER TABLE events ADD event_end_time VARCHAR(5) NULL AFTER event_time;

-- Avilys listings already carry an end time in their source data (Vilnius wall time, even with a trailing Z).
UPDATE events e
JOIN event_sources s ON s.id=(SELECT id FROM event_sources WHERE event_id=e.id AND source_key='avilys' ORDER BY id LIMIT 1)
SET e.event_end_time=SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(s.source_data_json,'$.endTime')),12,5)
WHERE e.event_end_time IS NULL AND JSON_VALID(s.source_data_json)
  AND JSON_UNQUOTE(JSON_EXTRACT(s.source_data_json,'$.endTime')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]';

-- Event type replaces the music classification: music, festival, other or unsure. "Not music" becomes "other".
UPDATE events SET review_status='other' WHERE review_status='not_music';
UPDATE vilnius_events SET review_status='other' WHERE review_status='not_music';

START TRANSACTION;

-- Rules still using the default classification paragraph get the event type wording as a new active version.
-- Customised rules are left as they are, and verification accepts "not_music" from them as "other".
INSERT INTO verification_rule_versions(rules,activated_by,activated_at)
SELECT JSON_SET(v.rules,
    '$.markdown', REPLACE(REPLACE(JSON_UNQUOTE(JSON_EXTRACT(v.rules,'$.markdown')),
      '# Music classification', '# Event type'),
      'Use not_music when the main activity is unrelated to music.',
      'Use festival for a festival programme where music is a main part. Use other when the main activity is not music.'),
    '$.permissions.festival', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(v.rules,'$.permissions.music')), 'auto'),
    '$.permissions.other', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(v.rules,'$.permissions.not_music')), 'auto')),
  'Seeker defaults · Event types', UTC_TIMESTAMP(3)
FROM verification_rule_state s JOIN verification_rule_versions v ON v.id=s.active_version_id
WHERE s.id=1 AND JSON_UNQUOTE(JSON_EXTRACT(v.rules,'$.markdown')) LIKE '%Use not_music when the main activity is unrelated to music.%';

UPDATE verification_rule_state
SET active_version_id=LAST_INSERT_ID(),revision=revision+1
WHERE id=1 AND EXISTS (SELECT 1 FROM verification_rule_versions WHERE id=LAST_INSERT_ID() AND activated_by='Seeker defaults · Event types');

COMMIT;
