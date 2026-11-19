ALTER TABLE events ADD COLUMN IF NOT EXISTS city VARCHAR(191) NULL AFTER venue;

UPDATE events AS e
SET e.city = 'Vilnius'
WHERE e.city IS NULL AND EXISTS (
  SELECT 1 FROM event_sources AS s WHERE s.event_id = e.id AND s.source_key = 'vilnius-events'
);

UPDATE events AS e
JOIN (
  SELECT event_id, TRIM(JSON_UNQUOTE(city_json)) AS city
  FROM (
    SELECT event_id, JSON_EXTRACT(
      CASE WHEN JSON_VALID(source_data_json) THEN source_data_json ELSE '{}' END, '$.city'
    ) AS city_json
    FROM event_sources
    WHERE source_key = 'avilys'
  ) AS metadata
  WHERE JSON_TYPE(city_json) = 'STRING'
) AS avilys ON avilys.event_id = e.id
SET e.city = CASE WHEN LOWER(avilys.city) = 'vilnius' THEN 'Vilnius' ELSE avilys.city END
WHERE e.city IS NULL AND CHAR_LENGTH(avilys.city) BETWEEN 1 AND 191;
