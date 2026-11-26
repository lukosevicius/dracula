/** What kind of event this is. Music and festivals are shown in Dracula; the type itself is not shown to visitors. */
export const eventTypes = ['music', 'festival', 'other', 'unsure'] as const;
export type EventType = typeof eventTypes[number];
export const publishableTypes: readonly string[] = ['music', 'festival'];
export const eventTypeLabels: Record<EventType, string> = { music: 'Music', festival: 'Festival', other: 'Other', unsure: 'Unsure' };

/** Accepts the former "not_music" value, still used by older AI rules and agents, as "other". */
export function normalizeEventType(value: unknown): EventType | null {
  const type = value === 'not_music' ? 'other' : value;
  return eventTypes.includes(type as EventType) ? type as EventType : null;
}
