e.review_status = 'music' AND NULLIF(e.event_date, '') IS NOT NULL AND COALESCE(NULLIF(e.event_end_date, ''), e.event_date) >= ?
