START TRANSACTION;

INSERT INTO verification_rule_versions(rules,activated_by,activated_at)
VALUES (
  JSON_OBJECT(
    'markdown', '# Music classification

Classify concerts, live performances, DJ sets and events where music is the main activity as music. Use not_music when the main activity is unrelated to music. Use unsure if the listing does not establish which applies.

# Source description

Use the imported description as evidence for event details. Leave the description itself as supplied. Report a finding for a specific field when a saved detail conflicts with reliable evidence or a required detail is missing.

# Performers

Check who actually performs using the title and description. Keep confirmed artist links and use the catalogue for new links when the listing clearly identifies the performer. Report each performer separately using their listed name and supporting quote. Log weak identifications, such as a guest credited only by first name, as observations. Flag an ambiguous catalogue match when the listing clearly identifies the performer. A tribute subject, composer, influence or person merely mentioned in the listing is not a performer.

# Dates, times and venue

Use Vilnius local time. Distinguish the performance start from doors, the end time and the date the listing was published. Use structured source values as evidence. Flag explicit disagreements between the listing text and structured values, and quote the competing value. Never infer a missing year or time.

# Ticket prices

Use the advertised general admission price. An explicit positive ticket price means paid admission. Leave a matching saved price type confirmed. A blank ticket price can be filled from clear evidence on a Draft or Live event when the price is unlocked and the action permission allows it. Ignore optional fees, free table reservations and free admission for specific age groups when deciding the general price. Report a review item when reliable ticket sources conflict or the general price is genuinely ambiguous.

# Other details

Leave unknown optional details unknown. Report specific cancellation or duplicate signals when supported by the evidence.',
    'permissions', JSON_OBJECT(
      'title', 'review', 'event_date', 'auto', 'event_end_date', 'auto', 'event_time', 'auto',
      'venue', 'auto', 'city', 'auto', 'ticket_url', 'auto', 'about_url', 'auto',
      'price_type', 'auto', 'price_text', 'auto', 'artists', 'auto', 'music', 'auto',
      'not_music', 'auto', 'unsure', 'review', 'publication_status', 'auto'
    )
  ),
  'Seeker defaults · Focused verification',
  UTC_TIMESTAMP(3)
);

UPDATE verification_rule_state
SET active_version_id=LAST_INSERT_ID(),revision=revision+1
WHERE id=1 AND active_version_id IS NULL;

COMMIT;
