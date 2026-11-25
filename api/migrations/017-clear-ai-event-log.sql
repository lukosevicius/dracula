START TRANSACTION;

UPDATE events e
SET needs_attention = EXISTS (
  SELECT 1 FROM verification_findings f
  WHERE f.event_id=e.id AND f.status='open' AND (
    f.verification_id IS NULL OR NOT (
      JSON_UNQUOTE(JSON_EXTRACT(f.finding,'$.reason')) <=> 'No saved value was available to confirm.'
    )
  )
)
WHERE EXISTS (
  SELECT 1 FROM verification_findings f
  WHERE f.event_id=e.id AND f.status='open' AND f.verification_id IS NOT NULL
    AND JSON_UNQUOTE(JSON_EXTRACT(f.finding,'$.reason'))='No saved value was available to confirm.'
);

UPDATE verification_findings
SET status='superseded'
WHERE status='open' AND verification_id IS NOT NULL
  AND JSON_UNQUOTE(JSON_EXTRACT(finding,'$.reason'))='No saved value was available to confirm.';

UPDATE event_history
SET context=JSON_SET(context,'$.archived_from_event_log',TRUE)
WHERE action IN ('verified','verification_failed','verification_skipped')
  OR (action IN ('published','unpublished') AND (actor='AI verification' OR actor LIKE 'AI · %'));

COMMIT;
