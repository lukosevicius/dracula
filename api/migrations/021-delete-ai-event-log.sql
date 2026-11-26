START TRANSACTION;

-- Permanently remove AI verification entries from every event's log,
-- including the ones migration 017 only hid.
DELETE FROM event_history
WHERE action IN ('verified','verification_failed','verification_skipped')
  OR (action IN ('published','unpublished') AND (actor='AI verification' OR actor LIKE 'AI · %'));

-- Empty the Needs attention queue: retire every open finding and clear the flag.
UPDATE verification_findings SET status='superseded' WHERE status='open';

UPDATE events SET needs_attention=0 WHERE needs_attention=1;

COMMIT;
