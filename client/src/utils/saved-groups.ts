import type { DisplayEvent } from './events-api';

export type SavedRow = { type: 'heading'; title: string; key: string } | { type: 'row'; events: DisplayEvent[]; key: string };

export function savedEventRows(events: DisplayEvent[], columns: number, today: string): SavedRow[] {
  const upcoming: DisplayEvent[] = [];
  const past: DisplayEvent[] = [];
  for (const event of events) {
    const end = event.event_end_date || event.event_date;
    (end && end < today ? past : upcoming).push(event);
  }
  const rows: SavedRow[] = [];
  for (const [title, group] of [['Artėjantys renginiai', upcoming], ['Praėję renginiai', past]] as const) {
    if (!group.length) continue;
    rows.push({ type: 'heading', title, key: `heading-${title}` });
    for (let i = 0; i < group.length; i += columns) {
      const items = group.slice(i, i + columns);
      rows.push({ type: 'row', events: items, key: `row-${items[0].id}` });
    }
  }
  return rows;
}
